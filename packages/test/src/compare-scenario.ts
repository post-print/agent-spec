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
	"mustRunSuccessfully",
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

/** Shared compare verdict boundary for CLI and viewer-scheduled arm runs. */
export function finalizeCompareOutcome(
	arms: CompareArmResult[],
	gates?: CompareGate[],
	options: { evaluateGates?: boolean } = {},
): { compare: ScenarioCompareResult; failures: AssertionFailure[] } {
	const compare = buildCompareResult(arms, gates);
	const experimentMode = Boolean(gates?.length);
	const failures = arms.flatMap((arm) =>
		prefixCompareFailures(
			arm.label,
			experimentMode
				? (arm.failures ?? []).filter((failure) => failure.category !== "rubric_miss")
				: (arm.failures ?? []),
		),
	);
	if (options.evaluateGates !== false) {
		finalizeCompareGates(compare, failures);
	}
	return { compare, failures };
}

/** Attach authoritative gate evidence after any per-arm judge metrics have completed. */
export function finalizeCompareGates(
	compare: ScenarioCompareResult,
	failures: AssertionFailure[],
): void {
	compare.gateResults = evaluateCompareGates(compare.gates, compare);
	if (failures.every((failure) => failure.category === "rubric_miss")) {
		failures.push(...assertCompareGates(compare.gates, compare));
	}
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

export function describeCompareGate(
	gate: CompareGate,
	label: (id: CompareArmId) => string = (id) => id,
): string {
	if ("winner" in gate) {
		if (gate.metric === "outcome") {
			return `${label(gate.winner)} must pass while ${label(gate.loser)} fails`;
		}
		return `${label(gate.winner)} must use fewer ${gate.metric} than ${label(gate.loser)}`;
	}
	if (gate.metric === "outcome" && gate.operator === "equal") {
		return `${label(gate.arm)} is expected to ${gate.value}`;
	}
	const operator = {
		equal: "must equal",
		lessThan: "must be less than",
		atMost: "must be at most",
		atLeast: "must be at least",
		greaterThan: "must be greater than",
	}[gate.operator];
	return `${label(gate.arm)} ${gate.metric} ${operator} ${gate.value}`;
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
	const rubric = { ...mergeArmRubric(rest.rubric, arm.rubric) };
	if (compare?.judgeMetrics?.length) {
		rubric.judge = [...(rubric.judge ?? []), ...compare.judgeMetrics];
	}
	return { ...rest, ...armScenarioOverrides(rest, arm), rubric };
}

function armScenarioOverrides(
	rest: AgentScenario,
	arm: NonNullable<ReturnType<typeof resolveCompareArms>[number]>["arm"],
) {
	const overrides: Partial<AgentScenario> = {};
	for (const key of [
		"prompt",
		"host",
		"contextMode",
		"profile",
		"workspace",
		"skills",
		"contextSources",
		"mcpServers",
		"includeGlobalSkills",
		"seedPatch",
		"seedStageOnly",
	] as const) {
		Object.assign(overrides, { [key]: arm[key] ?? rest[key] });
	}
	return overrides;
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
	arm: CompareArmResult | undefined,
	metric: CompareMetric,
): number | "pass" | "fail" | undefined {
	if (!arm) return undefined;
	if (metric === "outcome") return compareOutcome(arm.passed);
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
function winsComparison(
	left: number | "pass" | "fail" | undefined,
	right: number | "pass" | "fail" | undefined,
): boolean {
	if (left === undefined || right === undefined) return false;
	return typeof left === "number" && typeof right === "number"
		? left < right
		: left === "pass" && right === "fail";
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
			const left = compareMetricValue(winner, gate.metric);
			const right = compareMetricValue(loser, gate.metric);
			const passed = winsComparison(left, right);
			return {
				gate,
				passed,
				left,
				right,
				message: describeCompareGate(gate),
			};
		}
		const arm = byId.get(gate.arm);
		const left = compareMetricValue(arm, gate.metric);
		const passed = left !== undefined && compareAbsolute(left, gate.operator, gate.value);
		return {
			gate,
			passed,
			left,
			right: gate.value,
			message: describeCompareGate(gate),
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
			assertionFailure(`compareGate:${item.gate.metric}`, {
				message: `${item.message} (actual ${String(item.left)} vs ${String(item.right)})`,
				category: "rubric_miss",
			}),
		);
}
function describeArmMeasurements(arm: CompareArmResult): string {
	const values = [
		arm.passed === undefined ? undefined : arm.passed ? "pass" : "fail",
		compareArmTurns(arm) === undefined ? undefined : `${compareArmTurns(arm)} turns`,
		compareArmTokens(arm) === undefined ? undefined : `${compareArmTokens(arm)} tokens`,
		compareArmTools(arm) === undefined ? undefined : `${compareArmTools(arm)} tools`,
		arm.durationMs === undefined ? undefined : `${arm.durationMs} ms`,
	].filter(Boolean);
	return `${arm.label}: ${values.join(", ")}`;
}
export function describeCompareOutcome(compare: ScenarioCompareResult): string[] {
	const lines = compareResultArms(compare).map(describeArmMeasurements);
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
			a?: Pick<CompareArmResult, "contextFiles" | "contextMode" | "durationMs" | "hostInput">;
			b?: Pick<CompareArmResult, "contextFiles" | "contextMode" | "durationMs" | "hostInput">;
			arms?: Record<
				string,
				Pick<CompareArmResult, "contextFiles" | "contextMode" | "durationMs" | "hostInput">
			>;
		};
	},
): ScenarioCompareResult {
	if (!sidecar?.compare) return compare;
	const arms = compareResultArms(compare).map((arm) => {
		const named = sidecar.compare?.arms?.[arm.id];
		const legacy =
			arm.id === "a" ? sidecar.compare?.a : arm.id === "b" ? sidecar.compare?.b : undefined;
		return {
			...arm,
			contextMode: named?.contextMode ?? legacy?.contextMode ?? arm.contextMode,
			contextFiles: named?.contextFiles ?? legacy?.contextFiles ?? arm.contextFiles,
			hostInput: named?.hostInput ?? legacy?.hostInput ?? arm.hostInput,
			durationMs: named?.durationMs ?? legacy?.durationMs ?? arm.durationMs,
		};
	});
	return {
		...compare,
		...buildCompareResult(arms, compare.gates),
		gateResults: compare.gateResults,
	};
}

function compareOutcome(passed: boolean | undefined): "pass" | "fail" | undefined {
	if (passed === undefined) return undefined;
	return passed ? "pass" : "fail";
}
