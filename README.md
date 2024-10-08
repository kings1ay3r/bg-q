# Background Queue (bg-q)

A versatile JavaScript/TypeScript library for managing server actions in sequence, especially when actions are interdependent. This queue-based system allows you to queue actions with specific payloads and ensures that they are executed in a controlled manner. Each action can transform its payload just before execution, making it a flexible tool for complex workflows where actions depend on responses from prior actions.

## Features

- Sequential Execution: Ensures that server actions are executed one after another, in the order they are enqueued.
- Just-in-time Transformation: Ability to transform payloads just before execution based on specific logic.
- Error Handling: Customizable error handling that allows failed actions to be retried, added to a dead-letter queue, or handled as per your needs.
- Persistent Queue: Store and retrieve queued actions using your own persistence layer.
- Flexible Connectivity Check: Pass your own function to check network connectivity and manage retries.
- Minimal Dependencies: This package is free from platform-specific dependencies and can work in any JavaScript environment.

## Installation

You can install the package via npm or yarn:
`npm install bg-q` or `yarn add bg-q`

## Usage

1. Initialization
   
    The package is initialized in your application. You must provide:

   - A registry of hooks that define how actions are processed.
   - A transformer registry for just-in-time payload transformation.
   - A persistence object for storing and retrieving queue actions.
   - Optional network connectivity and error processing functions to manage retries and failures.

   ```ts
   import {
     init,
     getQueue,
     Action,
     Persistence,
   } from 'bg-q ';

   // Define how each action type should be handled
   const hooksRegistry = {
     ACTION_TYPE_1: async (payload) => {
       // Logic to execute for this action
     },
     ACTION_TYPE_2: async (payload) => {
       // Logic for another action type
     },
   };

   // Define payload transformers for just-in-time transformations
   const transformerRegistry = {
     ACTION_TYPE_1: (payload) => {
       return { ...payload, transformedKey: 'transformedValue' };
     },
   };

   // Implement persistence methods
   const persistence: Persistence = {
     saveQueue: async (queue) => {
       // Save the current state of the queue
     },
     saveDLQueue: async (dlQueue) => {
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

   // Initialize the queue with registries and persistence layer
   const queue = init(hooksRegistry, transformerRegistry, persistence);

   // Now you can access the queue instance via getQueue()
   ```

2. Enqueue Actions
   
    You can add actions to the queue using the enqueue() method. Each action should have a type and a payload. These actions will be processed in sequence, and the payloads can be transformed just before execution.

   ```ts
   const action: Action = {
     type: 'ACTION_TYPE_1',
     payload: { someKey: 'someValue' },
   };

   // Enqueue the action
   queue.enqueue(action);
   ```

3. Connectivity Check 
   
    If your application is reliant on network status, you can pass a custom connectivity function to determine if the queue should be processed.

      ```ts
      const checkNetworkConnectivity = () => {
        // Your logic to check if the network is available
        return navigator.onLine;
      };

      // Initialize the queue with a custom connectivity check function
      const queue = init(
        hooksRegistry,
        transformerRegistry,
        persistence,
        checkNetworkConnectivity
      );
      ```

4. Error Handling
   You can provide custom error-handling logic by passing a function that decides how errors should be processed. For example, retry failed actions, move them to a dead-letter queue, or handle them as per your use case.

   ```ts
   const processError = (error, action) => {
     if (error instanceof SomeKnownError) {
       // Retry or handle action
       return true; // Return true to retry
     }
     return false; // Move to dead-letter queue or discard
   };

   // Initialize with error handling logic
   const queue = init(
     hooksRegistry,
     transformerRegistry,
     persistence,
     checkNetworkConnectivity,
     processError
   );
   ```

5. Accessing the Queue
   Once the queue is initialized, you can access it using getQueue() and interact with it.

   ```ts
   const queue = getQueue();
   console.log(queue.queueSize); // Get the current size of the queue
   ```

6. Persistence
   The Persistence interface defines methods to save and read the queue and dead-letter queue. You need to implement this based on your app's storage requirements (e.g., local storage, database).

   ```ts
   export type Persistence = {
     saveQueue: (actions: Action[]) => Promise<void>;
     saveDLQueue: (actions: Action[]) => Promise<void>;
     readQueue: () => Promise<Action[]>;
     readDLQueue: () => Promise<Action[]>;
   };
   ```

7. Dead-Letter Queue (DLQ)
   If an action fails multiple times (depending on your error-handling logic), it will be moved to the dead-letter queue (DLQ). You can access the DLQ and take appropriate actions (e.g., logging, manual retries, etc.).

   ```ts
   queue.readDLQueue().then((dlQueue) => {
     console.log('Failed actions in DLQ:', dlQueue);
   });
   ```

## API Reference


Initializes the queue with the necessary registries, persistence layer, and optional functions.

`init(hooksRegistry, transformerRegistry, persistence, checkNetworkConnectivity, processError)`

* `hooksRegistry`: A dictionary where the key is the action type, and the value is the function that handles the action.
* `transformerRegistry`: A dictionary where the key is the action type, and the value is a function to transform the payload just before execution.
* `persistence`: An object implementing the Persistence interface to save and load the queue.
* `checkNetworkConnectivity` (optional): A function to verify network availability.
* `processError` (optional): A function to process errors and decide whether to retry or move the action to DLQ.


`enqueue(action: Action)`: Enqueues an action to the queue for sequential execution.
* `action`: The action to be added to the queue. It must have a type and payload.

`getQueue()`: Returns the current instance of the queue for interaction.

`queueSize`
Returns the current number of actions in the queue.

`readDLQueue()`
Reads and returns the actions in the dead-letter queue (DLQ).

## Example Usage

Here is a basic example that demonstrates how to use the library:

```ts
import { init, Action, getQueue } from 'bg-q';

// Define your hooks and transformer registries
const hooksRegistry = {
  FETCH_USER: async (payload) => {
    /* fetch user logic */
  },
  UPDATE_USER: async (payload) => {
    /* update user logic */
  },
};

const transformerRegistry = {
  FETCH_USER: (payload) => ({ ...payload, extraData: 'value' }),
};

// Define persistence layer
const persistence = {
  saveQueue: async (queue) => {
    /* save queue */
  },
  saveDLQueue: async (dlQueue) => {
    /* save DL queue */
  },
  readQueue: async () => [],
  readDLQueue: async () => [],
};

// Initialize the queue
const queue = init(hooksRegistry, transformerRegistry, persistence);

// Enqueue an action
const action: Action = {
  type: 'FETCH_USER',
  payload: { userId: 123 },
};

queue.enqueue(action);

// Access queue instance
const queueInstance = getQueue();
console.log(queueInstance.queueSize); // Get the size of the queue
```

## License

This library is licensed under the MIT License.
