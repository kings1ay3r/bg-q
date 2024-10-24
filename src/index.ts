import {Mutex} from "async-mutex";

export type Action = {
	type: string;
	payload: object;
};

export type Persistence = {
	saveQueue: (actions: Action[]) => Promise<void>;
	saveDLQueue: (actions: Action[]) => Promise<void>;
	readQueue: () => Promise<Action[]>;
	readDLQueue: () => Promise<Action[]>;
};

class Queue<T> {
	public items: T[];
	
	constructor(items: T[]) {
		this.items = items;
	}
	
	get head() {
		return this.items[0];
	}
	
	get size() {
		return this.items.length;
	}
	
	public enqueue(item: T) {
		this.items.push(item);
		return item;
	}
	
	public dequeue() {
		return this.items.shift();
	}
}

const __PROCESSING__ = 'processing';
const __IDLE__ = 'idle';

export class PatchyInternetQImpl {
	private queue: Queue<Action>;
	private dlQueue: Queue<Action>;
	private isListening = false;
	private queueStatus = __IDLE__;
	private readonly hooksRegistry: Record<string, (payload: Object) => Promise<void>>;
	private readonly transformerRegistry: Record<string, (payload: Object) => any>;
	private persistence: Persistence;
	private readonly errorProcessor: (err: Error, action: Action) => boolean;
	private readonly readyPromise: Promise<void>;
	private resolveReady!: () => void; // Resolver function
	private mutex = new Mutex();
	
	constructor(
		hooksRegistry: Record<string, (payload: any) => Promise<void>>,
		transformerRegistry: Record<string, (payload: any) => any>,
		persistence: Persistence,
		errorProcessor: (err: Error, action: Action) => boolean
	) {
		this.queue = new Queue([]);
		this.dlQueue = new Queue([]);
		this.hooksRegistry = hooksRegistry;
		this.transformerRegistry = transformerRegistry;
		this.persistence = persistence;
		this.errorProcessor = errorProcessor;
		
		// Create the promise and capture the resolver
		this.readyPromise = new Promise<void>((resolve) => {
			this.resolveReady = resolve as () => void;
		});
		
		// Start loading persistence data and set ready status
		this.initialize().then(() => {
			this.listen().then(() => {
			});
		});
	}
	
	public async enqueue(action: Action) {
		const releaseLock = await this.mutex.acquire();
		try {
			this.queue.enqueue(action);
			await this.persistence.saveQueue(this.queue.items);
		} finally {
			releaseLock();
			this.listen().then();
		}
	}
	
	private async loadFromPersistence() {
		this.queue = new Queue(await this.persistence.readQueue());
		this.dlQueue = new Queue(await this.persistence.readDLQueue());
	}
	
	get ready() {
		return this.readyPromise;
	}
	
	public listen = async () => {
		if (this.isListening) return;
		
		this.isListening = true;
		
		while (this.queue.head && this.isListening) {
			try {
				await this.run();
			} catch (err) {
				this.isListening = false;
				return;
			}
		}
		
		this.isListening = false;
	};
	
	private async dequeue() {
		const releaseLock = await this.mutex.acquire();
		try {
			this.queue.dequeue();
			await this.persistence.saveQueue(this.queue.items);
		} finally {
			releaseLock();
		}
	}
	
	private async enqueueDLQ(action: Action) {
		const releaseLock = await this.mutex.acquire();
		try {
			this.dlQueue.enqueue(action);
			await this.persistence.saveDLQueue(this.dlQueue.items);
		} finally {
			releaseLock();
		}
	}
	
	
	get size(): number {
		return this.queue.size
	}
	
	get dlQueueSize(): number {
		return this.dlQueue.size
	}
	
	get peek(): Action[] {
		return [...this.queue.items]
	}
	
	get peekDLQ(): Action[] {
		return [...this.dlQueue.items]
	}
	
	public async clearDLQueue() {
		const items = [...this.dlQueue.items]
		try {
			this.dlQueue = new Queue([]);
			await this.persistence.saveDLQueue([]);
		} catch (err) {
			this.dlQueue = new Queue(items);
			throw err;
		}
		return items;
	}
	
	private async process(action: Action) {
		try {
			const {type, payload} = action;
			const transformedPayload = this.transformerRegistry[type]?.(payload) ?? payload;
			await this.hooksRegistry[type](transformedPayload);
		} catch (err) {
			if (!this.errorProcessor(err as Error, action)) {
				await this.enqueueDLQ(action);
			} else {
				throw err;
			}
		}
	}
	
	private async initialize() {
		const releaseLock = await Promise.race([
			this.mutex.acquire(),
			new Promise((_, reject) =>
				setTimeout(() => reject(new Error('mutex acquisition timeout')), 5000)
			)
		]) as () => void;
		try {
			await this.loadFromPersistence();
		} finally {
			releaseLock(); // Ensure the lock is released after initialization
		}
		this.resolveReady(); // Resolve ready promise once data is loaded
	}
	
	private async run() {
		if (this.queueStatus === __PROCESSING__) return;
		if (!this.queue.head) return;
		
		this.queueStatus = __PROCESSING__;
		
		try {
			await this.process(this.queue.head);
			await this.dequeue();
		} finally {
			this.queueStatus = __IDLE__;
		}
	}
}

// Queue instance is kept in the module scope to be shared across different parts of the app
let queueInstance: PatchyInternetQImpl;

export interface InitProps {
	hooksRegistry: Record<string, (payload: any) => Promise<void>>;
	transformerRegistry: Record<string, (payload: any) => any>;
	persistence: Persistence;
	errorProcessor: (err: Error, action: Action) => boolean;
}

export const init = async (
	{
		hooksRegistry,
		transformerRegistry,
		persistence,
		errorProcessor,
	}: InitProps
): Promise<PatchyInternetQImpl> => {
	if (queueInstance) return queueInstance;
	if (!persistence) persistence = defaultPersistance;
	if (!errorProcessor) errorProcessor = defaultErrorProcessor;
	
	queueInstance = new PatchyInternetQImpl(
		hooksRegistry,
		transformerRegistry,
		persistence,
		errorProcessor
	);
	
	await queueInstance.ready;
	
	return queueInstance;
};

export const getQueue = () => queueInstance;


const defaultPersistance: Persistence = {
	saveQueue: async (queue) => {
		// Save the current state of the queue
	},
	saveDLQueue: async (queue) => {
		// Save the dead-letter queue
	},
	readQueue: async () => {
		// Read and return the queue from storage
		return [];
	},
	readDLQueue: async () => {
		// Read and return the dead-letter queue from storage
		return [];
	},
};

const defaultErrorProcessor = () => true;