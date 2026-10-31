#!/usr/bin/env node
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
if (prompt.includes("SCENARIO_MAX_TURNS")) {
	say({ type: "result", subtype: "error_max_turns", is_error: false });
	process.exit(0);
}
message("done");
finish();
