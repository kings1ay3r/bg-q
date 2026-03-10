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
export declare class PatchyInternetQImpl {
    private queue;
    private dlQueue;
    private isListening;
    private queueStatus;
    private readonly hooksRegistry;
    private readonly transformerRegistry;
    private persistence;
    private readonly errorProcessor;
    private readonly readyPromise;
    private resolveReady;
    private rejectReady;
    private mutex;
    constructor(hooksRegistry: Record<string, (payload: any) => Promise<void>>, transformerRegistry: Record<string, (payload: any) => any>, persistence: Persistence, errorProcessor: (err: Error, action: Action) => boolean);
    enqueue(action: Action): Promise<void>;
    private loadFromPersistence;
    get ready(): Promise<void>;
    /**
     * Starts processing actions in the queue sequentially.
     * If already listening, this is a no-op.
     * Processing stops when the queue is empty or an error is re-thrown
     * (i.e., errorProcessor returns true for a transient/retryable error).
     */
    listen: () => Promise<void>;
    private dequeue;
    private enqueueDLQ;
    get size(): number;
    get dlQueueSize(): number;
    get peek(): Action[];
    get peekDLQ(): Action[];
    clearDLQueue(): Promise<Action[]>;
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
    private process;
    private initialize;
    private run;
}
export interface InitProps {
    hooksRegistry: Record<string, (payload: any) => Promise<void>>;
    transformerRegistry?: Record<string, (payload: any) => any>;
    persistence?: Persistence;
    errorProcessor?: (err: Error, action: Action) => boolean;
}
export declare const init: ({ hooksRegistry, transformerRegistry, persistence, errorProcessor, }: InitProps) => Promise<PatchyInternetQImpl>;
export declare const getQueue: () => PatchyInternetQImpl | undefined;
/**
 * Resets the singleton queue instance. Intended for testing.
 */
export declare const resetQueue: () => void;
