import { assertionFailure } from "./failures.js";
import type {
	AgentScenario,
	AssertionFailure,
	CompareArm,
	CompareArmId,
	CompareArmResult,
	CompareMetricGate,
	CompareMetricPair,
	ScenarioCompare,
	ScenarioCompareResult,
	ScenarioRubric,
} from "./types.js";

const RUBRIC_ARRAY_KEYS = [
	"must",
	"mustNot",
	"mustRun",
	"mustCallTool",
	"mustNotCallTool",
	"mustReadPath",
	"mustNotReadPath",
	"mustInvokeSkill",
	"mustNotInvokeSkill",
] as const;

const COMPARE_ARM_ID_PATTERN = /^[a-z][a-z0-9_-]{0,63}$/;

export interface ResolvedCompareArm {
	id: CompareArmId;
	arm: CompareArm;
}

export interface CompareStoryArm {
	id: CompareArmId;
	label: string;
	description?: string;
	rubric?: ScenarioRubric;
	trace?: CompareArmResult["trace"];
	durationMs?: number;
}

export interface CompareStoryFields {
	arms: CompareStoryArm[];
	faster?: CompareMetricPair[];
	cheaper?: CompareMetricPair[];
	aLabel: string;
	bLabel: string;
	aDescription?: string;
	bDescription?: string;
	aRubric?: ScenarioRubric;
	bRubric?: ScenarioRubric;
}

/** Append arm-only array checks. Keep the shared judge on the scenario rubric. */
export function mergeArmRubric(base: ScenarioRubric, overlay?: ScenarioRubric): ScenarioRubric {
	if (!overlay) {
		return base;
	}
	const merged: ScenarioRubric = {
		...base,
		tier: overlay.tier ?? base.tier,
		handsOnRouting: overlay.handsOnRouting ?? base.handsOnRouting,
		routingBlock: overlay.routingBlock ?? base.routingBlock,
		reviewDepth: overlay.reviewDepth ?? base.reviewDepth,
		judge: base.judge,
	};
	for (const key of RUBRIC_ARRAY_KEYS) {
		const extra = overlay[key];
		if (extra !== undefined) {
			merged[key] = [...(base[key] ?? []), ...extra];
		}
	}
	return merged;
}

export function parseCompareArmId(value: unknown): CompareArmId | undefined {
	if (typeof value !== "string") {
		return undefined;
	}
	const id = value.trim();
	return COMPARE_ARM_ID_PATTERN.test(id) ? id : undefined;
}

export function compareArmLabel(arm: CompareArm | undefined, side: CompareArmId): string {
	const label = arm?.label?.trim();
	if (label) {
		return label;
	}
	if (side === "a") {
		return "control";
	}
	if (side === "b") {
		return "experimental";
	}
	return side;
}

/** Trim a description. Empty text becomes undefined. */
export function plainDescription(value?: string): string | undefined {
	const text = value?.trim();
	return text ? text : undefined;
}

export function compareArmDescription(arm: CompareArm | undefined): string | undefined {
	return plainDescription(arm?.description);
}

export function resolveCompareArms(compare?: ScenarioCompare): ResolvedCompareArm[] {
	if (!compare) {
		return [];
	}
	if (Array.isArray(compare.arms)) {
		return compare.arms
			.filter((arm): arm is CompareArm => typeof arm === "object" && arm !== null)
			.map((arm) => ({
				id: typeof arm.id === "string" ? arm.id.trim() : "",
				arm,
			}));
	}
	const arms: ResolvedCompareArm[] = [];
	if (compare.a && typeof compare.a === "object") {
		arms.push({ id: "a", arm: compare.a });
	}
	if (compare.b && typeof compare.b === "object") {
		arms.push({ id: "b", arm: compare.b });
	}
	return arms;
}

export function compareResultArms(result: ScenarioCompareResult): CompareArmResult[] {
	if (result.arms && result.arms.length > 0) {
		return result.arms;
	}
	const arms: CompareArmResult[] = [];
	if (result.a) {
		arms.push(result.a);
	}
	if (result.b) {
		arms.push(result.b);
	}
	return arms;
}

