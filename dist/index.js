"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getQueue = exports.init = exports.PatchyInternetQImpl = void 0;
const async_mutex_1 = require("async-mutex");
class Queue {
    constructor(items) {
        this.items = items;
    }
    get head() {
        return this.items[0];
    }
    get size() {
        return this.items.length;
    }
    enqueue(item) {
        this.items.push(item);
        return item;
    }
    dequeue() {
        return this.items.shift();
    }
}
const __PROCESSING__ = 'processing';
const __IDLE__ = 'idle';
class PatchyInternetQImpl {
    constructor(hooksRegistry, transformerRegistry, persistence, errorProcessor) {
        this.isListening = false;
        this.queueStatus = __IDLE__;
        this.mutex = new async_mutex_1.Mutex();
        this.listen = () => __awaiter(this, void 0, void 0, function* () {
            if (this.isListening)
                return;
            this.isListening = true;
            while (this.queue.head && this.isListening) {
                try {
                    yield this.run();
                }
                catch (err) {
                    // TODO: Implement logger
                    console.log('queue.run:error', err);
                    this.isListening = false;
                    return;
                }
            }
            this.isListening = false;
        });
        this.queue = new Queue([]);
        this.dlQueue = new Queue([]);
        this.hooksRegistry = hooksRegistry;
        this.transformerRegistry = transformerRegistry;
        this.persistence = persistence;
        this.errorProcessor = errorProcessor;
        // Create the promise and capture the resolver
        this.readyPromise = new Promise((resolve) => {
            this.resolveReady = resolve;
        });
        // Start loading persistence data and set ready status
        this.initialize().then(() => {
            this.listen().then(() => {
            });
        });
    }
    initialize() {
        return __awaiter(this, void 0, void 0, function* () {
            const releaseLock = yield Promise.race([
                this.mutex.acquire(),
                new Promise((_, reject) => setTimeout(() => reject(new Error('mutex acquisition timeout')), 5000))
            ]);
            try {
                yield this.loadFromPersistence();
            }
            finally {
                releaseLock(); // Ensure the lock is released after initialization
            }
            this.resolveReady(); // Resolve ready promise once data is loaded
        });
    }
    loadFromPersistence() {
        return __awaiter(this, void 0, void 0, function* () {
            this.queue = new Queue(yield this.persistence.readQueue());
            this.dlQueue = new Queue(yield this.persistence.readDLQueue());
        });
    }
    get ready() {
        return this.readyPromise;
    }
    enqueue(action) {
        return __awaiter(this, void 0, void 0, function* () {
            const releaseLock = yield this.mutex.acquire();
            try {
                this.queue.enqueue(action);
                yield this.persistence.saveQueue(this.queue.items);
            }
            finally {
                releaseLock();
                this.listen().then();
            }
        });
    }
    dequeue() {
        return __awaiter(this, void 0, void 0, function* () {
            const releaseLock = yield this.mutex.acquire();
            try {
                this.queue.dequeue();
                yield this.persistence.saveQueue(this.queue.items);
            }
            finally {
                releaseLock();
            }
        });
    }
    enqueueDLQ(action) {
        return __awaiter(this, void 0, void 0, function* () {
            const releaseLock = yield this.mutex.acquire();
            try {
                this.dlQueue.enqueue(action);
                yield this.persistence.saveDLQueue(this.dlQueue.items);
            }
            finally {
                releaseLock();
            }
        });
    }

    // TODO: Implement public function to clear DLQ
    process(action) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a, _b, _c;
            try {
                const { type, payload } = action;
                const transformedPayload = (_c = (_b = (_a = this.transformerRegistry)[type]) === null || _b === void 0 ? void 0 : _b.call(_a, payload)) !== null && _c !== void 0 ? _c : payload;
                yield this.hooksRegistry[type](transformedPayload);
            }
            catch (err) {
                if (!this.errorProcessor(err, action)) {
                    yield this.enqueueDLQ(action);
                }
                else {
                    throw err;
                }
            }
        });
    }
    run() {
        return __awaiter(this, void 0, void 0, function* () {
            if (this.queueStatus === __PROCESSING__)
                return;
            if (!this.queue.head)
                return;
            this.queueStatus = __PROCESSING__;
            try {
                yield this.process(this.queue.head);
                yield this.dequeue();
            }
            finally {
                this.queueStatus = __IDLE__;
            }
        });
    }
}
exports.PatchyInternetQImpl = PatchyInternetQImpl;
// Queue instance is kept in the module scope to be shared across different parts of the app
let queueInstance;
const init = (_a) => __awaiter(void 0, [_a], void 0, function* ({
                                                                    hooksRegistry,
                                                                    transformerRegistry,
                                                                    persistence,
                                                                    errorProcessor,
                                                                }) {
    if (queueInstance)
        return queueInstance;
    queueInstance = new PatchyInternetQImpl(hooksRegistry, transformerRegistry, persistence, errorProcessor);
    yield queueInstance.ready;
    return queueInstance;
});
exports.init = init;
const getQueue = () => queueInstance;
exports.getQueue = getQueue;
