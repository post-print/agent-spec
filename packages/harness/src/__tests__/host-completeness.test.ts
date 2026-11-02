import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { chmod, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
	AgentOutcomeError,
	claude,
	createAgentSession,
	customAgent,
	openai,
} from "../../dist/index.js";

const MESSAGE_LINE = {
	claude: '{"type":"assistant","message":{"content":[{"type":"text","text":"Working."}]}}',
	codex: '{"type":"item.completed","item":{"type":"agent_message","text":"Working."}}',
};
const TERMINAL_LINE = {
	claude: '{"type":"result","subtype":"success","is_error":false,"result":"Working."}',
	codex: '{"type":"turn.completed","usage":{"input_tokens":1,"output_tokens":1}}',
};
type HostName = keyof typeof MESSAGE_LINE;

let directory = "";
async function fakeHost(name: string, body: string): Promise<string> {
	const path = join(directory, name);
	await writeFile(path, `#!/bin/sh\n${body}\n`);
	await chmod(path, 0o755);
	return path;
}
/** Through a session: its worker process keeps this file clear of module mocks in other tests. */
async function runHost(host: HostName, bin: string) {
	const variable = host === "claude" ? "CLAUDE_CODE_BIN" : "CODEX_BIN";
	const previous = process.env[variable];
	process.env[variable] = bin;
	const controller = new AbortController();
	try {
		const session = await createAgentSession({
			agent: host === "claude" ? claude() : openai(),
			workspace: directory,
			signal: controller.signal,
		});
		try {
			const trace = await session.run("hi");
			return { failure: undefined as unknown, trace };
		} catch (failure) {
			return { failure, trace: undefined };
		} finally {
			await session.close();
		}
	} finally {
		controller.abort();
		if (previous === undefined) delete process.env[variable];
		else process.env[variable] = previous;
	}
}
function hostScenarios(host: HostName) {
	return {
		empty: "exit 0",
		garbage: "echo not-json\necho also-not-json\nexit 0",
		truncated: `echo '${MESSAGE_LINE[host]}'\nexit 0`,
		"killed by a signal": `echo '${MESSAGE_LINE[host]}'\nkill -9 $$`,
		"non-zero exit": `echo 'boom' >&2\nexit 3`,
	};
}

beforeAll(async () => {
	directory = await realpath(await mkdtemp(join(tmpdir(), "host-completeness-")));
});
afterAll(async () => {
	await rm(directory, { recursive: true, force: true });
});

for (const host of ["claude", "codex"] as const) {
	describe(`${host} run completeness`, () => {
		for (const [scenario, body] of Object.entries(hostScenarios(host))) {
			it(`${scenario} output is not a completed run`, async () => {
				const bin = await fakeHost(`${host}-${scenario.replaceAll(" ", "-")}`, body);
				const { failure, trace } = await runHost(host, bin);
				expect(failure).toBeInstanceOf(Error);
				expect(trace).toBeUndefined();
			});
		}
		it("exit 0 with no terminal event is named capture_incomplete", async () => {
			const { failure } = await runHost(host, await fakeHost(`${host}-silent`, "exit 0"));
			expect(String(failure)).toContain("capture_incomplete");
		});
		it("a terminal event completes the run", async () => {
			const bin = await fakeHost(
				`${host}-complete`,
				`echo '${MESSAGE_LINE[host]}'\necho '${TERMINAL_LINE[host]}'`,
			);
			const { trace } = await runHost(host, bin);
			expect(trace?.messages.at(-1)?.content).toBe("Working.");
		});
		it("counts output lines it could not parse", async () => {
			const bin = await fakeHost(
				`${host}-noisy`,
				`echo not-json\necho '${MESSAGE_LINE[host]}'\necho '${TERMINAL_LINE[host]}'`,
			);
			const { trace } = await runHost(host, bin);
			expect(trace?.artifacts.droppedOutputLines).toBe("1");
		});
	});
}

it("Claude error result subtypes fail even when is_error is false", async () => {
	const bin = await fakeHost(
		"claude-max-turns",
		`echo '{"type":"result","subtype":"error_max_turns","is_error":false}'`,
	);
	const { failure } = await runHost("claude", bin);
	expect(String(failure)).toContain("error_max_turns");
});

async function sessionFailure(host: HostName, bin: string): Promise<unknown> {
	return (await runHost(host, bin)).failure;
}

