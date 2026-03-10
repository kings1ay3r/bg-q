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
	private _items: T[];
	private _offset: number = 0;

	constructor(items: T[]) {
		this._items = items;
	}

	get head(): T | undefined {
		return this._items[this._offset];
	}

	get size(): number {
		return this._items.length - this._offset;
	}

	get items(): T[] {
		return this._items.slice(this._offset);
	}

	public enqueue(item: T): T {
		this._items.push(item);
		return item;
	}

	public dequeue(): T | undefined {
		if (this.size === 0) return undefined;
		const item = this._items[this._offset];
		this._offset++;

		// Optional: periodical cleanup of the array to reclaim memory
		if (this._offset * 2 > this._items.length) {
			this._items = this._items.slice(this._offset);
			this._offset = 0;
		}

		return item;
	}

	public toArray(): T[] {
		return this.items;
	}

	public setItems(items: T[]): void {
		this._items = items;
		this._offset = 0;
	}
}

export const __PROCESSING__ = 'processing';
export const __IDLE__ = 'idle';

const INIT_TIMEOUT_MS = 5000;

export class PatchyInternetQImpl {
	private queue: Queue<Action>;
	private dlQueue: Queue<Action>;
	private isListening = false;
	private queueStatus = __IDLE__;
	private readonly hooksRegistry: Record<string, (payload: object) => Promise<void>>;
	private readonly transformerRegistry: Record<string, (payload: object) => any>;
	private persistence: Persistence;
	private readonly errorProcessor: (err: Error, action: Action) => boolean;
	private readonly readyPromise: Promise<void>;
	private resolveReady!: () => void;
	private rejectReady!: (err: Error) => void;
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

		// Create the promise and capture both resolver and rejector
		this.readyPromise = new Promise<void>((resolve, reject) => {
			this.resolveReady = resolve;
			this.rejectReady = reject;
		});

		// Start loading persistence data and set ready status
		this.initialize()
			.then(() => this.listen())
			.catch((err) => {
				this.rejectReady(err instanceof Error ? err : new Error(String(err)));
			});
	}

	public async enqueue(action: Action): Promise<void> {
		const releaseLock = await this.mutex.acquire();
		try {
			this.queue.enqueue(action);
			await this.persistence.saveQueue(this.queue.items);
		} finally {
			releaseLock();
		}
		this.listen().catch(() => {});
	}
	
	private async loadFromPersistence(signal?: AbortSignal): Promise<void> {
		const queueData = await this.persistence.readQueue();
		if (signal?.aborted) return;
		this.queue = new Queue(queueData);
		const dlQueueData = await this.persistence.readDLQueue();
		if (signal?.aborted) return;
		this.dlQueue = new Queue(dlQueueData);
	}

	get ready(): Promise<void> {
		return this.readyPromise;
	}

	/**
	 * Starts processing actions in the queue sequentially.
	 * If already listening, this is a no-op.
	 * Processing stops when the queue is empty or an error is re-thrown
	 * (i.e., errorProcessor returns true for a transient/retryable error).
	 */
	public listen = async (): Promise<void> => {
		if (this.isListening) return;
		this.isListening = true;

		try {
			while (this.isListening) {
				const action = this.queue.head;

				if (!action) break;

				try {
					await this.run(action);
				} catch (err) {
					// Error processor signaled transient error (run threw)
					break;
				}
			}
		} finally {
			this.isListening = false;
		}
	};

	private async dequeue(): Promise<void> {
		const releaseLock = await this.mutex.acquire();
		try {
			this.queue.dequeue();
			await this.persistence.saveQueue(this.queue.items);
		} finally {
			releaseLock();
		}
	}

	private async enqueueDLQ(action: Action): Promise<void> {
		const releaseLock = await this.mutex.acquire();
		try {
			this.dlQueue.enqueue(action);
			await this.persistence.saveDLQueue(this.dlQueue.items);
		} finally {
			releaseLock();
		}
	}

	get size(): number {
		return this.queue.size;
	}

	get dlQueueSize(): number {
		return this.dlQueue.size;
	}

	get peek(): Action[] {
		return this.queue.toArray();
	}

	get peekDLQ(): Action[] {
		return this.dlQueue.toArray();
	}
	
	get status(): string {
		return this.queueStatus;
	}
	
	get isProcessing(): boolean {
		return this.queueStatus === __PROCESSING__;
	}
	
	get listening(): boolean {
		return this.isListening;
	}

	public async clearDLQueue(): Promise<Action[]> {
		const releaseLock = await this.mutex.acquire();
		const items = this.dlQueue.toArray();
		try {
			this.dlQueue = new Queue([]);
			await this.persistence.saveDLQueue([]);
			return items;
		} catch (err) {
			this.dlQueue = new Queue(items);
			throw err;
		} finally {
			releaseLock();
		}
	}

	/**
	 * Processes a single action by looking up its hook and applying any transformer.
	 *
	 * Error handling semantics (via errorProcessor):
	 * - Return `true`:  The error is transient/retryable. The error is re-thrown,
	 *                   which stops the listener. The action stays at the head of the
	 *                   queue and will be retried on the next listen() call.
	 * - Return `false`: The error is permanent. The action is moved to the DLQ
	 *                   and processing continues with the next action.
	 */
	private async process(action: Action): Promise<void> {
		const {type, payload} = action;
		const hook = this.hooksRegistry[type];
		if (!hook) {
			await this.enqueueDLQ(action);
			return;
		}
		try {
			const transformedPayload = this.transformerRegistry[type]?.(payload) ?? payload;
			await hook(transformedPayload);
		} catch (err) {
			if (!this.errorProcessor(err as Error, action)) {
				await this.enqueueDLQ(action);
			} else {
				throw err;
			}
		}
	}

	private async initialize(): Promise<void> {
		const releaseLock = await this.mutex.acquire();
		const controller = new AbortController();
		try {
			let timeoutId: NodeJS.Timeout | undefined;
			await Promise.race([
				this.loadFromPersistence(controller.signal),
				new Promise<never>((_, reject) => {
					timeoutId = setTimeout(
						() => reject(new Error('Initialization timed out: persistence load took too long')),
						INIT_TIMEOUT_MS
					);
				})
			]);
			if (timeoutId) clearTimeout(timeoutId);
		} catch (err) {
			controller.abort();
			throw err;
		} finally {
			releaseLock();
		}
		this.resolveReady();
	}

	private async run(action: Action): Promise<void> {
		if (this.queueStatus === __PROCESSING__) return;
		this.queueStatus = __PROCESSING__;

		try {
			await this.process(action);
			await this.dequeue();
		} finally {
			this.queueStatus = __IDLE__;
		}
	}
}

