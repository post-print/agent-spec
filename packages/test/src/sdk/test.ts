import { appendFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
	test as base,
	type PlaywrightTestConfig,
	defineConfig as playwrightConfig,
	type TestInfo,
} from "@playwright/test";
import type { AgentDefinition } from "@post-print/agent-harness";
import type { z } from "zod";
import { ACCEPTABLE_CONDITIONS, type AcceptedConditions } from "./claim-strength.js";
import { derivedExpectCriteria } from "./criteria.js";
import { type AgentResource, factories, type JudgeResource, type Resource } from "./definitions.js";
import { UnearnedResultError } from "./operation-ledger.js";
import { TestRuntime } from "./runtime.js";
import {
	CONTROL_ANNOTATION,
	NO_AGENT_ANNOTATION,
	plannedSamples,
	runRecordingSample,
	SAMPLE_ANNOTATION,
	type SamplingDetails,
	sampleIsUnneeded,
} from "./sampling.js";
import { withoutSecrets } from "./stored-value.js";
import type { AgentFixture, JudgeFixture, WorkspaceSource } from "./types.js";

interface Defaults {
	agentDefinition?: AgentDefinition;
	judgeDefinition?: AgentDefinition;
	workspaceSource: WorkspaceSource;
	acceptedConditions?: AcceptedConditions;
}
const runner = base.extend<Defaults & { runtime: TestRuntime }>({
	agentDefinition: [undefined, { option: true }],
	judgeDefinition: [undefined, { option: true }],
	workspaceSource: [".", { option: true }],
	acceptedConditions: [undefined, { option: true }],
	runtime: async (
		{ agentDefinition, judgeDefinition, workspaceSource, acceptedConditions },
		use,
		info,
	) => {
		const defaults = { agentDefinition, judgeDefinition, workspaceSource, acceptedConditions };
		const owner = await runtimeOwner(defaults, info);
		try {
			await use(owner.runtime);
		} finally {
			await owner.close();
		}
	},
});
async function runtimeOwner(defaults: Defaults, info: TestInfo) {
	const outputDir = info.outputPath("agent-runs"),
		path = join(outputDir, "events.ndjson");
	await mkdir(outputDir, { recursive: true });
	await appendFile(path, "");
	let writes = Promise.resolve();
	const startedAt = Date.now();
	const runtime = new TestRuntime({
		baseDir: dirname(info.config.configFile || join(process.cwd(), "agent-test.config.ts")),
		outputDir,
		agent: defaults.agentDefinition,
		judge: defaults.judgeDefinition,
		workspace: defaults.workspaceSource,
		accepted: defaults.acceptedConditions,
		signal: new AbortController().signal,
		testFile: info.file,
		remainingTestMs: () => (info.timeout === 0 ? undefined : startedAt + info.timeout - Date.now()),
		onEvent: (event) => {
			// Serialized now: the event as it happened, read before the test can see the run.
			const line = `${JSON.stringify(withoutSecrets(event))}\n`;
			writes = writes.then(() => appendFile(path, line));
			if (process.env.AGENT_TEST_VIEWER_EVENTS === "1" || process.env.AGENT_TEST_RECORDER === "1")
				process.stdout.write(`@@agent-test:${JSON.stringify({ ...event, at: Date.now() })}\n`);
		},
	});
	return {
		runtime,
		close: async () => {
			try {
				await runtime.close();
			} finally {
				await writes;
				await info.attach("agent-events", { path, contentType: "application/x-ndjson" });
			}
		},
	};
}
/** Runs a test body and holds it to earning its result, however it ends. */
interface Earning {
	runtime: TestRuntime;
	info: TestInfo;
	noAgent: boolean;
	/** A control must fail, which the runner then expects of this test. */
	control: boolean;
}
async function runEarnedBody(
	{ runtime, info, noAgent, control }: Earning,
	body: () => Promise<void> | void,
) {
	if (control) info.fail();
	try {
		await body();
	} catch (error) {
		const skipping = info.expectedStatus === "skipped";
		if (noAgent || skipping || !runtime.failedBeforeAnyHostStarted()) throw error;
		throw new UnearnedResultError(
			`The test failed before any agent started: ${(error as Error).message}`,
		);
	}
	runtime.assertResultEarned({ noAgent });
}
export type Resources = Record<string, Resource>;
export type Fixtures<R extends Resources> = {
	[K in keyof R]: R[K] extends JudgeResource<infer S>
		? JudgeFixture<z.output<S>>
		: R[K] extends AgentResource
			? AgentFixture
			: never;
};
type TestBody<R extends Resources> = (
	fixtures: Fixtures<R>,
	info: TestInfo,
	/** The arm of a comparison this run belongs to. */
	variant: string,
) => Promise<void> | void;
export type TestDetails<R extends Resources = Resources> = SamplingDetails & {
	description: string;
	criteria?: readonly string[];
	resources?: readonly Extract<keyof R, string>[];
	/** This test checks the runner itself, so it may pass without a completed agent operation. */
	noAgent?: boolean;
	/**
	 * This test is a control: it must fail, and only on the check with this label. Failing on any
	 * other check, such as a precondition, shows nothing about what the test measures.
	 */
	control?: { mustFail: string };
};
export interface SuiteTest<R extends Resources> {
	(title: string, body: TestBody<R>): void;
	(title: string, details: TestDetails<R>, body: TestBody<R>): void;
}
function bind<R extends Resources>(resources: R, runtime: TestRuntime): Fixtures<R> {
	return Object.fromEntries(
		Object.entries(resources).map(([name, resource]) => [
			name,
			resource.kind === "agent"
				? runtime.agent(name, resource.settings, resource.preparation)
				: runtime.judge(name, resource.settings),
		]),
	) as Fixtures<R>;
}
/** What the whole suite proves; shown once above its tests instead of repeated on each. */
export type SuiteDetails = { description: string };
type DefineResources<R extends Resources> = (builders: typeof factories) => R;
export function describe<R extends Resources>(
	name: string,
	define: DefineResources<R>,
): SuiteTest<R>;
export function describe<R extends Resources>(
	name: string,
	details: SuiteDetails,
	define: DefineResources<R>,
): SuiteTest<R>;
export function describe<R extends Resources>(
	name: string,
	detailsOrDefine: SuiteDetails | DefineResources<R>,
	maybeDefine?: DefineResources<R>,
): SuiteTest<R> {
	const define = typeof detailsOrDefine === "function" ? detailsOrDefine : maybeDefine;
	if (!define) throw new Error("describe needs a function that returns its resources");
	const suite = typeof detailsOrDefine === "function" ? undefined : detailsOrDefine;
	const resources = define(factories);
	if (
		!resources ||
		Object.values(resources).some(
			(resource) => !resource || !["agent", "judge"].includes(resource.kind),
		)
	)
		throw new Error("describe must return named agent() and judge() resources");
	return (title, detailsOrBody: TestBody<R> | TestDetails<R>, body?: TestBody<R>) => {
		const callback = typeof detailsOrBody === "function" ? detailsOrBody : body;
		if (!callback) throw new Error("Test body is required");
		const details = typeof detailsOrBody === "function" ? undefined : detailsOrBody;
		const annotation = [
			...testAnnotations(resources, callback, details),
			...suiteAnnotations(suite),
		];
		const earning = { noAgent: details?.noAgent === true, control: Boolean(details?.control) };
		const sampled = details?.samples !== undefined || details?.variants !== undefined;
		runner.describe(name, () => {
			if (!sampled) {
				runner(title, { annotation }, async ({ runtime }, info) => {
					await runEarnedBody({ runtime, info, ...earning }, () =>
						callback(bind(resources, runtime), info, ""),
					);
				});
				return;
			}
			for (const planned of plannedSamples(title, details ?? {})) {
				const annotations = [
					...annotation,
					{ type: SAMPLE_ANNOTATION, description: JSON.stringify(planned.annotation) },
				];
				runner(planned.title, { annotation: annotations }, async ({ runtime }, info) => {
					const unneeded = await sampleIsUnneeded(info, planned.annotation);
					info.skip(unneeded, "The sampling plan's decision is already fixed.");
					const body = () =>
						callback(bind(resources, runtime), info, planned.annotation.variant ?? "");
					await runRecordingSample({ info, annotation: planned.annotation, runtime }, () =>
						runEarnedBody({ runtime, info, ...earning }, body),
					);
				});
			}
		});
	};
}

