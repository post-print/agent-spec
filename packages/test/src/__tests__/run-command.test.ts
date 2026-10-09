import { expect, it } from "bun:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCommand } from "../sdk/run-command.js";

it("runCommand › reports exit codes and output from the given directory", async () => {
	const directory = await mkdtemp(join(tmpdir(), "run-command-"));
	await writeFile(join(directory, "marker.txt"), "here");
	const passed = await runCommand(directory, ["cat", "marker.txt"]);
	expect(passed).toEqual({ exitCode: 0, stdout: "here", stderr: "" });
	const failed = await runCommand(directory, ["sh", "-c", "echo bad >&2; exit 3"]);
	expect(failed.exitCode).toBe(3);
	expect(failed.stderr).toBe("bad\n");
});

it("runCommand › passes arguments without a shell", async () => {
	const directory = await mkdtemp(join(tmpdir(), "run-command-"));
	const result = await runCommand(directory, ["echo", "$HOME", "a|b"]);
	expect(result.stdout).toBe("$HOME a|b\n");
});

it("runCommand › rejects on timeout and on a missing program", async () => {
	const directory = await mkdtemp(join(tmpdir(), "run-command-"));
	await expect(runCommand(directory, ["sleep", "5"], { timeoutMs: 50 })).rejects.toThrow(
		"failed to complete",
	);
	await expect(runCommand(directory, ["definitely-not-a-program-xyz"])).rejects.toThrow(
		"failed to complete",
	);
});
