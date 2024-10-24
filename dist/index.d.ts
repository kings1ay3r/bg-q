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
	private mutex;
	
	listen: () => Promise<void>;
	private process;
	
	private loadFromPersistence;
	private initialize;
	private run;
	private dequeue;
	private enqueueDLQ;
	
	get size(): number;
	
	get dlQueueSize(): number;
	
	constructor(hooksRegistry: Record<string, (payload: any) => Promise<void>>, transformerRegistry: Record<string, (payload: any) => any>, persistence: Persistence, errorProcessor: (err: Error, action: Action) => boolean);
	
	get ready(): Promise<void>;
	
	clearDLQueue(): Promise<Action[]>;
	
	get peek(): Action[];

	get peekDLQ(): Action[];

	enqueue(action: Action): Promise<void>;
}
export interface InitProps {
	hooksRegistry: Record<string, (payload: any) => Promise<void>>;
	transformerRegistry: Record<string, (payload: any) => any>;
	persistence: Persistence;
	errorProcessor: (err: Error, action: Action) => boolean;
}

export declare const init: ({
	                            hooksRegistry,
	                            transformerRegistry,
	                            persistence,
	                            errorProcessor,
                            }: InitProps) => Promise<PatchyInternetQImpl>;
export declare const getQueue: () => PatchyInternetQImpl;