export function buildCompareResult(
	arms: CompareArmResult[],
	gates?: Pick<ScenarioCompareResult, "faster" | "cheaper">,
): ScenarioCompareResult {
	return {
		arms,
		a: arms.find((arm) => arm.id === "a"),
		b: arms.find((arm) => arm.id === "b"),
		faster: gates?.faster,
		cheaper: gates?.cheaper,
	};
}

export function resolveCompareMetricPairs(
	gate: CompareMetricGate | undefined,
	armIds: readonly string[],
): CompareMetricPair[] {
	if (gate === undefined) {
		return [];
	}
	if (typeof gate === "string") {
		if (armIds.length !== 2 || !armIds.includes(gate)) {
			return [];
		}
		const loser = armIds.find((id) => id !== gate);
		if (!loser) {
			return [];
		}
		return [{ winner: gate, loser }];
	}
	if (!Array.isArray(gate)) {
		return [];
	}
	return gate.filter(
		(pair): pair is CompareMetricPair =>
			typeof pair === "object" &&
			pair !== null &&
			typeof pair.winner === "string" &&
			typeof pair.loser === "string",
	);
}

export function compareArmTokens(arm: CompareArmResult): number | undefined {
	const total = arm.trace?.usage?.totalTokens;
	return typeof total === "number" ? total : undefined;
}

/** Apply one compare arm onto the shared scenario. Drops `compare` so the arm is a normal run. */
export function applyCompareArm(scenario: AgentScenario, side: CompareArmId): AgentScenario {
	const { compare, ...rest } = scenario;
	const resolved = resolveCompareArms(compare).find((entry) => entry.id === side);
	const arm = resolved?.arm;
	if (!arm) {
		return rest;
	}
	return {
		...rest,
		prompt: arm.prompt ?? rest.prompt,
		host: arm.host ?? rest.host,
		profile: arm.profile ?? rest.profile,
		workspace: arm.workspace ?? rest.workspace,
		skills: arm.skills ?? rest.skills,
		contextSources: arm.contextSources ?? rest.contextSources,
		mcpServers: arm.mcpServers ?? rest.mcpServers,
		allowUserSkills: arm.allowUserSkills ?? rest.allowUserSkills,
		seedPatch: arm.seedPatch ?? rest.seedPatch,
		seedStageOnly: arm.seedStageOnly ?? rest.seedStageOnly,
		rubric: mergeArmRubric(rest.rubric, arm.rubric),
	};
}

export function attachCompareStoryResults(
	fields: CompareStoryFields,
	result: ScenarioCompareResult,
): CompareStoryFields {
	const byId = new Map(compareResultArms(result).map((arm) => [arm.id, arm]));
	return {
		...fields,
		faster: result.faster ?? fields.faster,
		cheaper: result.cheaper ?? fields.cheaper,
		arms: fields.arms.map((arm) => ({
			...arm,
			trace: byId.get(arm.id)?.trace,
			durationMs: byId.get(arm.id)?.durationMs,
		})),
	};
}

export function compareStoryFields(scenario: AgentScenario): CompareStoryFields {
	const resolved = resolveCompareArms(scenario.compare);
	const armIds = resolved.map((entry) => entry.id);
	const arms: CompareStoryArm[] = resolved.map((entry) => ({
		id: entry.id,
		label: compareArmLabel(entry.arm, entry.id),
		description: compareArmDescription(entry.arm),
		rubric: entry.arm.rubric,
	}));
	return {
		arms,
		faster: resolveCompareMetricPairs(scenario.compare?.faster, armIds),
		cheaper: resolveCompareMetricPairs(scenario.compare?.cheaper, armIds),
		aLabel: arms[0]?.label ?? compareArmLabel(scenario.compare?.a, "a"),
		bLabel: arms[1]?.label ?? compareArmLabel(scenario.compare?.b, "b"),
		aDescription: arms[0]?.description,
		bDescription: arms[1]?.description,
		aRubric: arms[0]?.rubric,
		bRubric: arms[1]?.rubric,
	};
}

