import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { isCliMain, resolveRealPath } from "../cli-entry.js";

describe("cli-entry", () => {
	it("matches identical resolved paths", () => {
		const path = join(tmpdir(), "agent-test-entry.js");
		expect(isCliMain(path, path)).toBe(true);
	});

	it("rejects when argv1 is undefined", () => {
		expect(isCliMain(undefined, "/tmp/cli.js")).toBe(false);
	});

	it("matches symlink argv to real entry path", async () => {
		const dir = await mkdtemp(join(tmpdir(), "agent-test-cli-entry-"));
		try {
			const realEntry = join(dir, "cli.js");
			const binDir = join(dir, "bin");
			const binLink = join(binDir, "agent-test");
			await writeFile(realEntry, "// entry\n");
			await mkdir(binDir);
			await symlink(realEntry, binLink);

			expect(isCliMain(binLink, realEntry)).toBe(true);
			expect(resolveRealPath(binLink)).toBe(resolveRealPath(realEntry));
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	it("falls back to resolve when path does not exist", () => {
		const missing = join(tmpdir(), "agent-test-missing-cli-entry.js");
		expect(resolveRealPath(missing)).toBe(resolve(missing));
		expect(isCliMain(missing, missing)).toBe(true);
	});
});
