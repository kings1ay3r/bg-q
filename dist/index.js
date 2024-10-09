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
    constructor(hooksRegistry, transformerRegistry, persistence, verifyConnectivity, // Consumer's function to check network status
    errorProcessor // Consumer's error processor
    ) {
        this.isListening = false;
        this.queueStatus = __IDLE__;
        this.enqueue = (action) => {
            this.queue.enqueue(action);
            this.persistence.saveQueue(this.queue.items);
            this.listen();
        };
        this.dequeue = () => {
            this.queue.dequeue();
            this.persistence.saveQueue(this.queue.items);
        };
        this.enqueueDLQ = (action) => {
            this.dlQueue.enqueue(action);
            this.persistence.saveDLQueue(this.dlQueue.items);
        };
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
        this.loadFromPersistence(persistence);
        this.hooksRegistry = hooksRegistry;
        this.transformerRegistry = transformerRegistry;
        this.persistence = persistence;
        this.verifyConnectivity = verifyConnectivity;
        this.errorProcessor = errorProcessor;
        // No internal network listeners here, handled by consumer
    }
    loadFromPersistence(persistence) {
        return __awaiter(this, void 0, void 0, function* () {
            // TODO: Ensure queue boot is completed before enque is called.
            this.queue = new Queue(yield persistence.readQueue());
            this.dlQueue = new Queue(yield persistence.readDLQueue());
        });
    }
    process(action) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a, _b, _c;
            try {
                const { type, payload } = action;
                const { payload: transformedPayload, id } = (_c = (_b = (_a = this.transformerRegistry)[type]) === null || _b === void 0 ? void 0 : _b.call(_a, payload)) !== null && _c !== void 0 ? _c : payload;
                yield this.hooksRegistry[type]({ payload: transformedPayload, id });
            }
            catch (err) {
                if (!this.errorProcessor(err, action)) {
                    this.enqueueDLQ(action);
                    return;
                }
                throw err;
            }
        });
    }
    run() {
        return __awaiter(this, void 0, void 0, function* () {
            if (this.queueStatus === __PROCESSING__)
                return;
            const connectivity = yield this.verifyConnectivity();
            if (!this.queue.head || !connectivity)
                return;
            this.queueStatus = __PROCESSING__;
            try {
                yield this.process(this.queue.head);
                this.dequeue();
            }
            catch (err) {
                throw err;
            }
            finally {
                this.queueStatus = __IDLE__;
            }
        });
    }
}
exports.PatchyInternetQImpl = PatchyInternetQImpl;
let queueInstance;
const init = (hooksRegistry, transformerRegistry, persistence, verifyConnectivity, // Custom connectivity check
errorProcessor // Custom error processor
) => {
    if (queueInstance)
        return queueInstance;
    queueInstance = new PatchyInternetQImpl(hooksRegistry, transformerRegistry, persistence, verifyConnectivity, errorProcessor);
    return queueInstance;
};
exports.init = init;
const getQueue = () => queueInstance;
exports.getQueue = getQueue;