export function prefixCompareFailures(
	label: string,
	failures: AssertionFailure[],
): AssertionFailure[] {
	return failures.map((failure) => ({
		...failure,
		message: `${label}: ${failure.message}`,
	}));
}

function formatCompareDuration(ms: number): string {
	if (ms < 1000) {
		return `${Math.round(ms)}ms`;
	}
	return `${(ms / 1000).toFixed(1)}s`;
}

function armToolCount(arm: CompareArmResult): number | undefined {
	return arm.trace ? arm.trace.toolCalls.length : undefined;
}

function armById(arms: CompareArmResult[], id: CompareArmId): CompareArmResult | undefined {
	return arms.find((arm) => arm.id === id);
}

function describePairDuration(
	winner: CompareArmResult,
	loser: CompareArmResult,
): string | undefined {
	const winnerMs = winner.durationMs;
	const loserMs = loser.durationMs;
	if (typeof winnerMs !== "number" || typeof loserMs !== "number") {
		return undefined;
	}
	if (winnerMs === loserMs) {
		return `${winner.label} and ${loser.label} took ${formatCompareDuration(winnerMs)}`;
	}
	if (winnerMs < loserMs) {
		return `${winner.label} is faster than ${loser.label} (${formatCompareDuration(winnerMs)} vs ${formatCompareDuration(loserMs)})`;
	}
	return `${loser.label} is faster than ${winner.label} (${formatCompareDuration(loserMs)} vs ${formatCompareDuration(winnerMs)})`;
}

function describePairTokens(winner: CompareArmResult, loser: CompareArmResult): string | undefined {
	const winnerTokens = compareArmTokens(winner);
	const loserTokens = compareArmTokens(loser);
	if (typeof winnerTokens !== "number" || typeof loserTokens !== "number") {
		return undefined;
	}
	if (winnerTokens === loserTokens) {
		return `${winner.label} and ${loser.label} use ${winnerTokens} tokens`;
	}
	if (winnerTokens < loserTokens) {
		return `${winner.label} uses fewer tokens than ${loser.label} (${winnerTokens} vs ${loserTokens})`;
	}
	return `${loser.label} uses fewer tokens than ${winner.label} (${loserTokens} vs ${winnerTokens})`;
}

function describeTwoArmOutcome(left: CompareArmResult, right: CompareArmResult): string[] {
	const lines: string[] = [];
	const duration = describePairDuration(left, right);
	if (duration) {
		if (left.durationMs === right.durationMs) {
			lines.push(`both arms took ${formatCompareDuration(left.durationMs ?? 0)}`);
		} else {
			lines.push(duration);
		}
	}

	const aTokens = compareArmTokens(left);
	const bTokens = compareArmTokens(right);
	if (typeof aTokens === "number" && typeof bTokens === "number") {
		if (aTokens === bTokens) {
			lines.push(`both arms use ${aTokens} tokens`);
		} else {
			const tokens = describePairTokens(left, right);
			if (tokens) {
				lines.push(tokens);
			}
		}
	}

	const aTools = armToolCount(left);
	const bTools = armToolCount(right);
	if (typeof aTools === "number" && typeof bTools === "number") {
		if (aTools === bTools) {
			lines.push(
				aTools === 1 ? "both arms make 1 tool call" : `both arms make ${aTools} tool calls`,
			);
		} else if (aTools < bTools) {
			lines.push(
				`${left.label} makes fewer tool calls than ${right.label} (${aTools} vs ${bTools})`,
			);
		} else {
			lines.push(
				`${right.label} makes fewer tool calls than ${left.label} (${bTools} vs ${aTools})`,
			);
		}
	}

	return lines;
}

/**
 * Plain-language outcomes after the arms finish.
 * Two-arm form reports the single pair. Named-arm form reports declared pairs only.
 */
