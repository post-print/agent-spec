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
function report(criterion: string, passed: boolean): void {
	const outcome: CheckOutcome = { criterion, passed };
	process.stdout.write(`${CHECK_OUTCOME_PREFIX}${JSON.stringify(outcome)}\n`);
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
	if (typeof criterion !== "string" || !recording()) return matchers;
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
