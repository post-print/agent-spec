import type { AssertionFailure, FailureCategory } from "./types.js";

/** Construct a typed assertion failure with a required category. */
export function assertionFailure(
	matcher: string,
	message: string,
	category: FailureCategory,
	evidence?: string,
): AssertionFailure {
	return evidence === undefined
		? { matcher, message, category }
		: { matcher, message, category, evidence };
}