// Queue instance is kept in the module scope to be shared across different parts of the app
let queueInstance: PatchyInternetQImpl | undefined;

export interface InitProps {
	hooksRegistry: Record<string, (payload: any) => Promise<void>>;
	transformerRegistry?: Record<string, (payload: any) => any>;
	persistence?: Persistence;
	errorProcessor?: (err: Error, action: Action) => boolean;
}

export const init = (
	{
		hooksRegistry,
		transformerRegistry,
		persistence,
		errorProcessor,
	}: InitProps
): PatchyInternetQImpl => {
	if (queueInstance) return queueInstance;

	queueInstance = new PatchyInternetQImpl(
		hooksRegistry,
		transformerRegistry ?? {},
		persistence ?? defaultPersistence,
		errorProcessor ?? defaultErrorProcessor
	);

	return queueInstance;
};

export const getQueue = (): PatchyInternetQImpl | undefined => queueInstance;

/**
 * Resets the singleton queue instance. Intended for testing.
 */
export const resetQueue = (): void => {
	queueInstance = undefined;
};

/**
 * Default persistence implementation.
 * WARNING: This is an in-memory/no-op default intended for testing only.
 * Callers must provide a production Persistence implementation for durable queues.
 * Methods saveQueue and saveDLQueue are no-ops.
 * Methods readQueue and readDLQueue return empty arrays.
 */
export const defaultPersistence: Persistence = {
	saveQueue: async (_actions: Action[]): Promise<void> => {},
	saveDLQueue: async (_actions: Action[]): Promise<void> => {},
	readQueue: async (): Promise<Action[]> => [],
	readDLQueue: async (): Promise<Action[]> => [],
};

/**
 * Default error processor: returns true to signal a transient/retryable error,
 * which pauses queue processing until the next listen() call.
 * Return false from your custom errorProcessor to move the action to the dead-letter queue.
 */
const defaultErrorProcessor = (_err: Error, _action: Action): boolean => true;