import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { chmod, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { claude, createAgentSession, customAgent, openai } from "../../dist/index.js";

const CODEX_MESSAGE = '{"type":"item.completed","item":{"type":"agent_message","text":"Working."}}';
const CODEX_DONE = '{"type":"turn.completed","usage":{"input_tokens":1,"output_tokens":1}}';
const CLAUDE_DONE = '{"type":"result","subtype":"success","is_error":false,"result":"Working."}';
type HostName = "claude" | "codex";

let directory = "";
let hostCounter = 0;
async function fakeHost(body: string): Promise<string> {
	hostCounter += 1;
	const path = join(directory, `host-${hostCounter}`);
	await writeFile(path, `#!/bin/sh\n${body}\n`);
	await chmod(path, 0o755);
	return path;
}
function line(event: object): string {
	return `echo '${JSON.stringify(event)}'`;
}
/** Through a session, so the worker's own classification and serialization are part of the proof. */
async function runHost(host: HostName, bin: string, prompt = "hi") {
	const variable = host === "claude" ? "CLAUDE_CODE_BIN" : "CODEX_BIN";
	const previous = process.env[variable];
	process.env[variable] = bin;
	const controller = new AbortController();
	const events: unknown[] = [];
	try {
		const session = await createAgentSession({
			agent: host === "claude" ? claude() : openai(),
			workspace: directory,
			signal: controller.signal,
		});
		try {
			const trace = await session.run(prompt, (event) => events.push(event));
			return { failure: undefined as unknown, trace, events };
		} catch (failure) {
			return { failure, trace: undefined, events };
		} finally {
			await session.close();
		}
	} finally {
		controller.abort();
		if (previous === undefined) delete process.env[variable];
		else process.env[variable] = previous;
	}
}
async function failureOf(host: HostName, body: string) {
	return (await runHost(host, await fakeHost(body))).failure as Error & { code?: string };
}
/** A failure the agent is charged with: an error carrying no infrastructure kind. */
function isRunFailure(failure: Error & { kind?: string }): boolean {
	return failure instanceof Error && failure.kind === undefined;
}
async function runCustomAdapter(fixture: string, options: Record<string, unknown>) {
	const controller = new AbortController();
	const adapter = new URL(`./fixtures/${fixture}`, import.meta.url).href;
	const session = await createAgentSession({
		agent: customAgent({ adapter, options }),
		workspace: directory,
		signal: controller.signal,
	});
	try {
		return await session.run("hi").then(
			() => undefined,
			(error: unknown) => error as Error & { kind?: string; code?: string },
		);
	} finally {
		// Close before abort: abort signals the worker's process group, which would hide an orphan.
		await session.close();
		controller.abort();
	}
}

beforeAll(async () => {
	directory = await realpath(await mkdtemp(join(tmpdir(), "host-failure-")));
});
afterAll(async () => {
	await rm(directory, { recursive: true, force: true });
});

describe("Codex transient errors", () => {
	it("a reconnect followed by turn.completed completes and keeps the error as evidence", async () => {
		const bin = await fakeHost(
			[
				line({ type: "error", message: "Reconnecting... 1/5" }),
				`echo '${CODEX_MESSAGE}'`,
				`echo '${CODEX_DONE}'`,
			].join("\n"),
		);
		const { failure, trace } = await runHost("codex", bin);
		expect(failure).toBeUndefined();
		expect(trace?.messages.at(-1)?.content).toBe("Working.");
		expect(trace?.artifacts.openaiResultError).toBeUndefined();
		expect(trace?.artifacts.openaiRecoveredErrors).toBe("Reconnecting... 1/5");
	});
	it("an error with no later turn.completed still fails", async () => {
		const body = line({ type: "error", message: "Reconnecting... 5/5" });
		for (const exit of ["exit 0", "exit 1"]) {
			const failure = await failureOf("codex", `${body}\n${exit}`);
			expect(failure).toMatchObject({ kind: "infrastructure", code: "host_exit" });
		}
	});
	it("turn.failed followed by turn.completed stays failed", async () => {
		const failure = await failureOf(
			"codex",
			`${line({ type: "turn.failed", error: { message: "model refused" } })}\necho '${CODEX_DONE}'`,
		);
		expect(isRunFailure(failure)).toBe(true);
	});
});

describe("the completeness gate fails closed", () => {
	it("Codex turn.failed with no message is a failure", async () => {
		expect(isRunFailure(await failureOf("codex", line({ type: "turn.failed" })))).toBe(true);
	});
	it("Codex thread.error with no message and no terminal event is a failure", async () => {
		const failure = await failureOf("codex", line({ type: "thread.error" }));
		expect(failure).toMatchObject({ kind: "infrastructure", code: "host_exit" });
	});
	it("Claude's unlisted result subtype is a failure", async () => {
		const failure = await failureOf("claude", line({ type: "result", subtype: "cancelled" }));
		expect(failure).toBeInstanceOf(Error);
	});
});

describe("agent text and incidental stderr never classify auth", () => {
	const cases: Array<[string, HostName, string]> = [
		[
			"Claude is_error prose",
			"claude",
			line({
				type: "result",
				subtype: "success",
				is_error: true,
				result: "The endpoint still returns 401 unauthorized.",
			}),
		],
		[
			"Claude terminal failure with an MCP 401 on stderr",
			"claude",
			`echo 'mcp server linear: 401 Unauthorized' >&2\n${line({ type: "result", subtype: "error_max_turns", is_error: false })}\nexit 1`,
		],
		[
			"Codex turn.failed with a login hint on stderr",
			"codex",
			`echo 'hint: run codex login' >&2\n${line({ type: "turn.failed", error: { message: "model refused" } })}\nexit 1`,
		],
		[
			"Codex turn.failed whose message quotes auth text mid-line",
			"codex",
			line({ type: "turn.failed", error: { message: "tool said: 401 unauthorized" } }),
		],
	];
	for (const [name, host, body] of cases) {
		it(name, async () => {
			expect(isRunFailure(await failureOf(host, body))).toBe(true);
		});
	}
	it("a plain adapter error stays a run failure whatever it says", async () => {
		const failure = await runCustomAdapter("throwing-adapter.mjs", { message: "unauthorized" });
		expect(failure?.message).toBe("unauthorized");
		expect(failure?.kind).toBeUndefined();
	});
});

const AUTH_SIGNALS: Array<[string, HostName, string]> = [
	[
		"Claude api_error_status 401",
		"claude",
		line({
			type: "result",
			subtype: "success",
			is_error: true,
			result: "anything",
			api_error_status: 401,
		}),
	],
	[
		"Claude api_error authentication_failed",
		"claude",
		line({
			type: "result",
			subtype: "success",
			is_error: true,
			result: "anything",
			api_error: "authentication_failed",
		}),
	],
	[
		"Claude Not logged in result",
		"claude",
		line({
			type: "result",
			subtype: "success",
			is_error: true,
			result: "Not logged in · Please run /login",
		}),
	],
	[
		"Codex turn.failed status 401",
		"codex",
		line({
			type: "turn.failed",
			error: { message: "unexpected status 401 Unauthorized: Missing bearer" },
		}),
	],
	["stderr before any terminal event", "codex", "echo 'Error: unauthorized' >&2\nexit 1"],
];
describe("structured host signals classify auth", () => {
	for (const [name, host, body] of AUTH_SIGNALS) {
		it(name, async () => {
			expect(await failureOf(host, body)).toMatchObject({ kind: "infrastructure", code: "auth" });
		});
	}
	it("a missing configured key is auth", async () => {
		const previous = process.env.AGENT_TEST_ABSENT_KEY;
		delete process.env.AGENT_TEST_ABSENT_KEY;
		const controller = new AbortController();
		const session = await createAgentSession({
			agent: openai({ auth: { type: "api-key", env: "AGENT_TEST_ABSENT_KEY" } }),
			workspace: directory,
			signal: controller.signal,
		});
		const failure = await session.run("hi").catch((error: unknown) => error);
		expect(failure).toMatchObject({ kind: "infrastructure", code: "auth" });
		controller.abort();
		if (previous !== undefined) process.env.AGENT_TEST_ABSENT_KEY = previous;
	});
});

describe("a bad exit after a reported success is the host's failure", () => {
	const success: Record<HostName, string> = {
		claude: `echo '${CLAUDE_DONE}'`,
		codex: `echo '${CODEX_MESSAGE}'\necho '${CODEX_DONE}'`,
	};
	for (const host of ["claude", "codex"] as const) {
		it(`${host} success then exit 1`, async () => {
			const failure = await failureOf(host, `${success[host]}\nexit 1`);
			expect(failure).toMatchObject({ kind: "infrastructure", code: "host_exit" });
		});
		it(`${host} success then killed by a signal`, async () => {
			const failure = await failureOf(host, `${success[host]}\nkill -9 $$`);
			expect(failure).toMatchObject({ kind: "infrastructure", code: "host_exit" });
		});
	}
});

describe("spawn failures", () => {
	for (const host of ["claude", "codex"] as const) {
		it(`${host} binary that cannot be executed (EACCES)`, async () => {
			const bin = await fakeHost("exit 0");
			await chmod(bin, 0o644);
			const { failure } = await runHost(host, bin);
			expect(failure).toMatchObject({ kind: "infrastructure", code: "host_exit" });
			expect(String((failure as Error).message)).toContain("EACCES");
		});
		it(`${host} prompt too large for argv (E2BIG)`, async () => {
			const bin = await fakeHost("exit 0");
			const { failure } = await runHost(host, bin, "x".repeat(4_000_000));
			expect(failure).toMatchObject({ kind: "infrastructure", code: "host_exit" });
			expect(String((failure as Error).message)).toContain("E2BIG");
		});
	}
});

const PROVIDER_SIGNALS: Array<[string, HostName, string]> = [
	[
		"Claude API Error: 529 text",
		"claude",
		line({
			type: "result",
			subtype: "success",
			is_error: true,
			result: "API Error: 529 Overloaded",
		}),
	],
	[
		"Claude api_error_status 429",
		"claude",
		line({
			type: "result",
			subtype: "success",
			is_error: true,
			result: "anything",
			api_error_status: 429,
		}),
	],
	[
		"Claude api_error overloaded",
		"claude",
		line({
			type: "result",
			subtype: "success",
			is_error: true,
			result: "anything",
			api_error: "overloaded",
		}),
	],
	[
		"Codex retry limit at 429",
		"codex",
		line({
			type: "turn.failed",
			error: { message: "exceeded retry limit, last status: 429 Too Many Requests" },
		}),
	],
	[
		"Codex status 529",
		"codex",
		line({ type: "turn.failed", error: { message: "unexpected status 529 Overloaded" } }),
	],
	[
		"Codex error event at 503 with no terminal event",
		"codex",
		line({ type: "error", message: "unexpected status 503 Service Unavailable" }),
	],
	["stderr overload before a terminal event", "claude", "echo '529 Overloaded' >&2\nexit 1"],
];
describe("provider outages say nothing about the agent", () => {
	for (const [name, host, body] of PROVIDER_SIGNALS) {
		it(name, async () => {
			expect(await failureOf(host, body)).toMatchObject({
				kind: "infrastructure",
				code: "provider_unavailable",
			});
		});
	}
	it("an ordinary Claude API error with a 400 stays a run failure", async () => {
		const failure = await failureOf(
			"claude",
			line({
				type: "result",
				subtype: "success",
				is_error: true,
				result: "API Error: 400 prompt too long",
				api_error_status: 400,
			}),
		);
		expect(isRunFailure(failure)).toBe(true);
	});
});

describe("secrets in failures", () => {
	it("a thrown adapter message is redacted", async () => {
		const secret = ["hunter", "2secret"].join("");
		const failure = await runCustomAdapter("throwing-adapter.mjs", {
			message: `connect ECONNREFUSED token=${secret}`,
		});
		expect(failure?.message).toContain("ECONNREFUSED");
		expect(failure?.message).not.toContain(secret);
	});
	for (const [host, event] of [
		["codex", (secret: string) => ({ type: "turn.failed", error: { message: `token=${secret}` } })],
		[
			"claude",
			(secret: string) => ({
				type: "result",
				subtype: "error_during_execution",
				errors: [`token=${secret}`],
			}),
		],
	] as const) {
		it(`${host} failure artifacts forwarded as events are redacted`, async () => {
			const secret = ["hunter", "2secret"].join("");
			const bin = await fakeHost(line(event(secret)));
			const { events } = await runHost(host, bin);
			expect(events.length).toBeGreaterThan(0);
			expect(JSON.stringify(events)).not.toContain(secret);
		});
	}
});

describe("worker crash", () => {
	it("takes the host process down with the worker", async () => {
		const pidFile = join(directory, "orphan.pid");
		const failure = await runCustomAdapter("orphaning-adapter.mjs", { pidFile });
		expect(failure).toMatchObject({ kind: "infrastructure", code: "worker_crash" });
		const pid = Number(await readFile(pidFile, "utf8"));
		expect(await processGone(pid)).toBe(true);
	});
});
async function processGone(pid: number): Promise<boolean> {
	for (let attempt = 0; attempt < 40; attempt += 1) {
		try {
			process.kill(pid, 0);
		} catch {
			return true;
		}
		await new Promise((resolve) => setTimeout(resolve, 50));
	}
	return false;
}
