import { afterEach, expect, it, mock } from "bun:test";

import { openrouter } from "../agent-definition.js";
import { runOpenRouterAgent } from "../openrouter-run.js";

const originalFetch = globalThis.fetch;

afterEach(() => {
	globalThis.fetch = originalFetch;
});

it("openrouter › streams assistant text and usage through the host-agnostic trace", async () => {
	let request: Request | undefined;
	globalThis.fetch = mock(async (input, init) => {
		request = new Request(input, init);
		return new Response(
			[
				'data: {"choices":[{"delta":{"content":"hello"}}]}\n\n',
				'data: {"choices":[{"delta":{"content":" world"}}]}\n\n',
				'data: {"choices":[],"usage":{"prompt_tokens":3,"completion_tokens":2,"total_tokens":5}}\n\n',
				"data: [DONE]\n\n",
			].join(""),
			{ headers: { "Content-Type": "text/event-stream" } },
		);
	}) as typeof fetch;

	const result = await runOpenRouterAgent({
		cwd: "/tmp/workspace",
		prompt: "Say hello",
		apiKey: "secret",
		model: "openai/gpt-4o-mini",
		httpReferer: "https://example.test",
		xTitle: "Agent test",
	});

	expect(result.status).toBe("completed");
	expect(result.trace.messages.at(-1)?.content).toBe("hello world");
	expect(result.trace.usage).toEqual({ inputTokens: 3, outputTokens: 2, totalTokens: 5 });
	expect(request?.url).toBe("https://openrouter.ai/api/v1/chat/completions");
	expect(request?.headers.get("authorization")).toBe("Bearer secret");
	expect(request?.headers.get("http-referer")).toBe("https://example.test");
	expect(request?.headers.get("x-title")).toBe("Agent test");
	expect(await request?.json()).toMatchObject({ model: "openai/gpt-4o-mini", stream: true });
});

it("openrouter › requires an API key and model", async () => {
	const missingKey = await runOpenRouterAgent({ cwd: "/tmp", prompt: "test", model: "model" });
	const missingModel = await runOpenRouterAgent({ cwd: "/tmp", prompt: "test", apiKey: "secret" });
	expect(missingKey.status).toBe("failed");
	expect(missingKey.trace.artifacts.openrouterError).toContain("OPENROUTER_API_KEY");
	expect(missingModel.trace.artifacts.openrouterError).toContain("requires a model");
});

it("openrouter › defaults authentication to OPENROUTER_API_KEY", () => {
	const definition = openrouter({ model: "openai/gpt-4o-mini" });
	expect(definition.host).toBe("openrouter");
	expect(definition.options.auth).toEqual({ type: "api-key", env: "OPENROUTER_API_KEY" });
});
