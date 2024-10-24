# Example node implimentation

```ts
import { init, getQueue } from 'qbg';

// Define how each action type should be handled
const hooksRegistry = {
	ACTION_TYPE_1: async (payload: { seq: any; delay: number; key: any }) => {
		console.log('processing item:', payload.seq);
		if (Math.random() < 0.5) throw new Error('some error');
		await sleep(payload.delay * 100);
		console.log(
			`${String(payload.seq).padEnd(5)}(Action 1) \t ${String(
				payload.key
			).padEnd(15)} \t - Delay ${String(payload.delay).padStart(2)} seconds`
		);
	},
	ACTION_TYPE_2: async (payload: { seq: any; delay: number; key: any }) => {
		console.log('processing item:', payload.seq);
		if (Math.random() < 0.5) throw new Error('some error');
		await sleep(payload.delay * 100);
		console.log(
			`${String(payload.seq).padEnd(5)}(Action 2) \t ${String(
				payload.key
			).padEnd(15)} \t - Delay ${String(payload.delay).padStart(2)} seconds`
		);
	},
};

// Define payload transformers for just-in-time transformations
const transformerRegistry = {
	ACTION_TYPE_1: (payload: { delay: number }) => {
		return { ...payload, delay: 10 - payload.delay };
	},
};

// Implement persistence methods
const persistence = {
	saveQueue: async (queue: []) => {
		// Save the current state of the queue
	},
	saveDLQueue: async (dlQueue: []) => {
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

const errorProcessor = (err: any) => {
	if (Math.random() < 0.5) {
		console.log('pushing to DLQ');
		return false;
	}
	console.log('pause processing');
	return true;
};
const sleep = (ms: number | undefined) => {
	return new Promise((resolve) => setTimeout(resolve, ms));
};
async function main() {
	// Initialize the queue with registries and persistence layer
	const queue = await init({
		hooksRegistry,
		transformerRegistry,
		persistence,
		errorProcessor,
	});
	sleep(3000);
	
	const actions = [
		{ type: 'ACTION_TYPE_1', payload: { key: 'Emily', seq: 1, delay: 6 } },
		{ type: 'ACTION_TYPE_2', payload: { key: 'Sophia', seq: 2, delay: 2 } },
		{ type: 'ACTION_TYPE_1', payload: { key: 'Olivia', seq: 3, delay: 8 } },
		{ type: 'ACTION_TYPE_2', payload: { key: 'Emma', seq: 4, delay: 3 } },
		{ type: 'ACTION_TYPE_1', payload: { key: 'Liam', seq: 5, delay: 5 } },
		{ type: 'ACTION_TYPE_2', payload: { key: 'Noah', seq: 6, delay: 4 } },
		{ type: 'ACTION_TYPE_1', payload: { key: 'Mason', seq: 7, delay: 7 } },
		{ type: 'ACTION_TYPE_2', payload: { key: 'Aiden', seq: 8, delay: 9 } },
		{ type: 'ACTION_TYPE_1', payload: { key: 'Amelia', seq: 9, delay: 3 } },
		{ type: 'ACTION_TYPE_2', payload: { key: 'Harper', seq: 10, delay: 6 } },
		{ type: 'ACTION_TYPE_1', payload: { key: 'Evelyn', seq: 11, delay: 5 } },
		{ type: 'ACTION_TYPE_2', payload: { key: 'James', seq: 12, delay: 8 } },
		{ type: 'ACTION_TYPE_1', payload: { key: 'Ella', seq: 13, delay: 4 } },
		{ type: 'ACTION_TYPE_2', payload: { key: 'Scarlett', seq: 14, delay: 7 } },
		{ type: 'ACTION_TYPE_1', payload: { key: 'Grace', seq: 15, delay: 2 } },
		{ type: 'ACTION_TYPE_2', payload: { key: 'Chloe', seq: 16, delay: 9 } },
		{ type: 'ACTION_TYPE_1', payload: { key: 'Lily', seq: 17, delay: 6 } },
		{ type: 'ACTION_TYPE_2', payload: { key: 'Benjamin', seq: 18, delay: 1 } },
		{ type: 'ACTION_TYPE_1', payload: { key: 'Sofia', seq: 19, delay: 7 } },
		{ type: 'ACTION_TYPE_2', payload: { key: 'Aria', seq: 20, delay: 3 } },
		{ type: 'ACTION_TYPE_1', payload: { key: 'Jackson', seq: 21, delay: 4 } },
		{ type: 'ACTION_TYPE_2', payload: { key: 'Ellie', seq: 22, delay: 8 } },
		{ type: 'ACTION_TYPE_1', payload: { key: 'Zoe', seq: 23, delay: 5 } },
		{ type: 'ACTION_TYPE_2', payload: { key: 'Riley', seq: 24, delay: 2 } },
		{ type: 'ACTION_TYPE_1', payload: { key: 'Lucas', seq: 25, delay: 9 } },
		{ type: 'ACTION_TYPE_2', payload: { key: 'Hannah', seq: 26, delay: 7 } },
		{ type: 'ACTION_TYPE_1', payload: { key: 'Penelope', seq: 27, delay: 6 } },
		{ type: 'ACTION_TYPE_2', payload: { key: 'Layla', seq: 28, delay: 5 } },
		{ type: 'ACTION_TYPE_1', payload: { key: 'Nora', seq: 29, delay: 3 } },
		{ type: 'ACTION_TYPE_2', payload: { key: 'Camila', seq: 30, delay: 4 } },
	];
	
	actions.map((item) => queue.enqueue(item));
	
	await sleep(3000);
	console.log('calling listen', queue.size);
	queue.listen();
	console.log('calling listen', queue.size);
	
	while (queue.size) {
		await sleep(1000);
		console.log('calling listen', queue.size);
		getQueue().listen();
	}
	console.log('end of process Q size', queue.size);
	console.log('end of process DLQ size', queue.dlQueueSize);
}
main();


```