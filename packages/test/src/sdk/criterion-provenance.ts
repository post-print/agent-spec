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

/**
 * Operations whose evidence the test has read, and those a check ran on after that. A pass needs
 * one checked operation: a run nobody looked at says nothing about the agent.
 */
const readOperations = new Set<string>();
const checkedOperations = new Set<string>();
/** What the agent produced or did. The prompt and conditions are the test's, not evidence. */
const EVIDENCE_FIELDS = ["trace", "conversation", "toolCalls", "workspace", "environment", "usage"];

/** A check ran: every operation read so far, and the one it was handed, have been checked. */
export function noteCheck(checkedId: string | undefined): void {
	for (const id of readOperations) checkedOperations.add(id);
	if (checkedId) checkedOperations.add(checkedId);
}
export function wasChecked(operationId: string): boolean {
	return checkedOperations.has(operationId);
}
function readOnAccess(operation: { id: string }, field: string, onRead?: () => void): void {
	const value = (operation as Record<string, unknown>)[field];
	Object.defineProperty(operation, field, {
		configurable: true,
		enumerable: true,
		get() {
			readOperations.add(operation.id);
			onRead?.();
			return value;
		},
	});
}
export function trackOperationOutput<T extends { id: string; output: unknown }>(operation: T): T {
	readOnAccess(operation, "output", () => markCriterionOperation(operation.id));
	for (const field of EVIDENCE_FIELDS) if (field in operation) readOnAccess(operation, field);
	return operation;
}
