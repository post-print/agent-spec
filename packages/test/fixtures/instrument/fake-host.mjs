#!/usr/bin/env node
import { execSync } from "node:child_process";
import { tmpdir } from "node:os";

// A scripted Claude Code. The prompt names a scenario, so the real runner and capture code run.
const prompt = process.argv.join(" ");
const say = (event) => process.stdout.write(`${JSON.stringify(event)}\n`);
const message = (text) =>
	say({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text }] } });
const init = () =>
	say({
		type: "system",
		subtype: "init",
		tools: ["Bash"],
		model: "fake",
		claude_code_version: "1",
	});
const finish = (result = "done") =>
	say({ type: "result", subtype: "success", is_error: false, result });

if (process.argv.includes("--version")) {
	process.stdout.write("1 (Fake)\n");
	process.exit(0);
}
if (prompt.includes("SCENARIO_EMPTY")) process.exit(0);
if (prompt.includes("SCENARIO_READ_ONLY_FOLDER"))
	execSync("mkdir -p locked/sub && touch locked/sub/file && chmod -R a-w locked");
if (prompt.includes("SCENARIO_GARBAGE")) {
	process.stdout.write("not json\n");
	process.exit(0);
}
if (prompt.includes("SCENARIO_CRASH")) {
	process.stderr.write("segfault\n");
	process.kill(process.pid, "SIGKILL");
}
if (prompt.includes("SCENARIO_AUTH")) {
	process.stderr.write("Not logged in\n");
	process.exit(1);
}
init();
if (prompt.includes("SCENARIO_JUDGE_ENFORCED")) {
	message("Yes, that is right.");
	say({
		type: "result",
		subtype: "success",
		is_error: false,
		structured_output: { correct: true },
	});
	process.exit(0);
}
if (prompt.includes("SCENARIO_JUDGE_SLOW")) await new Promise((done) => setTimeout(done, 30_000));
if (prompt.includes("SCENARIO_JUDGE_ECHOES_SCHEMA")) {
	const reply = '{"type":"object","properties":{"correct":{"type":"boolean"}}}';
	message(reply);
	finish(reply);
	process.exit(0);
}
if (prompt.includes("SCENARIO_JUDGE_PROSE")) {
	message("I think it is correct.");
	finish();
	process.exit(0);
}
if (prompt.includes("SCENARIO_JUDGE_REFUSED")) {
	say({ type: "result", subtype: "error_during_execution", is_error: true, result: "refused" });
	process.exit(1);
}
if (prompt.includes("SCENARIO_MAX_TURNS")) {
	say({ type: "result", subtype: "error_max_turns", is_error: false });
	process.exit(0);
}
if (prompt.includes("SCENARIO_READ_ALLOWED_ROOT")) {
	// Names a file in a folder outside the workspace, as an agent reading runtime state would.
	const path = `${tmpdir()}/agent-test-allowed-root/state.json`;
	say({
		type: "assistant",
		message: {
			role: "assistant",
			content: [{ type: "tool_use", id: "t1", name: "Bash", input: { command: `cat ${path}` } }],
		},
	});
	say({
		type: "user",
		message: {
			role: "user",
			content: [{ type: "tool_result", tool_use_id: "t1", content: "{}", is_error: false }],
		},
	});
}
message("done");
finish();
