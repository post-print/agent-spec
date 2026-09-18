import { pathToFileURL } from "node:url";
import type {
	AdapterSession,
	AgentAdapter,
	AgentCapabilities,
	AgentDefinition,
	AgentEvent,
} from "./agent-definition.js";
import { cancelActiveClaudeRun, runClaudeAgent } from "./claude-run.js";
import { cancelActiveCursorRun, runCursorAgent } from "./cursor-run.js";
import { cancelActiveOpenaiRun, runOpenaiAgent } from "./openai-run.js";
import { cancelActiveOpenRouterRun, runOpenRouterAgent } from "./openrouter-run.js";
import type { AgentTrace } from "./types.js";

let session: AdapterSession;
const signal = new AbortController();
const send = (type: string, value?: unknown) => process.send?.({ type, value });
function empty(): AgentTrace {
	return { messages: [], toolCalls: [], shellCommands: [], artifacts: {} };
}
interface InitializeInput {
	agent: AgentDefinition;
	workspace: string;
	readOnly: boolean;
}
async function initialize(input: InitializeInput): Promise<AgentCapabilities> {
	const { agent, readOnly } = input;
	if (agent.adapter) return initializeCustom(input, agent.adapter);
	if (readOnly && agent.host === "cursor")
		throw new Error(
			"Cursor adapter does not yet provide enforced read-only judging; use openai or claude as the judge",
		);
	session = builtinSession(input);
	const apiCapabilities = agent.host === "openrouter";
	return {
		conversation: "reconstructed",
		toolCalls: !apiCapabilities,
		commandExitCodes: !apiCapabilities,
		fileReads: !apiCapabilities,
		tokenUsage: true,
		readOnly: agent.host !== "cursor",
	};
}
async function initializeCustom(
	input: InitializeInput,
	adapterPath: string,
): Promise<AgentCapabilities> {
	const { agent, workspace, readOnly } = input;
	const url = adapterPath.startsWith("file:") ? adapterPath : pathToFileURL(adapterPath).href;
	const adapter = (await import(url)).default as AgentAdapter;
	if (!adapter?.createSession || !adapter.capabilities)
		throw new Error("Custom adapter must export defineAgent(...) as default");
	if (readOnly && !adapter.capabilities.readOnly)
		throw new Error("Judge requires an adapter with readOnly capability");
	session = await adapter.createSession({
		options: agent.options,
		workspace: { path: workspace },
		signal: signal.signal,
		readOnly,
	});
	return adapter.capabilities;
}
function builtinOptions(input: InitializeInput, prompt: string) {
	const { agent, workspace, readOnly } = input;
	const auth = agent.options.auth ?? { type: "subscription" };
	const apiKey = auth.type === "api-key" ? process.env[auth.env] : undefined;
	if (auth.type === "api-key" && !apiKey) throw new Error(`Missing API key in ${auth.env}`);
	return {
		cwd: workspace,
		prompt,
		apiKey,
		authMode: auth.type,
		includeGlobalSkills: agent.options.includeGlobalSkills === true,
		mcpServers: readOnly ? undefined : agent.options.mcpServers,
		failOnUserInput: true,
		onAgentEvent: (event: AgentEvent) => send("event", event),
	};
}
function runCursorBuiltin(common: ReturnType<typeof builtinOptions>, model: unknown) {
	return runCursorAgent({
		...common,
		model: typeof model === "string" && model ? { id: model } : undefined,
	});
}
async function runBuiltin(input: InitializeInput, prompt: string) {
	const common = builtinOptions(input, prompt);
	const { agent, readOnly } = input;
	switch (agent.host) {
		case "openai":
			return runOpenaiAgent({
				...common,
				model: agent.options.model,
				sandbox: readOnly ? "read-only" : "workspace-write",
				networkAccess: agent.options.networkAccess,
			});
		case "claude":
			return runClaudeAgent({
				...common,
				model: agent.options.model,
				loadProjectContext: true,
				readOnly,
			});
		case "openrouter":
			return runOpenRouterAgent({
				...common,
				model: agent.options.model,
				baseUrl: typeof agent.options.baseUrl === "string" ? agent.options.baseUrl : undefined,
				httpReferer:
					typeof agent.options.httpReferer === "string" ? agent.options.httpReferer : undefined,
				xTitle: typeof agent.options.xTitle === "string" ? agent.options.xTitle : undefined,
			});
		default:
			return runCursorBuiltin(common, agent.options.model);
	}
}
function builtinSession(input: InitializeInput): AdapterSession {
	const history: string[] = [];
	return {
		async *run(prompt) {
			const submitted = history.length
				? `Previous conversation (context only):\n${history.join("\n\n")}\n\nCurrent user request:\n${prompt}`
				: prompt;
			const result = await runBuiltin(input, submitted);
			if (result.status !== "completed") {
				send("event", { type: "trace", trace: result.trace });
				throw new Error(`Agent execution failed: ${JSON.stringify(result.trace.artifacts)}`);
			}
			const answer = result.trace.messages
				.filter((message) => message.role === "assistant")
				.map((message) => message.content)
				.join("\n");
			history.push(`User: ${prompt}`, `Assistant: ${answer}`);
			yield { type: "trace", trace: result.trace };
		},
		async close() {},
	};
}
function recordEvent(trace: AgentTrace, event: AgentEvent): AgentTrace {
	switch (event.type) {
		case "trace":
			return event.trace;
		case "text":
			trace.messages.push({ role: "assistant", content: event.text });
			break;
		case "tool":
			trace.toolCalls.push({
				name: event.name,
				args: event.args,
				result: event.result,
				exitCode: event.exitCode,
				succeeded: event.succeeded,
			});
			break;
		case "usage":
			trace.usage = event.usage;
			break;
	}
	return trace;
}
async function run(prompt: string) {
	let trace = empty();
	trace.messages.push({ role: "user", content: prompt });
	for await (const event of session.run(prompt)) {
		send("event", event);
		trace = recordEvent(trace, event);
	}
	send("result", trace);
}
process.on("SIGTERM", () => {
	signal.abort();
	cancelActiveClaudeRun();
	cancelActiveCursorRun();
	cancelActiveOpenaiRun();
	cancelActiveOpenRouterRun();
});
process.on("disconnect", () => {
	signal.abort();
	cancelActiveClaudeRun();
	cancelActiveCursorRun();
	cancelActiveOpenaiRun();
	process.exit(1);
});
process.on("message", async (raw) => {
	const message = raw as { type: string; value: unknown };
	try {
		if (message.type === "init")
			send("ready", await initialize(message.value as Parameters<typeof initialize>[0]));
		if (message.type === "run") await run(message.value as string);
		if (message.type === "close") {
			await session.close();
			send("closed");
		}
	} catch (error) {
		process.send?.({
			type: "error",
			error: error instanceof Error ? error.message : String(error),
		});
	}
});
