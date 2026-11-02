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
/** Each condition a record falls short on, in words a reader can act on. */
export function recordWeaknesses(record: RecordLike): string[] {
	const host = hostName(record);
	return [
		...(record.calibrated === true ? [] : [`${host} has no passing host probe from the last week`]),
		...(record.modelPinned === true ? [] : ["the model is not pinned"]),
		...(record.userConfig === "excluded"
			? []
			: [`${host} may load the host's own user configuration`]),
		...(record.confinement === "host-enforced" ? [] : [`${host} only detects escapes`]),
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
/** What keeps these attempts from carrying a pass. Empty when every record is strong. */
export function weaknesses(attempts: RecordedAttempt[]): string[] {
	return [...new Set(attempts.flatMap(attemptRecords).flatMap(recordWeaknesses))];
}
