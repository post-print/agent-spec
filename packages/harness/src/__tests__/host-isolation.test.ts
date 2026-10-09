import { expect, it } from "bun:test";
import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { claudeIsolationSettings } from "../host-isolation.js";

it("claudeIsolationSettings › sandboxes Bash and blocks file tools outside the workspace", () => {
	const settings = JSON.parse(
		claudeIsolationSettings({
			cwd: "/tmp/seal/workspace",
			readOnly: false,
			protectedPaths: ["/repo/checkout"],
		}),
	);
	expect(settings.sandbox).toMatchObject({
		enabled: true,
		failIfUnavailable: true,
		allowUnsandboxedCommands: false,
	});
	expect(settings.sandbox.filesystem.denyRead).toContain("/repo/checkout");
	expect(settings.sandbox.filesystem.denyRead).toContain(realpathSync(tmpdir()));
	expect(settings.sandbox.filesystem.allowRead).toContain("/tmp/seal/workspace");
	expect(settings.permissions).toEqual({
		blockReadsOutsideWorkingDirectories: true,
		deny: ["Read(//repo/checkout/**)"],
	});
});
