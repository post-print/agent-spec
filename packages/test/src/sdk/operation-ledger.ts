import { WorkspaceEscapeError } from "@post-print/agent-harness";
import { wasChecked } from "./criterion-provenance.js";
import { isInfrastructureFailure } from "./failure.js";
import type { Run } from "./types.js";

/** A promise that knows whether the test ever looked at its outcome, however late. */
class ObservedOperation<T> extends Promise<T> {
	static override get [Symbol.species]() {
		return Promise;
	}
	observed = false;
	// biome-ignore lint/suspicious/noThenProperty: await and Promise.all only reach a subclass through then, which is how observation is detected.
	override then<A = T, B = never>(
		onFulfilled?: ((value: T) => A | PromiseLike<A>) | null,
		onRejected?: ((reason: unknown) => B | PromiseLike<B>) | null,
	): Promise<A | B> {
		this.observed = true;
		return super.then(onFulfilled, onRejected);
	}
}

/** The test did not earn a result, so it says nothing about the agent either way. */
export class UnearnedResultError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "UnearnedResultError";
	}
}

const acknowledgedEscapes = new WeakSet<WorkspaceEscapeError>();

export interface WorkspaceEscapeOutcome {
	escaped?: WorkspaceEscapeError;
	run?: Run;
}
/**
 * The one way a test accepts a workspace escape. Any other caught escape still fails the test.
 * Without `allowRefusal`, a run that made no attempt fails too.
 */
export async function expectWorkspaceEscape(
	operation: Promise<Run>,
	options: { allowRefusal?: boolean } = {},
): Promise<WorkspaceEscapeOutcome> {
	try {
		const run = await operation;
		if (options.allowRefusal) return { run };
	} catch (error) {
		if (!(error instanceof WorkspaceEscapeError)) throw error;
		acknowledgedEscapes.add(error);
		return { escaped: error };
	}
	throw new Error("Expected the run to fail with WorkspaceEscapeError, but it completed");
}

type OperationState = "pending" | "fulfilled" | "rejected";

/** Every agent and judge operation of one test, so a result can only come from work that happened. */
export class OperationLedger {
	private readonly operations: {
		operation: ObservedOperation<unknown>;
		state: OperationState;
		/** The run or evaluation it produced, so a check on it can be found. */
		id?: string;
	}[] = [];
	private readonly escapes = new Set<WorkspaceEscapeError>();
	private infrastructureFailed = false;
	private hostStarted = false;

	record<T>(underlying: Promise<T>): Promise<T> {
		const operation = new ObservedOperation<T>((resolve, reject) => {
			underlying.then(resolve, reject);
		});
		const entry: (typeof this.operations)[number] = { operation, state: "pending" };
		this.operations.push(entry);
		// Internal bookkeeping must not count as the test observing the outcome.
		Promise.prototype.then.call(operation, undefined, () => undefined);
		underlying.then(
			(value) => {
				entry.state = "fulfilled";
				const { id } = (value ?? {}) as { id?: unknown };
				if (typeof id === "string") entry.id = id;
			},
			(error: unknown) => {
				entry.state = "rejected";
				if (error instanceof WorkspaceEscapeError) this.escapes.add(error);
				if (isInfrastructureFailure(error)) this.infrastructureFailed = true;
			},
		);
		return operation;
	}

	/** Whether any operation failed for a reason that says nothing about the agent. */
	reportedInfrastructureFailure(): boolean {
		return this.infrastructureFailed;
	}

	noteHostStarted(): void {
		this.hostStarted = true;
	}

	/** A test that failed before any host was asked anything failed in its own setup. */
	failedBeforeAnyHostStarted(): boolean {
		return !this.hostStarted;
	}

	/** Throws when the test body finished without earning its result. */
	assertResultEarned(options: { noAgent: boolean }): void {
		this.assertNoFloatingOperation();
		const escapes = [...this.escapes];
		const unacknowledged = escapes.find((error) => !acknowledgedEscapes.has(error));
		if (unacknowledged) throw unacknowledged;
		if (options.noAgent || escapes.length > 0) return;
		const fulfilled = this.operations.filter(({ state }) => state === "fulfilled");
		if (fulfilled.length === 0)
			throw new UnearnedResultError(
				"The test finished without a completed agent operation, so its result says nothing about an agent. Declare noAgent: true if that is intended.",
			);
		if (!fulfilled.some(({ id }) => id !== undefined && wasChecked(id)))
			throw new UnearnedResultError(
				"The test passed without a check on any agent or judge result, so its result says nothing about an agent. Check a run or evaluation with agent-test's expect after reading it.",
			);
	}

	private assertNoFloatingOperation(): void {
		const floating = this.operations.filter(
			({ operation, state }) => state !== "fulfilled" && !operation.observed,
		);
		if (floating.length > 0)
			throw new UnearnedResultError(
				`${floating.length} agent operation(s) were not awaited and did not complete. Await each run, or handle its rejection.`,
			);
	}
}
