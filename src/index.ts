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

export class PatchyInternetQImpl {
	private queue: Queue<Action>;
	private dlQueue: Queue<Action>;
	private isListening = false;
	private queueStatus: 'idle' | 'processing' = 'idle';
	private readonly hooksRegistry;
	private readonly transformerRegistry;
	private persistence;
	private readonly verifyConnectivity: () => Promise<boolean>;
	private readonly errorProcessor: (err: Error, action: Action) => boolean;
	
	constructor(
		hooksRegistry: Record<string, (payload: any) => Promise<void>>,
		transformerRegistry: Record<string, (payload: any) => any>,
		persistence: Persistence,
		verifyConnectivity: () => Promise<boolean>, // Consumer's function to check network status
		errorProcessor: (err: Error, action: Action) => boolean // Consumer's error processor
	) {
		this.queue = new Queue([]);
		this.dlQueue = new Queue([]);
		this.loadFromPersistence(persistence);
		
		this.hooksRegistry = hooksRegistry;
		this.transformerRegistry = transformerRegistry;
		this.persistence = persistence;
		this.verifyConnectivity = verifyConnectivity;
		this.errorProcessor = errorProcessor;
		
		// No internal network listeners here, handled by consumer
	}
	
	private async loadFromPersistence(persistence: Persistence) {
		this.queue = new Queue(await persistence.readQueue());
		this.dlQueue = new Queue(await persistence.readDLQueue());
	}
	
	public enqueue = (action: Action) => {
		this.queue.enqueue(action);
		this.persistence.saveQueue(this.queue.items);
		this.listen();
	};
	
	private dequeue = () => {
		this.queue.dequeue();
		this.persistence.saveQueue(this.queue.items);
	};
	
	private enqueueDLQ = (action: Action) => {
		this.dlQueue.enqueue(action);
		this.persistence.saveDLQueue(this.dlQueue.items);
	};
	
	private async process(action: Action) {
		try {
			const { type, payload } = action;
			const { payload: transformedPayload, id } =
			this.transformerRegistry[type]?.(payload) ?? payload;
			await this.hooksRegistry[type]({ payload: transformedPayload, id });
		} catch (err) {
			
			if (!this.errorProcessor(err as Error, action)) {
				this.enqueueDLQ(action);
				return;
			}
			throw err;
		}
	}
	
	private async run() {
		if (this.queueStatus === 'processing') return;
		
		const connectivity = await this.verifyConnectivity();
		if (!this.queue.head || !connectivity) return;
		
		this.queueStatus = 'processing';
		
		try {
			await this.process(this.queue.head);
			this.dequeue();
		} catch (err) {
			throw err;
		} finally {
			this.queueStatus = 'idle';
		}
	}
	
	listen = async (callback?: (queueSize: number) => void) => {
		if (this.isListening) return;
		
		this.isListening = true;
		
		while (this.queue.head && this.isListening) {
			try {
				await this.run();
			} catch (err) {
				console.log('queue.run:error', err);x``
				this.isListening = false;
				return;
			} finally {
				callback?.(this.queue.size);
			}
		}
		
		this.isListening = false;
	};
}

let queueInstance: PatchyInternetQImpl;

export const init = (
	hooksRegistry: Record<string, (payload: any) => Promise<void>>,
	transformerRegistry: Record<string, (payload: any) => any>,
	persistence: Persistence,
	verifyConnectivity: () => Promise<boolean>, // Custom connectivity check
	errorProcessor: (err: Error, action: Action) => boolean // Custom error processor
): PatchyInternetQImpl => {
	if (queueInstance) return queueInstance;
	
	queueInstance = new PatchyInternetQImpl(
		hooksRegistry,
		transformerRegistry,
		persistence,
		verifyConnectivity,
		errorProcessor
	);
	
	return queueInstance;
};

export const getQueue = () => queueInstance;
