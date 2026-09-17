import { join } from "node:path";
import { variantResult } from "./metrics.js";
import type { TestRuntime } from "./runtime.js";
import type {
	Check,
	CompareOptions,
	Comparison,
	ComparisonGrade,
	Criteria,
	Grade,
	JudgeDefinition,
	Run,
	Variant,
} from "./types.js";
import { writeJson } from "./workspace.js";

function variantEntries<V extends string>(options: CompareOptions<V>): [V, Variant][] {
	const entries = Object.entries(options.variants) as [V, Variant][];
	if (!entries.length) throw new Error("Comparison requires at least one variant");
	for (const [name, variant] of entries) {
		if (!Number.isInteger(variant.repeat ?? 1) || (variant.repeat ?? 1) < 1)
			throw new Error(`Invalid repeat for ${name}`);
		if (variant.expectedFailures?.length && !options.checks)
			throw new Error("expectedFailures requires named checks");
	}
	return entries;
}
function checkCollector(checks: Map<string, boolean>): Check {
	return async (name, assertion) => {
		if (checks.has(name)) throw new Error(`Duplicate check: ${name}`);
		try {
			await assertion();
			checks.set(name, true);
		} catch (error) {
			if (!error || typeof error !== "object" || !("matcherResult" in error)) throw error;
			checks.set(name, false);
		}
	};
}
function checkFailures(
	checks: Map<string, boolean>,
	expected: readonly string[],
	label: string,
): string[] {
	const errors = expected
		.filter((name) => !checks.has(name))
		.map((name) => `${label}: expected check ${name} was not executed`);
	for (const [name, passed] of checks) {
		if (passed === expected.includes(name))
			errors.push(`${label}: ${name} ${passed ? "unexpectedly passed" : "failed"}`);
	}
	return errors;
}
interface VariantExecution {
	name: string;
	repetition: number;
	variant: Variant;
	prompt: string;
	checks?: CompareOptions<string>["checks"];
}
async function executeVariant(runtime: TestRuntime, execution: VariantExecution) {
	const { name, repetition, variant } = execution;
	const fixture = await runtime.createAgent(
		variant.agent ?? runtime.options.agent,
		variant.workspace ?? runtime.options.workspace,
	);
	try {
		const run = await fixture.agent.run(variant.prompt ?? execution.prompt);
		runtime.options.onEvent?.({ runId: run.id, type: "variant", value: { name, repetition } });
		const checks = new Map<string, boolean>();
		await execution.checks?.(run, checkCollector(checks));
		const expectedFailures = variant.expectedFailures ?? [];
		const value = { checks: Object.fromEntries(checks), expectedFailures };
		runtime.options.onEvent?.({ runId: run.id, type: "checks", value });
		await writeJson(join(runtime.options.outputDir, run.id, "checks.json"), {
			...value,
			variant: name,
			repetition,
		});
		return { run, errors: checkFailures(checks, expectedFailures, `${name}[${repetition}]`) };
	} finally {
		await fixture.close();
	}
}
function averageGrades<C extends Criteria>(runs: Grade<C>[], criteria: C) {
	const scores = {} as Grade<C>["scores"];
	let total = 0;
	for (const key of Object.keys(criteria) as (keyof C & string)[]) {
		scores[key] = runs.reduce((sum, run) => sum + run.scores[key], 0) / runs.length;
		const allowed = Object.keys(criteria[key].scores).map(Number);
		total += (scores[key] - Math.min(...allowed)) / (Math.max(...allowed) - Math.min(...allowed));
	}
	return { scores, total };
}
async function judgeComparison<C extends Criteria, V extends string>(
	collected: Record<V, Run[]>,
	definition: JudgeDefinition<C>,
): Promise<ComparisonGrade<C, V>> {
	const variants = {} as ComparisonGrade<C, V>["variants"];
	const totals: [V, number][] = [];
	for (const name of Object.keys(collected) as V[]) {
		const runs: Grade<C>[] = [];
		for (const run of collected[name]) runs.push(await run.judge(definition));
		const { scores, total } = averageGrades(runs, definition.criteria);
		variants[name] = { runs, scores };
		totals.push([name, total]);
	}
	totals.sort((a, b) => b[1] - a[1]);
	return {
		variants,
		winner: totals.length < 2 || totals[0][1] === totals[1][1] ? null : totals[0][0],
	};
}
export async function compareVariants<V extends string>(
	runtime: TestRuntime,
	options: CompareOptions<V>,
): Promise<Comparison<V>> {
	const entries = variantEntries(options);
	const collected = Object.fromEntries(entries.map(([name]) => [name, [] as Run[]])) as Record<
		V,
		Run[]
	>;
	const errors: string[] = [];
	const repeats = Math.max(...entries.map(([, variant]) => variant.repeat ?? 1));
	for (let repetition = 0; repetition < repeats; repetition++) {
		for (const [name, variant] of entries) {
			if (repetition >= (variant.repeat ?? 1)) continue;
			const result = await executeVariant(runtime, { ...options, name, variant, repetition });
			collected[name].push(result.run);
			errors.push(...result.errors);
		}
	}
	if (errors.length) throw new Error(`Comparison checks failed:\n${errors.join("\n")}`);
	const variants = Object.fromEntries(
		entries.map(([name]) => [name, variantResult(collected[name])]),
	) as Comparison<V>["variants"];
	return {
		variants,
		runs: Object.values(collected).flat() as Run[],
		judge: (definition) => judgeComparison(collected, definition),
	};
}
