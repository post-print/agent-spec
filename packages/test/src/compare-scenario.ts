import { resolvedTotalTokens } from "@post-print/agent-harness";
import { assertionFailure } from "./failures.js";
import type {
	AgentScenario,
	AssertionFailure,
	CompareArm,
	CompareArmId,
	CompareArmResult,
	CompareGate,
	CompareGateResult,
	CompareMetric,
	JudgeVerdictResult,
	ScenarioCompareResult,
	ScenarioRubric,
} from "./types.js";

const RUBRIC_ARRAY_KEYS = [
	"must",
	"mustNot",
	"mustRun",
	"allowedCommands",
	"mustCallTool",
	"mustCallToolsInOrder",
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
	passed?: boolean;
	failures?: CompareArmResult["failures"];
	judgeVerdicts?: JudgeVerdictResult[];
}
export interface CompareStoryFields {
	arms: CompareStoryArm[];
	gates?: CompareGate[];
	aLabel: string;
	bLabel: string;
	aDescription?: string;
	bDescription?: string;
	aRubric?: ScenarioRubric;
	bRubric?: ScenarioRubric;
}

export function mergeArmRubric(base: ScenarioRubric, overlay?: ScenarioRubric): ScenarioRubric {
	if (!overlay) return base;
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
		if (extra !== undefined) merged[key] = [...(base[key] ?? []), ...extra];
	}
	return merged;
}

export function parseCompareArmId(value: unknown): CompareArmId | undefined {
	if (typeof value !== "string") return undefined;
	const id = value.trim();
	return COMPARE_ARM_ID_PATTERN.test(id) ? id : undefined;
}
export function compareArmLabel(arm: CompareArm | undefined, side: CompareArmId): string {
	return arm?.label?.trim() || (side === "a" ? "control" : side === "b" ? "experimental" : side);
}
export function plainDescription(value?: string): string | undefined {
	return value?.trim() || undefined;
}
export function compareArmDescription(arm?: CompareArm): string | undefined {
	return plainDescription(arm?.description);
}

export function resolveCompareArms(compare?: AgentScenario["compare"]): ResolvedCompareArm[] {
	if (!compare) return [];
	if (Array.isArray(compare.arms))
		return compare.arms
			.filter((arm): arm is CompareArm => typeof arm === "object" && arm !== null)
			.map((arm) => ({ id: typeof arm.id === "string" ? arm.id.trim() : "", arm }));
	const arms: ResolvedCompareArm[] = [];
	if (compare.a && typeof compare.a === "object") arms.push({ id: "a", arm: compare.a });
	if (compare.b && typeof compare.b === "object") arms.push({ id: "b", arm: compare.b });
	return arms;
}
export function compareResultArms(result: ScenarioCompareResult): CompareArmResult[] {
	return result.arms.length > 0
		? result.arms
		: [result.a, result.b].filter((arm): arm is CompareArmResult => arm !== undefined);
}
export function buildCompareResult(
	arms: CompareArmResult[],
	gates?: CompareGate[],
): ScenarioCompareResult {
	return {
		arms,
		a: arms.find((arm) => arm.id === "a"),
		b: arms.find((arm) => arm.id === "b"),
		gates,
	};
}
export function compareArmTokens(arm: CompareArmResult): number | undefined {
	return resolvedTotalTokens(arm.trace?.usage);
}
export function compareArmTurns(arm: CompareArmResult): number | undefined {
	return arm.trace?.messages.filter((message) => message.role === "assistant").length;
}
export function compareArmTools(arm: CompareArmResult): number | undefined {
	return arm.trace?.toolCalls.length;
}
export function formatCompareTurns(turns: number): string {
	return turns === 1 ? "1 turn" : `${turns} turns`;
}