function suiteAnnotations(suite?: SuiteDetails) {
	return suite?.description
		? [{ type: "agent-test.suite-description", description: suite.description }]
		: [];
}

function testAnnotations<R extends Resources>(
	resources: R,
	body: TestBody<R>,
	details?: TestDetails<R>,
) {
	const criteria = details?.criteria?.length
		? [...details.criteria]
		: derivedExpectCriteria(body.toString());
	return [
		{
			type: "agent-test.resources",
			description: JSON.stringify(resourceMetadata(resources, details?.resources)),
		},
		...(details?.description ? [{ type: "description", description: details.description }] : []),
		...(details?.noAgent ? [{ type: NO_AGENT_ANNOTATION, description: "" }] : []),
		...(details?.control
			? [{ type: CONTROL_ANNOTATION, description: details.control.mustFail }]
			: []),
		...(criteria.length
			? [{ type: "agent-test.criteria", description: JSON.stringify(criteria) }]
			: []),
	];
}
interface Configuration {
	agent?: AgentDefinition;
	judge?: AgentDefinition;
	workspace?: WorkspaceSource;
	/**
	 * Conditions this suite accepts going without, with why. A run weak only on these ends as
	 * `accepted`, exit 0, never `passed`. It is recorded on every run and `--verdict-grade` refuses it.
	 */
	accept?: AcceptedConditions;
}
/** An `accept` that names nothing, names an unknown condition, or gives no reason is a mistake. */
function checkedAccept(accept: AcceptedConditions): AcceptedConditions {
	const unknown = accept.conditions.filter((name) => !ACCEPTABLE_CONDITIONS.includes(name));
	if (accept.conditions.length === 0 || unknown.length > 0)
		throw new Error(
			`accept.conditions must name some of ${ACCEPTABLE_CONDITIONS.join(", ")}${unknown.length ? `; unknown: ${unknown.join(", ")}` : ""}`,
		);
	if (!accept.reason?.trim()) throw new Error("accept.reason must say why the suite accepts them");
	return { conditions: [...new Set(accept.conditions)], reason: accept.reason.trim() };
}
export type AgentTestConfig = Omit<PlaywrightTestConfig<Defaults>, "use" | "projects"> &
	Configuration & {
		projects?: (Omit<NonNullable<PlaywrightTestConfig<Defaults>["projects"]>[number], "use"> &
			Configuration)[];
	};
