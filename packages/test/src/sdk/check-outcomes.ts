import { test } from "@playwright/test";

/**
 * How a labelled check's outcome travels from the worker to the reporter. Playwright names a check's
 * step after its matcher, not its label, so only the check itself can say which criterion it was.
 */
export const CHECK_OUTCOME_PREFIX = "@@agent-test-check:";
export interface CheckOutcome {
	criterion: string;
	passed: boolean;
}

function recording(): boolean {
	return process.env.AGENT_TEST_RECORDER === "1" || process.env.AGENT_TEST_VIEWER_EVENTS === "1";
}
/** This worker's own record of the running test's checks, for decisions made before it ends. */
const outcomesByAttempt = new Map<string, CheckOutcome[]>();
function attemptKey(): string | undefined {
	try {
		const { testId, retry } = test.info();
		return `${testId}:${retry}`;
	} catch {
		return undefined;
	}
}
function report(criterion: string, passed: boolean): void {
	const outcome: CheckOutcome = { criterion, passed };
	const key = attemptKey();
	if (key) outcomesByAttempt.set(key, [...(outcomesByAttempt.get(key) ?? []), outcome]);
	if (recording()) process.stdout.write(`${CHECK_OUTCOME_PREFIX}${JSON.stringify(outcome)}\n`);
}
/** The labelled checks the running test has reported so far. */
export function reportedOutcomes(): CheckOutcome[] {
	const key = attemptKey();
	return key ? (outcomesByAttempt.get(key) ?? []) : [];
}
/** Whether the check a control names is among those that failed. */
export function namedCheckFailed(mustFail: string, outcomes: CheckOutcome[]): boolean {
	return outcomes.some(({ criterion, passed }) => criterion === mustFail && !passed);
}
/** How many errors the test has so far. A soft check that fails adds one instead of throwing. */
function recordedErrors(): number | undefined {
	try {
		return test.info().errors.length;
	} catch {
		return undefined;
	}
}
function settled(call: () => unknown, criterion: string, soft: boolean): unknown {
	const before = soft ? recordedErrors() : undefined;
	const finish = (threw: boolean) =>
		report(criterion, !threw && (before === undefined || recordedErrors() === before));
	try {
		const result = call();
		if (!(result instanceof Promise)) {
			finish(false);
			return result;
		}
		return result.then(
			(value: unknown) => {
				finish(false);
				return value;
			},
			(error: unknown) => {
				finish(true);
				throw error;
			},
		);
	} catch (error) {
		finish(true);
		throw error;
	}
}
/** Matchers that report whether the labelled check passed, through `.not`, `.resolves` and `.rejects`. */
export function reportingOutcome<T>(matchers: T, criterion: unknown, soft: boolean): T {
	if (typeof criterion !== "string") return matchers;
	if (typeof matchers !== "object" || matchers === null) return matchers;
	return new Proxy(matchers, {
		get(target, property, receiver) {
			const value: unknown = Reflect.get(target, property, receiver);
			if (typeof value === "function")
				return (...argumentsList: unknown[]) =>
					settled(() => Reflect.apply(value, target, argumentsList), criterion, soft);
			return reportingOutcome(value, criterion, soft);
		},
	});
}
