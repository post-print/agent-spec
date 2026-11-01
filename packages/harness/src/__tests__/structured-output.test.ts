import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { chmod, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { claude, createAgentSession, openai } from "../../dist/index.js";
import { codexAcceptsSchema } from "../../dist/openai-run.js";

const VERDICT_SCHEMA = {
	type: "object",
	properties: { correct: { type: "boolean" }, reason: { type: "string" } },
	required: ["correct", "reason"],
	additionalProperties: false,
};
const OPTIONAL_REASON = { ...VERDICT_SCHEMA, required: ["correct"] };

let directory = "";
async function fakeHost(name: string, body: string): Promise<string> {
	const path = join(directory, name);
	// The harness also asks the host for its version, which must not overwrite what a test records.
	await writeFile(path, `#!/bin/sh\n[ "$1" = "--version" ] && { echo 1; exit 0; }\n${body}\n`);
	await chmod(path, 0o755);
	return path;
}
const printLines = (lines: unknown[]) =>
	lines.map((line) => `cat <<'JSON'\n${JSON.stringify(line)}\nJSON`).join("\n");

interface HostRun {
	variable: "CLAUDE_CODE_BIN" | "CODEX_BIN";
	bin: string;
	agent: ReturnType<typeof claude> | ReturnType<typeof openai>;
	outputSchema?: object;
}
async function runHost({ variable, bin, agent, outputSchema }: HostRun) {
	const previous = process.env[variable];
	process.env[variable] = bin;
	const controller = new AbortController();
	try {
		const session = await createAgentSession({
			agent,
			workspace: directory,
			signal: controller.signal,
			readOnly: true,
			outputSchema,
		});
		try {
			return await session.run("Grade this.");
		} finally {
			await session.close();
		}
	} finally {
		controller.abort();
		if (previous === undefined) delete process.env[variable];
		else process.env[variable] = previous;
	}
}

beforeAll(async () => {
	directory = await realpath(await mkdtemp(join(tmpdir(), "structured-output-")));
});
afterAll(async () => {
	await rm(directory, { recursive: true, force: true });
});

describe("claude structured output", () => {
	const verdict = { correct: true, reason: "It read /etc/passwd, which the input forbids." };
	const lines = [
		{ type: "system", subtype: "init", tools: ["Read", "StructuredOutput"], model: "fake" },
		{ type: "assistant", message: { content: [{ type: "text", text: "Yes, it is." }] } },
		{
			type: "assistant",
			message: {
				content: [{ type: "tool_use", id: "t1", name: "StructuredOutput", input: verdict }],
			},
		},
		{
			type: "user",
			message: { content: [{ type: "tool_result", tool_use_id: "t1", content: "ok" }] },
		},
		{ type: "result", subtype: "success", is_error: false, structured_output: verdict },
	];

	it("sends the schema and returns the verdict apart from the prose", async () => {
		const argsFile = join(directory, "claude-args");
		const bin = await fakeHost(
			"claude-structured",
			`printf '%s\\n' "$@" > '${argsFile}'\n${printLines(lines)}`,
		);
		const trace = await runHost({
			variable: "CLAUDE_CODE_BIN",
			bin,
			agent: claude(),
			// Zod adds this key, and the real Claude CLI refuses a schema that keeps it.
			outputSchema: { $schema: "https://json-schema.org/draft/2020-12/schema", ...VERDICT_SCHEMA },
		});
		const args = (await readFile(argsFile, "utf8")).split("\n");
		expect(args[args.indexOf("--json-schema") + 1]).toBe(JSON.stringify(VERDICT_SCHEMA));
		expect(trace.structuredOutput).toEqual(verdict);
	});
	it("does not treat the verdict's words as a tool the agent ran", async () => {
		const bin = await fakeHost("claude-channel", printLines(lines));
		const trace = await runHost({
			variable: "CLAUDE_CODE_BIN",
			bin,
			agent: claude(),
			outputSchema: VERDICT_SCHEMA,
		});
		expect(trace.toolCalls.map((call) => call.name)).not.toContain("StructuredOutput");
	});
	it("sends no schema when none is asked for", async () => {
		const argsFile = join(directory, "claude-plain-args");
		const bin = await fakeHost(
			"claude-plain",
			`printf '%s\\n' "$@" > '${argsFile}'\n${printLines([
				{ type: "result", subtype: "success", is_error: false, result: "done" },
			])}`,
		);
		const trace = await runHost({ variable: "CLAUDE_CODE_BIN", bin, agent: claude() });
		expect(await readFile(argsFile, "utf8")).not.toContain("--json-schema");
		expect(trace.structuredOutput).toBeUndefined();
	});
});

const message = (text: string) => ({
	type: "item.completed",
	item: { type: "agent_message", text },
});
const completed = { type: "turn.completed", usage: { input_tokens: 1, output_tokens: 1 } };
/** Copies the schema while the run is alive, because the harness removes the file afterwards. */
const recordingSchema = (name: string) => `previous=""
for argument in "$@"; do
	if [ "$previous" = "--output-schema" ]; then cat "$argument" > '${join(directory, name)}'; fi
	previous="$argument"
done`;

const runCodex = (bin: string, outputSchema: object) =>
	runHost({ variable: "CODEX_BIN", bin, agent: openai(), outputSchema });

describe("codex structured output", () => {
	it("sends the schema and takes the verdict from the final message", async () => {
		const bin = await fakeHost(
			"codex-structured",
			`${recordingSchema("codex-schema")}\n${printLines([
				message("I will check the input first."),
				message('{"correct":false,"reason":"No."}'),
				completed,
			])}`,
		);
		const trace = await runCodex(bin, VERDICT_SCHEMA);
		expect(JSON.parse(await readFile(join(directory, "codex-schema"), "utf8"))).toEqual(
			VERDICT_SCHEMA,
		);
		expect(trace.structuredOutput).toEqual({ correct: false, reason: "No." });
	});
	it("leaves the verdict unset when the final message is not JSON", async () => {
		const bin = await fakeHost(
			"codex-prose",
			printLines([message("I think it is correct."), completed]),
		);
		const trace = await runCodex(bin, VERDICT_SCHEMA);
		expect(trace.structuredOutput).toBeUndefined();
	});
	it("sends a schema Codex would refuse only through the prompt", async () => {
		const argsFile = join(directory, "codex-optional-args");
		const bin = await fakeHost(
			"codex-optional",
			`printf '%s\\n' "$@" > '${argsFile}'\n${printLines([message('{"correct":true}'), completed])}`,
		);
		const trace = await runCodex(bin, OPTIONAL_REASON);
		expect(await readFile(argsFile, "utf8")).not.toContain("--output-schema");
		expect(trace.structuredOutput).toBeUndefined();
	});
});

describe("schemas Codex accepts", () => {
	const closed = (properties: Record<string, unknown>) => ({
		type: "object",
		properties,
		required: Object.keys(properties),
		additionalProperties: false,
	});
	const accepted: Record<string, object> = {
		"a closed object": VERDICT_SCHEMA,
		"an unconstrained field": closed({ input: {} }),
		"a nullable field": closed({ note: { anyOf: [{ type: "string" }, { type: "null" }] } }),
		"string and array limits": closed({
			name: { type: "string", minLength: 1, pattern: "^y" },
			list: { type: "array", items: { type: "string" }, minItems: 1 },
		}),
		"a nested closed object": closed({ nested: closed({ ok: { type: "boolean" } }) }),
	};
	const refused: Record<string, object> = {
		"an optional field": OPTIONAL_REASON,
		"an open object": { ...VERDICT_SCHEMA, additionalProperties: {} },
		"a root that is not an object": { type: "array", items: { type: "string" } },
		"a nested optional field": closed({ nested: OPTIONAL_REASON }),
		"an optional field inside a list": closed({ list: { type: "array", items: OPTIONAL_REASON } }),
		"a string format": closed({ email: { type: "string", format: "email" } }),
		"a tuple": closed({ pair: { type: "array", prefixItems: [{ type: "string" }] } }),
		"a boolean subschema": closed({ anything: true }),
	};
	for (const [name, schema] of Object.entries(accepted))
		it(`accepts ${name}`, () => expect(codexAcceptsSchema(schema)).toBe(true));
	for (const [name, schema] of Object.entries(refused))
		it(`refuses ${name}`, () => expect(codexAcceptsSchema(schema)).toBe(false));
});
