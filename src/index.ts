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
	private readonly verifyConnectivity: () => Promise<boolean>;
	private readonly errorProcessor: (err: Error, action: Action) => boolean;
	private readyPromise: Promise<void>;
	private resolveReady: () => void; // Resolver function
	private mutex = new Mutex();
	
	constructor(
		hooksRegistry: Record<string, (payload: any) => Promise<void>>,
		transformerRegistry: Record<string, (payload: any) => any>,
		persistence: Persistence,
		verifyConnectivity: () => Promise<boolean>,
		errorProcessor: (err: Error, action: Action) => boolean
	) {
		this.queue = new Queue([]);
		this.dlQueue = new Queue([]);
		this.hooksRegistry = hooksRegistry;
		this.transformerRegistry = transformerRegistry;
		this.persistence = persistence;
		this.verifyConnectivity = verifyConnectivity;
		this.errorProcessor = errorProcessor;
		
		// Create the promise and capture the resolver
		this.readyPromise = new Promise<void>((resolve) => {
			this.resolveReady = resolve as () => void;
		});
		
		// Start loading persistence data and set ready status
		this.initialize();
	}
	
	private async initialize() {
		const releaseLock = await Promise.race([
			this.mutex.acquire(),
			new Promise((_, reject) =>
				setTimeout(() => reject(new Error('mutex acquisition timeout')), 5000)
			)
		]);
		try {
			await this.loadFromPersistence();
		} finally {
			releaseLock(); // Ensure the lock is released after initialization
		}
		this.resolveReady(); // Resolve ready promise once data is loaded
	}
	
	private async loadFromPersistence() {
		this.queue = new Queue(await this.persistence.readQueue());
		this.dlQueue = new Queue(await this.persistence.readDLQueue());
	}
	
	get ready() {
		return this.readyPromise;
	}
	
	public async enqueue(action: Action) {
		const releaseLock = await this.mutex.acquire();
		try {
			this.queue.enqueue(action);
			await this.persistence.saveQueue(this.queue.items);
		} finally {
			releaseLock();
			this.listen();
		}
	}
	
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
	
	// TODO: Implement public function to clear DLQ
	
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
	
	private async run() {
		if (this.queueStatus === __PROCESSING__) return;
		
		const connectivity = await this.verifyConnectivity();
		if (!this.queue.head || !connectivity) return;
		
		this.queueStatus = __PROCESSING__;
		
		try {
			await this.process(this.queue.head);
			await this.dequeue();
		} finally {
			this.queueStatus = __IDLE__;
		}
	}
	
	private listen = async () => {
		if (this.isListening) return;
		
		this.isListening = true;
		
		while (this.queue.head && this.isListening) {
			try {
				await this.run();
			} catch (err) {
				// TODO: Implement logger
				console.log('queue.run:error', err);
				this.isListening = false;
				return;
			}
		}
		
		this.isListening = false;
	};
}

// Queue instance is kept in the module scope to be shared across different parts of the app
let queueInstance: PatchyInternetQImpl;

export interface InitProps {
	hooksRegistry: Record<string, (payload: any) => Promise<void>>,
	transformerRegistry: Record<string, (payload: any) => any>,
	persistence: Persistence,
	verifyConnectivity: () => Promise<boolean>,
	errorProcessor: (err: Error, action: Action) => boolean
}
export const init = async (
	{
		hooksRegistry,
		transformerRegistry,
		persistence,
		verifyConnectivity,
		errorProcessor,
	}
): Promise<PatchyInternetQImpl> => {
	if (queueInstance) return queueInstance;
	
	queueInstance = new PatchyInternetQImpl(
		hooksRegistry,
		transformerRegistry,
		persistence,
		verifyConnectivity,
		errorProcessor
	);
	
	// Wait for the status to be true before returning the instance
	await queueInstance.ready;
	
	return queueInstance;
};

export const getQueue = () => queueInstance;