for (const host of ["claude", "codex"] as const) {
	describe(`${host} session failures are typed`, () => {
		it("an empty run is capture_incomplete", async () => {
			const failure = await sessionFailure(host, await fakeHost(`${host}-s-empty`, "exit 0"));
			expect(failure).toMatchObject({ kind: "infrastructure", code: "capture_incomplete" });
		});
		it("a crash without a terminal event is host_exit with stderr", async () => {
			const bin = await fakeHost(`${host}-s-crash`, "echo 'segfault here' >&2\nexit 3");
			const failure = await sessionFailure(host, bin);
			expect(failure).toMatchObject({ kind: "infrastructure", code: "host_exit" });
			expect(String((failure as Error).message)).toContain("segfault here");
		});
		it("an auth failure is auth, not agent failure", async () => {
			const bin = await fakeHost(`${host}-s-auth`, "echo 'Not logged in' >&2\nexit 1");
			const failure = await sessionFailure(host, bin);
			expect(failure).toMatchObject({ kind: "infrastructure", code: "auth" });
		});
		it("a missing binary is binary_missing", async () => {
			const failure = await sessionFailure(host, join(directory, "does-not-exist"));
			expect(failure).toMatchObject({ kind: "infrastructure", code: "binary_missing" });
		});
	});
}

describe("session failure messages", () => {
	it("redacts secrets from the stderr tail", async () => {
		const bin = await fakeHost(
			"claude-s-secret",
			"echo 'failed with key sk-ant-abc123def456 and token=hunter2 Bearer abc.def' >&2\nexit 3",
		);
		const message = String(((await sessionFailure("claude", bin)) as Error).message);
		expect(message).not.toContain("sk-ant-abc123def456");
		expect(message).not.toContain("hunter2");
		expect(message).not.toContain("abc.def");
	});
	it("a terminal failure is the agent's own outcome, not infrastructure", async () => {
		const bin = await fakeHost(
			"claude-s-max-turns",
			`echo '{"type":"result","subtype":"error_max_turns","is_error":false}'`,
		);
		const failure = await sessionFailure("claude", bin);
		expect(failure).toBeInstanceOf(AgentOutcomeError);
		expect((failure as Error).message).toContain("error_max_turns");
	});
});

describe("host report", () => {
	it("reads what Claude says it started with from its init event", async () => {
		const init = JSON.stringify({
			type: "system",
			subtype: "init",
			tools: ["Bash", "mcp__tasks__get_task"],
			mcp_servers: [{ name: "tasks", status: "connected" }],
			model: "claude-test",
			claude_code_version: "9.9.9",
			skills: ["release-note"],
		});
		const bin = await fakeHost("claude-init", `echo '${init}'\necho '${TERMINAL_LINE.claude}'`);
		const { trace } = await runHost("claude", bin);
		expect(trace?.hostReport).toEqual({
			tools: ["Bash", "mcp__tasks__get_task"],
			mcpServers: [{ name: "tasks", status: "connected" }],
			model: "claude-test",
			version: "9.9.9",
			skills: ["release-note"],
		});
	});
	it("session conditions name the host, version and confinement", async () => {
		const bin = await fakeHost("codex-versioned", `echo 'codex-cli 7.7.7'\nexit 0`);
		const previous = process.env.CODEX_BIN;
		process.env.CODEX_BIN = bin;
		const controller = new AbortController();
		try {
			const session = await createAgentSession({
				agent: openai(),
				workspace: directory,
				signal: controller.signal,
			});
			expect(await session.conditions).toMatchObject({
				host: "openai",
				binary: bin,
				binaryVersion: "codex-cli 7.7.7",
				confinement: "host-enforced",
				network: "disabled",
				overridingEnv: ["CODEX_BIN"],
			});
			await session.close();
		} finally {
			controller.abort();
			if (previous === undefined) delete process.env.CODEX_BIN;
			else process.env.CODEX_BIN = previous;
		}
	});
});

it("a worker that dies mid-run is worker_crash with a redacted tail", async () => {
	const controller = new AbortController();
	const adapter = new URL("./fixtures/crashing-adapter.mjs", import.meta.url).href;
	const session = await createAgentSession({
		agent: customAgent({ adapter, options: {} }),
		workspace: directory,
		signal: controller.signal,
	});
	const failure = await session.run("hi").then(
		() => undefined,
		(error: unknown) => error,
	);
	expect(failure).toMatchObject({ kind: "infrastructure", code: "worker_crash" });
	expect(String((failure as Error).message)).not.toContain("hunter2");
	controller.abort();
});
