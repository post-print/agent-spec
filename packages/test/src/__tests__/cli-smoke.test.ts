import { execFile } from "node:child_process";
import { accessSync, constants } from "node:fs";
import { mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const repoRoot = resolve(packageRoot, "../..");
const cliJs = join(packageRoot, "dist/cli.js");
const fixturesDir = join(packageRoot, "fixtures");

function distCliExists(): boolean {
	try {
		accessSync(cliJs, constants.R_OK);
		return true;
	} catch {
		return false;
	}
}

describe("cli smoke", () => {
	it.skipIf(!distCliExists())("runs the smoke suite through a symlink like npm bin", async () => {
		const dir = await mkdtemp(join(tmpdir(), "agent-test-bin-"));
		try {
			const binDir = join(dir, "bin");
			const binLink = join(binDir, "agent-test");
			await mkdir(binDir);
			await symlink(cliJs, binLink);

			const { stdout, stderr } = await execFileAsync(
				process.execPath,
				[binLink, "--suites-dir", fixturesDir, "--suite", "smoke", "--workers", "2"],
				{
					cwd: repoRoot,
					env: {
						...process.env,
						// progress.ts suppresses chrome when VITEST is set (inherited from vitest).
						VITEST: undefined,
					},
				},
			);

			const ansiEscape = String.fromCharCode(27);
			const output = `${stdout}${stderr}`.replace(new RegExp(`${ansiEscape}\\[[0-9;]*m`, "g"), "");
			expect(output).toMatch(/smoke:.*passed/);
			expect(output).not.toMatch(/No suites found/);
			expect(output).toMatch(/HTML report:.*agent-test-report-.*report\.html/);
			expect(output).toMatch(/workers 2/);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});
});
