import { appendFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
	test as base,
	type Fixtures,
	type PlaywrightTestConfig,
	defineConfig as playwrightConfig,
	type TestDetails,
	type TestInfo,
	type TestType,
} from "@playwright/test";
import type { AgentDefinition } from "@post-print/agent-harness";
import { type AgentFixture, TestRuntime } from "./runtime.js";
import type { CompareOptions, Comparison } from "./types.js";
import type { Workspace } from "./workspace.js";

export interface AgentTestOptions {
	agentDefinition: AgentDefinition | undefined;
	workspaceSource: string;
}
export interface AgentFixtures {
	agent: AgentFixture;
	workspace: Workspace;
	compare: <V extends string>(options: CompareOptions<V>) => Promise<Comparison<V>>;
}
interface InternalFixtures {
	runtime: TestRuntime;
	agentFixture: Awaited<ReturnType<TestRuntime["createAgent"]>>;
}
const extended = base.extend<AgentFixtures & AgentTestOptions & InternalFixtures>({
	agentDefinition: [undefined, { option: true }],
	workspaceSource: [".", { option: true }],
	runtime: async ({ agentDefinition, workspaceSource }, use, testInfo) => {
		const controller = new AbortController();
		const outputDir = testInfo.outputPath("agent-runs");
		await mkdir(outputDir, { recursive: true });
		const eventPath = join(outputDir, "events.ndjson");
		await appendFile(eventPath, "");
		let writes = Promise.resolve();
		const runtime = new TestRuntime({
			baseDir: dirname(testInfo.config.configFile || join(process.cwd(), "agent-test.config.ts")),
			outputDir,
			agent: agentDefinition,
			workspace: workspaceSource,
			signal: controller.signal,
			onEvent: (event) => {
				writes = writes.then(() => appendFile(eventPath, `${JSON.stringify(event)}\n`));
				if (process.env.AGENT_TEST_VIEWER_EVENTS === "1")
					process.stdout.write(`@@agent-test:${JSON.stringify(event)}\n`);
			},
		});
		try {
			await use(runtime);
		} finally {
			controller.abort();
			try {
				await runtime.close();
			} finally {
				await writes;
				await testInfo.attach("agent-events", {
					path: eventPath,
					contentType: "application/x-ndjson",
				});
			}
		}
	},
	agentFixture: async ({ runtime }, use) => {
		const fixture = await runtime.createAgent();
		try {
			await use(fixture);
		} finally {
			await fixture.close();
		}
	},
	agent: async ({ agentFixture }, use) => {
		await use(agentFixture.agent);
	},
	workspace: async ({ agentFixture }, use) => {
		await use(agentFixture.workspace);
	},
	compare: async ({ runtime }, use) => {
		await use((options) => runtime.compare(options));
	},
});
export interface PublicUse {
	agent?: AgentDefinition;
	workspace?: string;
}
function translate(
	options: (PublicUse & Record<string, unknown>) | PublicUse,
): Record<string, unknown> {
	const { agent, workspace, ...rest } = options;
	return {
		...rest,
		...(agent !== undefined ? { agentDefinition: agent } : {}),
		...(workspace !== undefined ? { workspaceSource: workspace } : {}),
	};
}
type TestBody<T, W> = (args: T & W, testInfo: TestInfo) => void | Promise<void>;
export type AgentTest<T extends object, W extends object> = Omit<
	TestType<T, W>,
	"use" | "extend"
> & {
	(title: string, body: TestBody<T, W>): void;
	(title: string, details: TestDetails, body: TestBody<T, W>): void;
	use(
		options: PublicUse &
			Omit<Fixtures<Record<never, never>, Record<never, never>, T, W>, "agent" | "workspace">,
	): void;
	extend<More extends object, Workers extends object = Record<never, never>>(
		fixtures: Fixtures<More, Workers, T, W>,
	): AgentTest<T & More, W & Workers>;
};
function wrap<T extends object, W extends object>(target: TestType<T, W>): AgentTest<T, W> {
	return new Proxy(target, {
		get(object, key, receiver) {
			if (key === "use")
				return (options: Record<string, unknown>) =>
					object.use(
						translate(options) as Fixtures<Record<never, never>, Record<never, never>, T, W>,
					);
			if (key === "extend")
				return (fixtures: Fixtures<object, object, T, W>) => wrap(object.extend(fixtures));
			return Reflect.get(object, key, receiver);
		},
	}) as AgentTest<T, W>;
}
export const test = wrap(extended);
export type AgentTestConfig = Omit<PlaywrightTestConfig<AgentTestOptions>, "use" | "projects"> & {
	use?: PublicUse;
	projects?: (Omit<
		NonNullable<PlaywrightTestConfig<AgentTestOptions>["projects"]>[number],
		"use"
	> & { use?: PublicUse })[];
};
export function defineConfig(config: AgentTestConfig): PlaywrightTestConfig<AgentTestOptions> {
	return playwrightConfig({
		timeout: 180_000,
		retries: 0,
		workers: 1,
		...config,
		use: translate(config.use ?? {}),
		projects: config.projects?.map((project) => ({
			...project,
			use: translate(project.use ?? {}),
		})),
	});
}
