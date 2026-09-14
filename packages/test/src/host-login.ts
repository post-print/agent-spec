import { spawn } from "node:child_process";
import { createInterface } from "node:readline/promises";

import type { AgentHost, HostAuthMode } from "@post-print/agent-harness";
import {
	CURSOR_AUTH_MODE_ENV,
	CURSOR_SDK_LOGIN_HINT,
	hasCursorSdkAuthFile,
	isInvalidCursorUserApiKey,
	loginCursorSdk,
	resolveHostAuthMode,
	resolveOpenaiBin,
} from "@post-print/agent-harness";

import type { SuiteRunReport } from "./types.js";

export function isInteractiveTty(stdin = process.stdin, stdout = process.stdout): boolean {
	return Boolean(stdin.isTTY && stdout.isTTY);
}

async function spawnInherited(command: string, args: string[]): Promise<number> {
	return await new Promise((resolve, reject) => {
		const child = spawn(command, args, { stdio: "inherit" });
		child.on("error", reject);
		child.on("exit", (code) => {
			resolve(code ?? 1);
		});
	});
}

/** Login for one host. Cursor uses the SDK store. Codex uses `codex login`. */
export async function runHostLogin(
	host: AgentHost,
	options?: {
		log?: (line: string) => void;
		loginCursor?: typeof loginCursorSdk;
		spawn?: typeof spawnInherited;
	},
): Promise<number> {
	const log = options?.log ?? ((line) => console.log(line));
	if (host === "cursor") {
		const login = options?.loginCursor ?? loginCursorSdk;
		log("Opening the Cursor SDK login in the browser.");
		const result = await login({
			onLoginUrl: (url) => {
				log(url);
			},
		});
		log(result.email ? `Logged in as ${result.email}.` : "Cursor SDK login stored.");
		return 0;
	}
	if (host === "openai") {
		const spawnLogin = options?.spawn ?? spawnInherited;
		const bin = await resolveOpenaiBin();
		log("Starting `codex login`.");
		return await spawnLogin(bin, ["login"]);
	}
	if (host === "claude") {
		log(
			"Run the Claude Code CLI login, then retry. agent-test does not invent a Claude key store.",
		);
		return 1;
	}
	log(`Host "${host}" has no login command.`);
	return 1;
}

/** On a TTY subscription run, log the Cursor SDK in when the store is empty. */
export async function ensureCursorSdkLoginForLive(options: {
	hosts: readonly AgentHost[];
	authMode?: HostAuthMode;
	tty?: boolean;
	log?: (line: string) => void;
	hasLoginFile?: () => boolean;
	loginCursor?: typeof loginCursorSdk;
}): Promise<void> {
	if (!options.hosts.includes("cursor")) {
		return;
	}
	const authMode = resolveHostAuthMode({
		envName: CURSOR_AUTH_MODE_ENV,
		raw: process.env[CURSOR_AUTH_MODE_ENV],
		explicit: options.authMode,
	});
	if (authMode === "api-key") {
		return;
	}
	const tty = options.tty ?? isInteractiveTty();
	if (!tty) {
		return;
	}
	const hasFile = options.hasLoginFile ?? hasCursorSdkAuthFile;
	if (hasFile()) {
		return;
	}
	const log = options?.log ?? ((line) => console.log(line));
	log("Cursor SDK login is required for a subscription run.");
	const login = options.loginCursor ?? loginCursorSdk;
	const result = await login({
		onLoginUrl: (url) => {
			log(url);
		},
	});
	log(result.email ? `Logged in as ${result.email}.` : "Cursor SDK login stored.");
}

export function reportsNeedCursorRelogin(reports: readonly SuiteRunReport[]): boolean {
	for (const report of reports) {
		for (const result of report.results) {
			for (const failure of result.failures) {
				if (isInvalidCursorUserApiKey(failure.message)) {
					return true;
				}
			}
			for (const verdict of result.judgeVerdicts ?? []) {
				if (
					isInvalidCursorUserApiKey(verdict.sdkError) ||
					isInvalidCursorUserApiKey(verdict.infraError)
				) {
					return true;
				}
			}
		}
	}
	return false;
}

async function confirmTty(question: string): Promise<boolean> {
	if (!isInteractiveTty()) {
		return false;
	}
	const rl = createInterface({ input: process.stdin, output: process.stdout });
	try {
		const answer = (await rl.question(question)).trim().toLowerCase();
		return answer === "y" || answer === "yes";
	} finally {
		rl.close();
	}
}

/** After Invalid User API Key, offer the same Cursor SDK login on a TTY. */
export async function offerCursorSdkReloginIfNeeded(options: {
	reports: readonly SuiteRunReport[];
	tty?: boolean;
	log?: (line: string) => void;
	confirm?: (question: string) => Promise<boolean>;
	loginCursor?: typeof loginCursorSdk;
}): Promise<boolean> {
	if (!reportsNeedCursorRelogin(options.reports)) {
		return false;
	}
	const log = options.log ?? ((line) => console.log(line));
	log(`Cursor SDK login is invalid. ${CURSOR_SDK_LOGIN_HINT}`);
	const tty = options.tty ?? isInteractiveTty();
	if (!tty) {
		return false;
	}
	const confirm = options.confirm ?? confirmTty;
	const accepted = await confirm("Log in again? [y/N] ");
	if (!accepted) {
		return false;
	}
	const login = options.loginCursor ?? loginCursorSdk;
	const result = await login({
		onLoginUrl: (url) => {
			log(url);
		},
	});
	log(result.email ? `Logged in as ${result.email}.` : "Cursor SDK login stored.");
	return true;
}