function translate({ agent, judge, workspace, accept, ...rest }: Configuration) {
	return {
		...rest,
		use: {
			...(agent ? { agentDefinition: agent } : {}),
			...(judge ? { judgeDefinition: judge } : {}),
			...(workspace ? { workspaceSource: workspace } : {}),
			...(accept ? { acceptedConditions: checkedAccept(accept) } : {}),
		},
	};
}
export function defineConfig(config: AgentTestConfig): PlaywrightTestConfig<Defaults> {
	const { projects, ...root } = config;
	return playwrightConfig({
		timeout: 180_000,
		retries: 0,
		workers: 1,
		fullyParallel: true,
		...translate(root),
		projects: projects?.map(translate),
	});
}

/** How the viewer names a workspace: the folder, or the worktree and what it checks out. */
function workspaceLabel(source?: WorkspaceSource): string | undefined {
	if (source === undefined || typeof source === "string") return source;
	return `worktree of ${source.worktree} at ${source.ref ?? "HEAD"}`;
}
function resourceMetadata<R extends Resources>(
	resources: R,
	selected?: readonly Extract<keyof R, string>[],
) {
	const names = selected ?? (Object.keys(resources) as Extract<keyof R, string>[]);
	return names.map((name) => {
		const resource = resources[name];
		if (!resource) throw new Error(`Unknown test resource: ${name}`);
		return resourceMetadataEntry(name, resource);
	});
}
function resourceMetadataEntry(name: string, resource: Resource) {
	const { settings } = resource;
	return {
		name,
		kind: resource.kind,
		description: settings.description,
		host: settings.agent?.host ?? (settings.agent?.adapter ? "custom" : undefined),
		model: settings.model ?? settings.agent?.options.model,
		skills: [...(settings.agent?.options.skills ?? []), ...(settings.skills ?? [])],
		mcpServers: Object.keys({ ...settings.agent?.options.mcpServers, ...settings.mcpServers }),
		workspace: resource.kind === "agent" ? workspaceLabel(resource.settings.workspace) : undefined,
		prompt: resource.kind === "judge" ? resource.settings.prompt : undefined,
	};
}
