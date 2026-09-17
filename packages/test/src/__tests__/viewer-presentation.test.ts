import { expect, it } from "bun:test";
import { storedValue } from "../sdk/execution-reporter.js";
import { conversationPlaceholder, stripAnsi } from "../viewer/presentation.js";

it("viewer presentation › strips terminal color codes from assertion errors", () => {
	const error = "\u001b[31m+ Received\u001b[39m\n\u001b[2m  SEED-READY\u001b[22m";
	expect(stripAnsi(error)).toBe("+ Received\n  SEED-READY");
});

it("viewer presentation › distinguishes a pending conversation from a missing transcript", () => {
	expect(conversationPlaceholder("running")).toBe("Waiting for the first agent event…");
	expect(conversationPlaceholder("failed")).toBe("No conversation was captured.");
});

it("execution reporter › preserves useful command context while redacting private paths", () => {
	expect(
		storedValue({
			command: "cat /Users/example/private-workspace/seeded.txt",
			root: "/Users/example/private-workspace",
		}),
	).toEqual({ command: "cat <local-path>/seeded.txt", root: "<local-path>" });
});
