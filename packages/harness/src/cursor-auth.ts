import { statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** Default SDK login store. The Cursor app login does not write this file. */
const INVALID_USER_KEY = /invalid user api key/i;
const INVALID_KEY_CODE = /invalid.?user.?api.?key/i;

export const CURSOR_SDK_AUTH_REL = ".cursor/sdk/auth.json";

export const CURSOR_SDK_LOGIN_HINT =
	"Run `agent-test login`. The Cursor app login does not feed the SDK.";

export const CURSOR_SDK_AUTH_TOO_OLD =
	"@cursor/sdk 1.0.27 or newer is required for Cursor.auth.login()";

export interface CursorSdkLoginPublicResult {
	email?: string;
	apiKeyExpiresAtMs?: number;
}

export type CursorSdkAuthStatus =
	| { status: "logged-in"; email?: string; apiKeyExpiresAtMs?: number }
	| { status: "logged-out" };

export interface CursorSdkAuthClient {
	login: (options?: {
		onLoginUrl?: (url: string) => void;
		openBrowser?: boolean | ((url: string) => void | Promise<void>);
		signal?: AbortSignal;
		apiKeyName?: string;
	}) => Promise<{ apiKey: string; email?: string; apiKeyExpiresAtMs?: number }>;
	status: () => Promise<{
		status: "logged-in" | "logged-out";
		email?: string;
		apiKeyExpiresAtMs?: number;
	}>;
}

/** Absolute path of the SDK login file under `home`. */
export function cursorSdkAuthFilePath(home = process.env.HOME ?? homedir()): string {
	return join(home, CURSOR_SDK_AUTH_REL);
}

/** True when the SDK login file exists and is not empty. Does not read the key. */
export function hasCursorSdkAuthFile(home = process.env.HOME ?? homedir()): boolean {
	try {
		return statSync(cursorSdkAuthFilePath(home)).size > 0;
	} catch {
		return false;
	}
}

/** True when the error is a rejected or expired Cursor user API key. */
export function isInvalidCursorUserApiKey(error: unknown): boolean {
	if (typeof error === "string") {
		return INVALID_USER_KEY.test(error);
	}
	if (!error || typeof error !== "object") {
		return false;
	}
	const record = error as { message?: unknown; code?: unknown };
	if (typeof record.message === "string" && INVALID_USER_KEY.test(record.message)) {
		return true;
	}
	return typeof record.code === "string" && INVALID_KEY_CODE.test(record.code);
}

/** Add the login hint when the SDK rejects the stored user key. */
export function wrapCursorSdkAuthError(error: unknown): unknown {
	if (!isInvalidCursorUserApiKey(error)) {
		return error;
	}
	const message = error instanceof Error ? error.message : String(error);
	if (message.includes("agent-test login")) {
		return error;
	}
	const wrapped = new Error(`${message}. ${CURSOR_SDK_LOGIN_HINT}`);
	if (error instanceof Error) {
		wrapped.cause = error;
	}
	return wrapped;
}

async function loadCursorSdkAuthClient(): Promise<CursorSdkAuthClient> {
	const sdkModule = await import("@cursor/sdk");
	const auth = (
		sdkModule as {
			Cursor?: { auth?: CursorSdkAuthClient };
		}
	).Cursor?.auth;
	if (!auth?.login || !auth.status) {
		throw new Error(CURSOR_SDK_AUTH_TOO_OLD);
	}
	return auth;
}

/**
 * Browser login. Stores the minted key in the SDK login file.
 * The return value never includes the key.
 */
export async function loginCursorSdk(options?: {
	auth?: CursorSdkAuthClient;
	onLoginUrl?: (url: string) => void;
	openBrowser?: boolean | ((url: string) => void | Promise<void>);
	signal?: AbortSignal;
	apiKeyName?: string;
}): Promise<CursorSdkLoginPublicResult> {
	const auth = options?.auth ?? (await loadCursorSdkAuthClient());
	const result = await auth.login({
		onLoginUrl: options?.onLoginUrl,
		openBrowser: options?.openBrowser,
		signal: options?.signal,
		apiKeyName: options?.apiKeyName ?? "agent-test",
	});
	return {
		email: result.email,
		apiKeyExpiresAtMs: result.apiKeyExpiresAtMs,
	};
}

/** Current SDK login status. Does not return the key. */
export async function readCursorSdkAuthStatus(options?: {
	auth?: CursorSdkAuthClient;
}): Promise<CursorSdkAuthStatus> {
	const auth = options?.auth ?? (await loadCursorSdkAuthClient());
	const status = await auth.status();
	if (status.status === "logged-in") {
		return {
			status: "logged-in",
			email: status.email,
			apiKeyExpiresAtMs: status.apiKeyExpiresAtMs,
		};
	}
	return { status: "logged-out" };
}
