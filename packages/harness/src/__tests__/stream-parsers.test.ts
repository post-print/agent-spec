import { expect, it } from "bun:test";
import { parseClaudeStream, parseCodexStream } from "../../dist/index.js";

const CLAUDE = [
	'{"type":"system","subtype":"init","model":"claude-x","claude_code_version":"2.1.0","tools":["Bash"]}',
	'{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"Listing."},{"type":"tool_use","id":"t1","name":"Bash","input":{"command":"ls"}}]}}',
	'{"type":"user","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"t1","content":"a.txt","is_error":false}]}}',
	"not an event",
	'{"type":"result","subtype":"success","is_error":false,"result":"a.txt"}',
].join("\n");

it("parseClaudeStream › builds the trace a live run would, and counts lines that are not events", () => {
	const trace = parseClaudeStream(CLAUDE);
	expect(trace.toolCalls).toMatchObject([
		{ name: "Bash", args: { command: "ls" }, result: "a.txt" },
	]);
	expect(trace.shellCommands).toContain("ls");
	expect(trace.hostReport).toMatchObject({ version: "2.1.0", model: "claude-x" });
	expect(trace.artifacts.droppedOutputLines).toBe("1");
});
it("parseCodexStream › builds the trace a live run would", () => {
	const trace = parseCodexStream(
		[
			'{"type":"item.completed","item":{"type":"agent_message","text":"I will list files."}}',
			'{"type":"item.completed","item":{"type":"command_execution","command":"ls","aggregated_output":"a.txt","exit_code":0}}',
			'{"type":"turn.completed","usage":{"input_tokens":3,"output_tokens":1}}',
		].join("\n"),
	);
	expect(trace.toolCalls[0]).toMatchObject({ name: "Shell", exitCode: 0, succeeded: true });
	expect(trace.messages.map(({ content }) => content)).toEqual(["I will list files."]);
});
