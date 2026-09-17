import { appendFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
	test as base,
	type PlaywrightTestConfig,
	defineConfig as playwrightConfig,
	type TestInfo,
} from "@playwright/test";
import type { AgentDefinition } from "@post-print/agent-harness";
import type { z } from "zod/v4";
import { type AgentResource, factories, type JudgeResource, type Resource } from "./definitions.js";
import { TestRuntime } from "./runtime.js";
import type { AgentFixture, JudgeFixture } from "./types.js";

interface Defaults {
	agentDefinition?: AgentDefinition;
	judgeDefinition?: AgentDefinition;
	workspaceSource: string;
}
const runner = base.extend<Defaults & { runtime: TestRuntime }>({
	agentDefinition: [undefined, { option: true }],
	judgeDefinition: [undefined, { option: true }],
	workspaceSource: [".", { option: true }],
	runtime: async ({ agentDefinition, judgeDefinition, workspaceSource }, use, info) => {
		const owner = await runtimeOwner({ agentDefinition, judgeDefinition, workspaceSource }, info);
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
	const runtime = new TestRuntime({
		baseDir: dirname(info.config.configFile || join(process.cwd(), "agent-test.config.ts")),
		outputDir,
		agent: defaults.agentDefinition,
		judge: defaults.judgeDefinition,
		workspace: defaults.workspaceSource,
		signal: new AbortController().signal,
		onEvent: (event) => {
			writes = writes.then(() => appendFile(path, `${JSON.stringify(event)}\n`));
			if (process.env.AGENT_TEST_VIEWER_EVENTS === "1")
				process.stdout.write(`@@agent-test:${JSON.stringify(event)}\n`);
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
export type Resources = Record<string, Resource>;
export type Fixtures<R extends Resources> = {
	[K in keyof R]: R[K] extends JudgeResource<infer S>
		? JudgeFixture<z.output<S>>
		: R[K] extends AgentResource
			? AgentFixture
			: never;
};
export type SuiteTest<R extends Resources> = (
	title: string,
	body: (fixtures: Fixtures<R>, info: TestInfo) => Promise<void> | void,
) => void;
function bind<R extends Resources>(resources: R, runtime: TestRuntime): Fixtures<R> {
	return Object.fromEntries(
		Object.entries(resources).map(([name, resource]) => [
			name,
			resource.kind === "agent"
				? runtime.agent(name, resource.settings)
				: runtime.judge(name, resource.settings),
		]),
	) as Fixtures<R>;
}
export function describe<R extends Resources>(
	name: string,
	define: (builders: typeof factories) => R,
): SuiteTest<R> {
	const resources = define(factories);
	if (
		!resources ||
		Object.values(resources).some(
			(resource) => !resource || !["agent", "judge"].includes(resource.kind),
		)
	)
		throw new Error("describe must return named agent() and judge() resources");
	return (title, body) => {
		runner.describe(name, () => {
			runner(title, async ({ runtime }, info) => {
				await body(bind(resources, runtime), info);
			});
		});
	};
}
interface Configuration {
	agent?: AgentDefinition;
	judge?: AgentDefinition;
	workspace?: string;
}
export type AgentTestConfig = Omit<PlaywrightTestConfig<Defaults>, "use" | "projects"> &
	Configuration & {
		projects?: (Omit<NonNullable<PlaywrightTestConfig<Defaults>["projects"]>[number], "use"> &
			Configuration)[];
	};
function translate({ agent, judge, workspace, ...rest }: Configuration) {
	return {
		...rest,
		use: {
			...(agent ? { agentDefinition: agent } : {}),
			...(judge ? { judgeDefinition: judge } : {}),
			...(workspace ? { workspaceSource: workspace } : {}),
		},
	};
}
export function defineConfig(config: AgentTestConfig): PlaywrightTestConfig<Defaults> {
	const { projects, ...root } = config;
	return playwrightConfig({
		timeout: 180_000,
		retries: 0,
		workers: 1,
		...translate(root),
		projects: projects?.map(translate),
	});
}
