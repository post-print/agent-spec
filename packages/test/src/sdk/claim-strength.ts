/**
 * What a result may claim given the conditions its runs recorded. A pass needs a host whose
 * enforcement a recent probe proved, a pinned model, and no user configuration reaching the run.
 * Anything less still reports what happened, but as indicative, not as a pass.
 */
type RecordLike = Record<string, unknown>;

function hostName(record: RecordLike): string {
	const version = typeof record.binaryVersion === "string" ? ` ${record.binaryVersion}` : "";
	const auth = typeof record.authMode === "string" ? ` under ${record.authMode} auth` : "";
	return `${String(record.host ?? "the host")}${version}${auth}`;
}
/** A condition a pass needs, which a suite may declare it accepts going without. */
export type AcceptedCondition =
	| "calibration"
	| "escape-battery"
	| "confinement"
	| "user-config"
	| "model";
export const ACCEPTABLE_CONDITIONS: readonly AcceptedCondition[] = [
	"calibration",
	"escape-battery",
	"confinement",
	"user-config",
	"model",
];
/**
 * What a suite owner declares it accepts, with why. Set in the config, never by an adapter, recorded
 * on every run, and refused by `--verdict-grade`. A run weak only on these ends as `accepted`.
 */
export interface AcceptedConditions {
	conditions: readonly AcceptedCondition[];
	reason: string;
}
export interface Weakness {
	condition: AcceptedCondition;
	/** In words a reader can act on. */
	reason: string;
}
/** Each condition a record falls short on. */
export function recordWeaknesses(record: RecordLike): Weakness[] {
	const host = hostName(record);
	const weak = (condition: AcceptedCondition, reason: string, holds: boolean): Weakness[] =>
		holds ? [] : [{ condition, reason }];
	const enforced = record.confinement === "host-enforced";
	return [
		...weak(
			"calibration",
			`${host} has no passing host probe from the last week`,
			record.calibrated === true,
		),
		...weak("model", "the model is not pinned", record.modelPinned === true),
		...weak(
			"user-config",
			`${host} may load the host's own user configuration`,
			record.userConfig === "excluded",
		),
		...weak("confinement", `${host} only detects escapes`, enforced),
		...weak(
			"escape-battery",
			`${host} has no escape battery from the last week in which every enforced vector held`,
			!enforced || record.confinementProven === true,
		),
	];
}
interface RecordedAttempt {
	operations: { data: unknown[] }[];
}
/** Every run record an attempt holds: its agent runs and its judges. */
export function attemptRecords(attempt: RecordedAttempt): RecordLike[] {
	return attempt.operations.flatMap(({ data }) =>
		data.flatMap((item) => {
			const record = (item as { record?: RecordLike } | null)?.record;
			return record ? [record] : [];
		}),
	);
}
function acceptedBy(record: RecordLike): AcceptedConditions | undefined {
	const accepted = record.accepted as AcceptedConditions | undefined;
	return accepted && Array.isArray(accepted.conditions) ? accepted : undefined;
}
/**
 * What keeps these attempts from carrying a pass: the weaknesses their suite did not accept, and
 * apart from them the ones it did, with its reasons. Both are empty when every record is strong.
 */
export function weighConditions(attempts: RecordedAttempt[]) {
	const weak = new Set<string>();
	const accepted = new Set<string>();
	const reasons = new Set<string>();
	for (const record of attempts.flatMap(attemptRecords)) {
		const declared = acceptedBy(record);
		for (const { condition, reason } of recordWeaknesses(record)) {
			if (!declared?.conditions.includes(condition)) weak.add(reason);
			else {
				accepted.add(reason);
				reasons.add(declared.reason);
			}
		}
	}
	return { weak: [...weak], accepted: [...accepted], reasons: [...reasons] };
}
