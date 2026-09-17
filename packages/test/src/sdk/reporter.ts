import { relative } from "node:path";
import type { FullConfig, Reporter, Suite, TestCase, TestResult } from "@playwright/test/reporter";

function sourceFile(test: TestCase): string {
	let suite: Suite | undefined = test.parent;
	while (suite && suite.type !== "file") suite = suite.parent;
	return suite?.location?.file ?? test.location.file;
}
const emit = (value: unknown) => process.stdout.write(`${JSON.stringify(value)}\n`);
export default class AgentViewerReporter implements Reporter {
	private buffers = new Map<string, string>();
	onBegin(_config: FullConfig, suite: Suite) {
		emit({
			type: "catalog",
			tests: suite.allTests().map((test) => ({
				id: test.id,
				title: test.titlePath().slice(3).join(" › ") || test.title,
				file: sourceFile(test),
				listFile: relative(_config.rootDir, sourceFile(test)).split("\\").join("/"),
				project: test.parent.project()?.name || "default",
			})),
		});
	}
	onStdOut(chunk: string | Buffer, test?: TestCase) {
		const id = test?.id ?? "global";
		const lines = ((this.buffers.get(id) ?? "") + chunk.toString()).split("\n");
		this.buffers.set(id, lines.pop() ?? "");
		for (const line of lines) this.emitLine(id, line);
	}
	private emitLine(id: string, line: string) {
		if (!line.startsWith("@@agent-test:")) {
			if (line.trim()) emit({ type: "log", text: line });
			return;
		}
		try {
			emit({ type: "event", testId: id, event: JSON.parse(line.slice("@@agent-test:".length)) });
		} catch {
			emit({ type: "log", text: line });
		}
	}

	onTestEnd(test: TestCase, result: TestResult) {
		emit({
			type: "result",
			testId: test.id,
			passed: result.status === test.expectedStatus,
			skipped: result.status === "skipped",
			durationMs: result.duration,
			errors: result.errors.map((error) => error.message ?? String(error)),
			status: result.status,
		});
	}
	onError(error: { message?: string }) {
		emit({ type: "error", message: error.message });
	}
}