export function requireCompareArm(scenario: AgentScenario, side: CompareArmId): AgentScenario {
	if (!resolveCompareArms(scenario.compare).some((entry) => entry.id === side))
		throw new Error(`Scenario ${scenario.name} has no compare arm ${side}`);
	return applyCompareArm(scenario, side);
}
export function applyCompareArm(scenario: AgentScenario, side: CompareArmId): AgentScenario {
	const { compare, ...rest } = scenario;
	const arm = resolveCompareArms(compare).find((entry) => entry.id === side)?.arm;
	if (!arm) return rest;
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

export function compareStoryFields(scenario: AgentScenario): CompareStoryFields {
	const arms = resolveCompareArms(scenario.compare).map((entry) => ({
		id: entry.id,
		label: compareArmLabel(entry.arm, entry.id),
		description: compareArmDescription(entry.arm),
		rubric: entry.arm.rubric,
	}));
	return {
		arms,
		gates: scenario.compare?.gates,
		aLabel: arms[0]?.label ?? "control",
		bLabel: arms[1]?.label ?? "experimental",
		aDescription: arms[0]?.description,
		bDescription: arms[1]?.description,
		aRubric: arms[0]?.rubric,
		bRubric: arms[1]?.rubric,
	};
}
export function attachCompareStoryResults(
	fields: CompareStoryFields,
	result: ScenarioCompareResult,
): CompareStoryFields {
	const byId = new Map(compareResultArms(result).map((arm) => [arm.id, arm]));
	return {
		...fields,
		gates: result.gates ?? fields.gates,
		arms: fields.arms.map((arm) => {
			const measured = byId.get(arm.id);
			return {
				...arm,
				trace: measured?.trace,
				durationMs: measured?.durationMs,
				passed: measured?.passed,
				failures: measured?.failures,
				judgeVerdicts: measured?.judgeVerdicts,
			};
		}),
	};
}
export function prefixCompareFailures(
	label: string,
	failures: AssertionFailure[],
): AssertionFailure[] {
	return failures.map((failure) => ({ ...failure, message: `${label}: ${failure.message}` }));
}

function judgeValue(arm: CompareArmResult, id: string): "pass" | "fail" | undefined {
	const verdict = arm.judgeVerdicts?.find((item) => item.id === id);
	return verdict ? (verdict.pass ? "pass" : "fail") : undefined;
}
export function compareMetricValue(
	arm: CompareArmResult,
	metric: CompareMetric,
): number | "pass" | "fail" | undefined {
	if (metric === "outcome")
		return arm.passed === undefined ? undefined : arm.passed ? "pass" : "fail";
	if (metric === "turns") return compareArmTurns(arm);
	if (metric === "tokens") return compareArmTokens(arm);
	if (metric === "tools") return compareArmTools(arm);
	if (metric === "durationMs") return arm.durationMs;
	return judgeValue(arm, metric.slice("judge:".length));
}
function normalizedValue(value: number | "pass" | "fail"): number {
	return typeof value === "number" ? value : value === "pass" ? 1 : 0;
}
function compareAbsolute(
	left: number | "pass" | "fail",
	operator: Extract<CompareGate, { arm: string }>["operator"],
	right: number | "pass" | "fail",
): boolean {
	const a = normalizedValue(left);
	const b = normalizedValue(right);
	if (operator === "equal") return a === b;
	if (operator === "lessThan") return a < b;
	if (operator === "atMost") return a <= b;
	if (operator === "atLeast") return a >= b;
	return a > b;
}
export function evaluateCompareGates(
	gates: CompareGate[] | undefined,
	result: ScenarioCompareResult,
): CompareGateResult[] {
	const byId = new Map(compareResultArms(result).map((arm) => [arm.id, arm]));
	return (gates ?? []).map((gate) => {
		if ("winner" in gate) {
			const winner = byId.get(gate.winner);
			const loser = byId.get(gate.loser);
			const left = winner ? compareMetricValue(winner, gate.metric) : undefined;
			const right = loser ? compareMetricValue(loser, gate.metric) : undefined;
			const passed =
				left !== undefined &&
				right !== undefined &&
				(typeof left === "number" && typeof right === "number"
					? left < right
					: left === "pass" && right === "fail");
			return {
				gate,
				passed,
				left,
				right,
				message: `${gate.winner} must beat ${gate.loser} on ${gate.metric}`,
			};
		}
		const arm = byId.get(gate.arm);
		const left = arm ? compareMetricValue(arm, gate.metric) : undefined;
		const passed = left !== undefined && compareAbsolute(left, gate.operator, gate.value);
		return {
			gate,
			passed,
			left,
			right: gate.value,
			message: `${gate.arm} ${gate.metric} must be ${gate.operator} ${gate.value}`,
		};
	});
}
export function assertCompareGates(
	gates: CompareGate[] | undefined,
	result: ScenarioCompareResult,
): AssertionFailure[] {
	return evaluateCompareGates(gates, result)
		.filter((item) => !item.passed)
		.map((item) =>
			assertionFailure(
				`compareGate:${item.gate.metric}`,
				`${item.message} (actual ${String(item.left)} vs ${String(item.right)})`,
				"rubric_miss",
			),
		);
}
export function describeCompareOutcome(compare: ScenarioCompareResult): string[] {
	const lines = compareResultArms(compare).map((arm) => {
		const values = [
			arm.passed === undefined ? undefined : arm.passed ? "pass" : "fail",
			compareArmTurns(arm) === undefined ? undefined : `${compareArmTurns(arm)} turns`,
			compareArmTokens(arm) === undefined ? undefined : `${compareArmTokens(arm)} tokens`,
			compareArmTools(arm) === undefined ? undefined : `${compareArmTools(arm)} tools`,
			arm.durationMs === undefined ? undefined : `${arm.durationMs} ms`,
		].filter(Boolean);
		return `${arm.label}: ${values.join(", ")}`;
	});
	for (const arm of compareResultArms(compare)) {
		for (const verdict of arm.judgeVerdicts ?? []) {
			lines.push(
				`${arm.label} judge ${verdict.id}: ${verdict.pass ? "pass" : "fail"}. ${verdict.rationale}`,
			);
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
	if (!sidecar?.compare) return compare;
	const arms = compareResultArms(compare).map((arm) => ({
		...arm,
		durationMs:
			sidecar.compare?.arms?.[arm.id]?.durationMs ??
			(arm.id === "a"
				? sidecar.compare?.a?.durationMs
				: arm.id === "b"
					? sidecar.compare?.b?.durationMs
					: undefined) ??
			arm.durationMs,
	}));
	return {
		...compare,
		...buildCompareResult(arms, compare.gates),
		gateResults: compare.gateResults,
	};
}
