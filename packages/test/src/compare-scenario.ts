import { assertionFailure } from "./failures.js";
import type {
	AgentScenario,
	AssertionFailure,
	CompareArm,
	CompareArmId,
	CompareArmResult,
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

/** Append arm-only array checks. Keep pairwise judge on the scenario rubric. */
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

export function isCompareScenario(
	scenario: Pick<AgentScenario, "compare">,
): scenario is AgentScenario & { compare: ScenarioCompare } {
	return scenario.compare !== undefined;
}

export function parseCompareArmId(value: unknown): CompareArmId | undefined {
	return value === "a" || value === "b" ? value : undefined;
}

export function compareArmLabel(arm: CompareArm | undefined, side: CompareArmId): string {
	const label = arm?.label?.trim();
	if (label) {
		return label;
	}
	return side === "a" ? "A" : "B";
}

function otherArm(side: CompareArmId): CompareArmId {
	return side === "a" ? "b" : "a";
}

export function compareArmTokens(arm: CompareArmResult): number | undefined {
	const total = arm.trace?.usage?.totalTokens;
	return typeof total === "number" ? total : undefined;
}

/** Apply one compare arm onto the shared scenario. Drops `compare` so the arm is a normal run. */
export function applyCompareArm(scenario: AgentScenario, side: CompareArmId): AgentScenario {
	const { compare, ...rest } = scenario;
	const arm = compare?.[side];
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

export function compareStoryFields(scenario: AgentScenario): {
	aLabel: string;
	bLabel: string;
	faster?: CompareArmId;
	cheaper?: CompareArmId;
	aRubric?: ScenarioRubric;
	bRubric?: ScenarioRubric;
} {
	return {
		aLabel: compareArmLabel(scenario.compare?.a, "a"),
		bLabel: compareArmLabel(scenario.compare?.b, "b"),
		faster: scenario.compare?.faster,
		cheaper: scenario.compare?.cheaper,
		aRubric: scenario.compare?.a.rubric,
		bRubric: scenario.compare?.b.rubric,
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

export function applySidecarCompareDurations(
	compare: ScenarioCompareResult,
	sidecar?: { compare?: { a?: { durationMs?: number }; b?: { durationMs?: number } } },
): ScenarioCompareResult {
	if (!sidecar?.compare) {
		return compare;
	}
	return {
		a: { ...compare.a, durationMs: sidecar.compare.a?.durationMs ?? compare.a.durationMs },
		b: { ...compare.b, durationMs: sidecar.compare.b?.durationMs ?? compare.b.durationMs },
	};
}

/** Score optional faster/cheaper gates after both arms finish. */
export function assertCompareMetrics(
	spec: Pick<ScenarioCompare, "faster" | "cheaper">,
	result: ScenarioCompareResult,
): AssertionFailure[] {
	const failures: AssertionFailure[] = [];
	if (spec.faster) {
		const winner = result[spec.faster];
		const loser = result[otherArm(spec.faster)];
		if (winner.durationMs === undefined || loser.durationMs === undefined) {
			failures.push(
				assertionFailure(
					"faster",
					`${winner.label} must be faster than ${loser.label}, but one arm did not report duration`,
					"rubric_miss",
				),
			);
		} else if (!(winner.durationMs < loser.durationMs)) {
			failures.push(
				assertionFailure(
					"faster",
					`${winner.label} must be faster than ${loser.label} (${winner.durationMs}ms vs ${loser.durationMs}ms)`,
					"rubric_miss",
				),
			);
		}
	}
	if (spec.cheaper) {
		const winner = result[spec.cheaper];
		const loser = result[otherArm(spec.cheaper)];
		const winnerTokens = compareArmTokens(winner);
		const loserTokens = compareArmTokens(loser);
		if (winnerTokens === undefined || loserTokens === undefined) {
			failures.push(
				assertionFailure(
					"cheaper",
					`${winner.label} must use fewer tokens than ${loser.label}, but one arm did not report tokens`,
					"rubric_miss",
				),
			);
		} else if (!(winnerTokens < loserTokens)) {
			failures.push(
				assertionFailure(
					"cheaper",
					`${winner.label} must use fewer tokens than ${loser.label} (${winnerTokens} vs ${loserTokens})`,
					"rubric_miss",
				),
			);
		}
	}
	return failures;
}
