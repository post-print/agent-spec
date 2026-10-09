import { expect, it } from "bun:test";
import { historyTurn, reconstructedPrompt } from "../conversation-history.js";

it("reconstructedPrompt › sends the first prompt unchanged", () => {
	expect(reconstructedPrompt([], "Remember 42.")).toBe("Remember 42.");
});

it("reconstructedPrompt › replays earlier text ahead of the new request", () => {
	const history = historyTurn("Remember 42.", "42");
	const prompt = reconstructedPrompt(history, "What did I ask?");
	expect(prompt).toBe(
		"Previous conversation (context only):\nUser: Remember 42.\n\nAssistant: 42\n\nCurrent user request:\nWhat did I ask?",
	);
});
