let operationIds = new Set<string>();
let generation = 0;

export function markCriterionOperation(operationId: string): void {
	operationIds.add(operationId);
	const current = ++generation;
	queueMicrotask(() => {
		if (generation === current) operationIds.clear();
	});
}

export function consumeCriterionOperations(): string[] {
	const consumed = [...operationIds];
	operationIds = new Set();
	generation++;
	return consumed;
}

export function trackOperationOutput<T extends { id: string; output: unknown }>(operation: T): T {
	const output = operation.output;
	Object.defineProperty(operation, "output", {
		configurable: true,
		enumerable: true,
		get() {
			markCriterionOperation(operation.id);
			return output;
		},
	});
	return operation;
}
