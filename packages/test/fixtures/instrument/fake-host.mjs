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
message("done");
finish();
