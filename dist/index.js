"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.defaultPersistence = exports.resetQueue = exports.getQueue = exports.init = exports.PatchyInternetQImpl = exports.__IDLE__ = exports.__PROCESSING__ = void 0;
const async_mutex_1 = require("async-mutex");
class Queue {
    constructor(items) {
        this._offset = 0;
        this._items = items;
    }
    get head() {
        return this._items[this._offset];
    }
    get size() {
        return this._items.length - this._offset;
    }
    get items() {
        return this._items.slice(this._offset);
    }
    enqueue(item) {
        this._items.push(item);
        return item;
    }
    dequeue() {
        if (this.size === 0)
            return undefined;
        const item = this._items[this._offset];
        this._offset++;
        // Optional: periodical cleanup of the array to reclaim memory
        if (this._offset * 2 > this._items.length) {
            this._items = this._items.slice(this._offset);
            this._offset = 0;
        }
        return item;
    }
    toArray() {
        return this.items;
    }
    setItems(items) {
        this._items = items;
        this._offset = 0;
    }
}
exports.__PROCESSING__ = 'processing';
exports.__IDLE__ = 'idle';
const INIT_TIMEOUT_MS = 5000;
class PatchyInternetQImpl {
    constructor(hooksRegistry, transformerRegistry, persistence, errorProcessor) {
        this.isListening = false;
        this.queueStatus = exports.__IDLE__;
        this.mutex = new async_mutex_1.Mutex();
        /**
         * Starts processing actions in the queue sequentially.
         * If already listening, this is a no-op.
         * Processing stops when the queue is empty or an error is re-thrown
         * (i.e., errorProcessor returns true for a transient/retryable error).
         */
        this.listen = async () => {
            if (this.isListening)
                return;
            this.isListening = true;
            try {
                while (this.isListening) {
                    const action = this.queue.head;
                    if (!action)
                        break;
                    try {
                        await this.run(action);
                    }
                    catch (err) {
                        // Error processor signaled transient error (run threw)
                        break;
                    }
                }
            }
            finally {
                this.isListening = false;
            }
        };
        this.queue = new Queue([]);
        this.dlQueue = new Queue([]);
        this.hooksRegistry = hooksRegistry;
        this.transformerRegistry = transformerRegistry;
        this.persistence = persistence;
        this.errorProcessor = errorProcessor;
        // Create the promise and capture both resolver and rejector
        this.readyPromise = new Promise((resolve, reject) => {
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
    async enqueue(action) {
        const releaseLock = await this.mutex.acquire();
        try {
            this.queue.enqueue(action);
            await this.persistence.saveQueue(this.queue.items);
        }
        finally {
            releaseLock();
        }
        this.listen().catch(() => { });
    }
    async loadFromPersistence(signal) {
        const queueData = await this.persistence.readQueue();
        if (signal === null || signal === void 0 ? void 0 : signal.aborted)
            return;
        this.queue = new Queue(queueData);
        const dlQueueData = await this.persistence.readDLQueue();
        if (signal === null || signal === void 0 ? void 0 : signal.aborted)
            return;
        this.dlQueue = new Queue(dlQueueData);
    }
    get ready() {
        return this.readyPromise;
    }
    async dequeue() {
        const releaseLock = await this.mutex.acquire();
        try {
            this.queue.dequeue();
            await this.persistence.saveQueue(this.queue.items);
        }
        finally {
            releaseLock();
        }
    }
    async enqueueDLQ(action) {
        const releaseLock = await this.mutex.acquire();
        try {
            this.dlQueue.enqueue(action);
            await this.persistence.saveDLQueue(this.dlQueue.items);
        }
        finally {
            releaseLock();
        }
    }
    get size() {
        return this.queue.size;
    }
    get dlQueueSize() {
        return this.dlQueue.size;
    }
    get peek() {
        return this.queue.toArray();
    }
    get peekDLQ() {
        return this.dlQueue.toArray();
    }
    get status() {
        return this.queueStatus;
    }
    get isProcessing() {
        return this.queueStatus === exports.__PROCESSING__;
    }
    get listening() {
        return this.isListening;
    }
    async clearDLQueue() {
        const releaseLock = await this.mutex.acquire();
        const items = this.dlQueue.toArray();
        try {
            this.dlQueue = new Queue([]);
            await this.persistence.saveDLQueue([]);
            return items;
        }
        catch (err) {
            this.dlQueue = new Queue(items);
            throw err;
        }
        finally {
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
    async process(action) {
        var _a, _b, _c;
        const { type, payload } = action;
        const hook = this.hooksRegistry[type];
        if (!hook) {
            await this.enqueueDLQ(action);
            return;
        }
        try {
            const transformedPayload = (_c = (_b = (_a = this.transformerRegistry)[type]) === null || _b === void 0 ? void 0 : _b.call(_a, payload)) !== null && _c !== void 0 ? _c : payload;
            await hook(transformedPayload);
        }
        catch (err) {
            if (!this.errorProcessor(err, action)) {
                await this.enqueueDLQ(action);
            }
            else {
                throw err;
            }
        }
    }
    async initialize() {
        const releaseLock = await this.mutex.acquire();
        const controller = new AbortController();
        try {
            let timeoutId;
            await Promise.race([
                this.loadFromPersistence(controller.signal),
                new Promise((_, reject) => {
                    timeoutId = setTimeout(() => reject(new Error('Initialization timed out: persistence load took too long')), INIT_TIMEOUT_MS);
                })
            ]);
            if (timeoutId)
                clearTimeout(timeoutId);
        }
        catch (err) {
            controller.abort();
            throw err;
        }
        finally {
            releaseLock();
        }
        this.resolveReady();
    }
    async run(action) {
        if (this.queueStatus === exports.__PROCESSING__)
            return;
        this.queueStatus = exports.__PROCESSING__;
        try {
            await this.process(action);
            await this.dequeue();
        }
        finally {
            this.queueStatus = exports.__IDLE__;
        }
    }
}
exports.PatchyInternetQImpl = PatchyInternetQImpl;
// Queue instance is kept in the module scope to be shared across different parts of the app
let queueInstance;
const init = ({ hooksRegistry, transformerRegistry, persistence, errorProcessor, }) => {
    if (queueInstance)
        return queueInstance;
    queueInstance = new PatchyInternetQImpl(hooksRegistry, transformerRegistry !== null && transformerRegistry !== void 0 ? transformerRegistry : {}, persistence !== null && persistence !== void 0 ? persistence : exports.defaultPersistence, errorProcessor !== null && errorProcessor !== void 0 ? errorProcessor : defaultErrorProcessor);
    return queueInstance;
};
exports.init = init;
const getQueue = () => queueInstance;
exports.getQueue = getQueue;
/**
 * Resets the singleton queue instance. Intended for testing.
 */
const resetQueue = () => {
    queueInstance = undefined;
};
exports.resetQueue = resetQueue;
/**
 * Default persistence implementation.
 * WARNING: This is an in-memory/no-op default intended for testing only.
 * Callers must provide a production Persistence implementation for durable queues.
 * Methods saveQueue and saveDLQueue are no-ops.
 * Methods readQueue and readDLQueue return empty arrays.
 */
exports.defaultPersistence = {
    saveQueue: async (_actions) => { },
    saveDLQueue: async (_actions) => { },
    readQueue: async () => [],
    readDLQueue: async () => [],
};
/**
 * Default error processor: returns true to signal a transient/retryable error,
 * which pauses queue processing until the next listen() call.
 * Return false from your custom errorProcessor to move the action to the dead-letter queue.
 */
const defaultErrorProcessor = (_err, _action) => true;
