const EXPECTED_DIFF_HEADER = /^-\s+Expected\s+-\s+\d+\s*$/;
const RECEIVED_DIFF_HEADER = /^\+\s+Received\s+\+\s+\d+\s*$/;

export function stripAnsi(value: string): string {
	let output = "";
	for (let index = 0; index < value.length; index++) {
		if (value.charCodeAt(index) !== 27 || value[index + 1] !== "[") {
			output += value[index];
			continue;
		}
		index += 2;
		while (index < value.length) {
			const code = value.charCodeAt(index);
			if (code >= 64 && code <= 126) break;
			index++;
		}
	}
	return output;
}

export function conversationPlaceholder(status: string): string {
	return status === "running"
		? "Waiting for the first agent event…"
		: "No conversation was captured.";
}

export type AssertionComparison = { expected: string; received: string };

export function assertionComparison(value: string): AssertionComparison | undefined {
	const lines = stripAnsi(value).split("\n");
	const expectedHeader = lines.findIndex((line) => EXPECTED_DIFF_HEADER.test(line));
	const receivedHeader = lines.findIndex((line) => RECEIVED_DIFF_HEADER.test(line));
	if (expectedHeader < 0 || receivedHeader !== expectedHeader + 1) return undefined;
	const expected: string[] = [];
	const received: string[] = [];
	for (const line of lines.slice(receivedHeader + 1)) {
		if (line.startsWith("- ")) expected.push(line.slice(2));
		if (line.startsWith("+ ")) received.push(line.slice(2));
		if (line.startsWith("  ")) {
			expected.push(line.slice(2));
			received.push(line.slice(2));
		}
	}
	return { expected: expected.join("\n"), received: received.join("\n") };
}
