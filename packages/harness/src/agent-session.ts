import { fork } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { AgentCapabilities, AgentDefinition, AgentEvent } from "./agent-definition.js";
import type { AgentTrace } from "./types.js";

export interface HarnessSession {
	capabilities: AgentCapabilities;
	run(prompt: string, onEvent?: (event: AgentEvent) => void): Promise<AgentTrace>;
	close(): Promise<void>;
}
interface SessionInput {
	agent: AgentDefinition;
	workspace: string;
	signal: AbortSignal;
	readOnly?: boolean;
}
class SessionWorker {
	private readonly child = fork(fileURLToPath(new URL("./agent-worker.js", import.meta.url)), [], {
		stdio: ["ignore", "ignore", "pipe", "ipc"],
		detached: process.platform !== "win32",
		execArgv: [],
		env: { ...process.env, AGENT_HARNESS_SESSION_WORKER: "1" },
	});
	private readonly exited: Promise<void>;
	private stderr = "";
	private pending?: { resolve(value: unknown): void; reject(error: Error): void };
	private listener?: (event: AgentEvent) => void;
	private closed = false;
	private busy = false;
	private closing?: Promise<void>;
	constructor(private readonly input: SessionInput) {
		this.exited = new Promise((resolve) => {
			this.child.once("exit", () => resolve());
			this.child.once("error", () => resolve());
		});
		this.child.stderr?.on("data", (chunk) => {
			this.stderr = (this.stderr + chunk).slice(-8192);
		});
		this.child.on("message", (raw) => this.receive(raw));
		this.child.on("error", (error) => this.fail(error));
		this.child.on("exit", (code, signal) => {
			this.closed = true;
			this.fail(new Error(`Agent worker exited (${signal ?? code}): ${this.stderr}`));
		});
		input.signal.addEventListener("abort", this.abort, { once: true });
		if (input.signal.aborted) this.abort();
	}
	private fail(error: Error) {
		this.pending?.reject(error);
		this.pending = undefined;
	}
	private receive(raw: unknown) {
		const message = raw as { type: string; value: unknown; error?: string };
		if (message.type === "event") {
			try {
				this.listener?.(message.value as AgentEvent);
			} catch (error) {
				this.fail(error as Error);
				this.abort();
			}
		} else if (message.type === "error") this.fail(new Error(message.error));
		else {
			this.pending?.resolve(message.value);
			this.pending = undefined;
		}
	}
	private request(message: object): Promise<unknown> {
		return new Promise((resolve, reject) => {
			if (this.closed) {
				reject(new Error("Agent session is closed"));
				return;
			}
			this.pending = { resolve, reject };
			this.child.send(message, (error) => {
				if (error) this.fail(error);
			});
		});
	}
	private kill = () => {
		if (!this.child.pid) return;
		try {
			if (process.platform === "win32") this.child.kill("SIGKILL");
			else process.kill(-this.child.pid, "SIGKILL");
		} catch {
			/* Already exited. */
		}
	};
	private abort = () => {
		this.closed = true;
		this.fail(new Error("Agent session cancelled"));
		try {
			if (this.child.pid && process.platform !== "win32") process.kill(-this.child.pid, "SIGTERM");
			else this.child.kill("SIGTERM");
		} catch {
			/* Already exited. */
		}
		setTimeout(this.kill, 500).unref();
	};
	async initialize(): Promise<HarnessSession> {
		try {
			const { agent, workspace, readOnly } = this.input;
			const capabilities = (await this.request({
				type: "init",
				value: { agent, workspace, readOnly: readOnly === true },
			})) as AgentCapabilities;
			return {
				capabilities,
				run: (prompt, onEvent) => this.run(prompt, onEvent),
				close: () => this.close(),
			};
		} catch (error) {
			this.input.signal.removeEventListener("abort", this.abort);
			this.kill();
			await this.exited;
			throw error;
		}
	}
	private async run(prompt: string, onEvent?: (event: AgentEvent) => void): Promise<AgentTrace> {
		this.input.signal.throwIfAborted();
		if (this.busy)
			throw new Error("Overlapping runs on one session are not supported; use variants");
		this.busy = true;
		this.listener = onEvent;
		try {
			return (await this.request({ type: "run", value: prompt })) as AgentTrace;
		} finally {
			this.busy = false;
			this.listener = undefined;
		}
	}
	private close(): Promise<void> {
		this.closing ??= this.dispose();
		return this.closing;
	}
	private async dispose() {
		this.input.signal.removeEventListener("abort", this.abort);
		if (this.closed) {
			await this.exited;
			return;
		}
		if (this.busy) {
			this.abort();
			await this.exited;
			return;
		}
		const timer = setTimeout(this.kill, 2000);
		try {
			await this.request({ type: "close" });
		} finally {
			clearTimeout(timer);
			this.kill();
			this.closed = true;
			await this.exited;
		}
	}
}
/** Each session owns a worker and all mutable host state within it. */
export function createAgentSession(input: SessionInput): Promise<HarnessSession> {
	input.signal.throwIfAborted();
	return new SessionWorker(input).initialize();
}