export function describeCompareOutcome(compare: ScenarioCompareResult): string[] {
	const arms = compareResultArms(compare);
	if (arms.length === 2 && arms[0] && arms[1]) {
		return describeTwoArmOutcome(arms[0], arms[1]);
	}
	const lines: string[] = [];
	for (const pair of compare.faster ?? []) {
		const winner = armById(arms, pair.winner);
		const loser = armById(arms, pair.loser);
		if (!winner || !loser) {
			continue;
		}
		const line = describePairDuration(winner, loser);
		if (line) {
			lines.push(line);
		}
	}
	for (const pair of compare.cheaper ?? []) {
		const winner = armById(arms, pair.winner);
		const loser = armById(arms, pair.loser);
		if (!winner || !loser) {
			continue;
		}
		const line = describePairTokens(winner, loser);
		if (line) {
			lines.push(line);
		}
	}
	return lines;
}

export function applySidecarCompareDurations(
	compare: ScenarioCompareResult,
	sidecar?: {
		compare?: {
			a?: { durationMs?: number };
			b?: { durationMs?: number };
			arms?: Record<string, { durationMs?: number }>;
		};
	},
): ScenarioCompareResult {
	if (!sidecar?.compare) {
		return compare;
	}
	const arms = compareResultArms(compare).map((arm) => {
		const fromMap = sidecar.compare?.arms?.[arm.id]?.durationMs;
		const fromAlias =
			arm.id === "a"
				? sidecar.compare?.a?.durationMs
				: arm.id === "b"
					? sidecar.compare?.b?.durationMs
					: undefined;
		return {
			...arm,
			durationMs: fromMap ?? fromAlias ?? arm.durationMs,
		};
	});
	return buildCompareResult(arms, { faster: compare.faster, cheaper: compare.cheaper });
}

function assertMetricPair(
	matcher: "faster" | "cheaper",
	pair: CompareMetricPair,
	byId: Map<string, CompareArmResult>,
	read: (arm: CompareArmResult) => number | undefined,
	verb: string,
	unit: string,
): AssertionFailure[] {
	const winner = byId.get(pair.winner);
	const loser = byId.get(pair.loser);
	if (!winner || !loser) {
		return [
			assertionFailure(
				matcher,
				`${pair.winner} must ${verb} ${pair.loser}, but one arm is missing from the result`,
				"rubric_miss",
			),
		];
	}
	const winnerValue = read(winner);
	const loserValue = read(loser);
	if (winnerValue === undefined || loserValue === undefined) {
		return [
			assertionFailure(
				matcher,
				`${winner.label} must ${verb} ${loser.label}, but one arm did not report ${matcher === "faster" ? "duration" : "tokens"}`,
				"rubric_miss",
			),
		];
	}
	if (!(winnerValue < loserValue)) {
		const winnerText = unit ? `${winnerValue}${unit}` : `${winnerValue}`;
		const loserText = unit ? `${loserValue}${unit}` : `${loserValue}`;
		return [
			assertionFailure(
				matcher,
				`${winner.label} must ${verb} ${loser.label} (${winnerText} vs ${loserText})`,
				"rubric_miss",
			),
		];
	}
	return [];
}

/** Score optional faster/cheaper gates after the arms finish. */
export function assertCompareMetrics(
	spec: Pick<ScenarioCompare, "faster" | "cheaper">,
	result: ScenarioCompareResult,
): AssertionFailure[] {
	const arms = compareResultArms(result);
	const armIds = arms.map((arm) => arm.id);
	const byId = new Map(arms.map((arm) => [arm.id, arm]));
	const failures: AssertionFailure[] = [];
	for (const pair of resolveCompareMetricPairs(spec.faster, armIds)) {
		failures.push(
			...assertMetricPair("faster", pair, byId, (arm) => arm.durationMs, "be faster than", "ms"),
		);
	}
	for (const pair of resolveCompareMetricPairs(spec.cheaper, armIds)) {
		failures.push(
			...assertMetricPair("cheaper", pair, byId, compareArmTokens, "use fewer tokens than", ""),
		);
	}
	return failures;
}
