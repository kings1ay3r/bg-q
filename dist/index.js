"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resetQueue = exports.getQueue = exports.init = exports.PatchyInternetQImpl = void 0;
const async_mutex_1 = require("async-mutex");
class Queue {
    constructor(items) {
        this._items = items;
    }
    get head() {
        return this._items[0];
    }
    get size() {
        return this._items.length;
    }
    get items() {
        return this._items;
    }
    enqueue(item) {
        this._items.push(item);
        return item;
    }
    dequeue() {
        return this._items.shift();
    }
    toArray() {
        return [...this._items];
    }
}
const __PROCESSING__ = 'processing';
const __IDLE__ = 'idle';
const INIT_TIMEOUT_MS = 5000;
class PatchyInternetQImpl {
    constructor(hooksRegistry, transformerRegistry, persistence, errorProcessor) {
        this.isListening = false;
        this.queueStatus = __IDLE__;
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
            while (this.queue.head && this.isListening) {
                try {
                    await this.run();
                }
                catch (err) {
                    this.isListening = false;
                    return;
                }
            }
            this.isListening = false;
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
    async loadFromPersistence() {
        this.queue = new Queue(await this.persistence.readQueue());
        this.dlQueue = new Queue(await this.persistence.readDLQueue());
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
        try {
            const { type, payload } = action;
            const hook = this.hooksRegistry[type];
            if (!hook) {
                throw new Error(`No hook registered for action type: "${type}"`);
            }
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
        try {
            let timeoutId;
            await Promise.race([
                this.loadFromPersistence(),
                new Promise((_, reject) => {
                    timeoutId = setTimeout(() => reject(new Error('Initialization timed out: persistence load took too long')), INIT_TIMEOUT_MS);
                })
            ]);
            if (timeoutId)
                clearTimeout(timeoutId);
        }
        finally {
            releaseLock();
        }
        this.resolveReady();
    }
    async run() {
        if (this.queueStatus === __PROCESSING__)
            return;
        if (!this.queue.head)
            return;
        this.queueStatus = __PROCESSING__;
        try {
            await this.process(this.queue.head);
            await this.dequeue();
        }
        finally {
            this.queueStatus = __IDLE__;
        }
    }
}
exports.PatchyInternetQImpl = PatchyInternetQImpl;
// Queue instance is kept in the module scope to be shared across different parts of the app
let queueInstance;
const init = async ({ hooksRegistry, transformerRegistry, persistence, errorProcessor, }) => {
    if (queueInstance)
        return queueInstance;
    queueInstance = new PatchyInternetQImpl(hooksRegistry, transformerRegistry !== null && transformerRegistry !== void 0 ? transformerRegistry : {}, persistence !== null && persistence !== void 0 ? persistence : defaultPersistence, errorProcessor !== null && errorProcessor !== void 0 ? errorProcessor : defaultErrorProcessor);
    await queueInstance.ready;
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
const defaultPersistence = {
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
