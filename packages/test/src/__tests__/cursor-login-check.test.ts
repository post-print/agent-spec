import { afterEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { cursorSdkAuthFilePath, setProcessAuthMode } from "@post-print/agent-harness";

import { missingAgentAuth, runDoctor } from "../doctor.js";

afterEach(() => {
	setProcessAuthMode(undefined);
});

describe("doctor Cursor SDK login file", () => {
	it("accepts a Cursor SDK login when CURSOR_AUTH_MODE=subscription", async () => {
		const prior = process.env.CURSOR_API_KEY;
		const priorMode = process.env.CURSOR_AUTH_MODE;
		const priorHome = process.env.HOME;
		const home = await mkdtemp(join(tmpdir(), "agent-test-sdk-login-"));
		delete process.env.CURSOR_API_KEY;
		process.env.CURSOR_AUTH_MODE = "subscription";
		process.env.HOME = home;
		try {
			await mkdir(join(home, ".cursor/sdk"), { recursive: true });
			await writeFile(cursorSdkAuthFilePath(home), '{"token":true}\n', "utf8");
			expect(missingAgentAuth("cursor")).toBeUndefined();
			const doctor = runDoctor();
			expect(doctor.cursorSdkAuthFilePresent).toBe(true);
			expect(doctor.messages.some((line) => line.includes("Cursor SDK login file: present"))).toBe(
				true,
			);
		} finally {
			if (prior === undefined) {
				delete process.env.CURSOR_API_KEY;
			} else {
				process.env.CURSOR_API_KEY = prior;
			}
			if (priorMode === undefined) {
				delete process.env.CURSOR_AUTH_MODE;
			} else {
				process.env.CURSOR_AUTH_MODE = priorMode;
			}
			if (priorHome === undefined) {
				delete process.env.HOME;
			} else {
				process.env.HOME = priorHome;
			}
			await rm(home, { recursive: true, force: true });
		}
	});
});
