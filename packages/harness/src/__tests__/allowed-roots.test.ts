import { describe, expect, it } from "bun:test";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { resolveAllowedRoots } from "../allowed-roots.js";
import { claudeIsolationSettings, codexPermissionArgs } from "../host-isolation.js";
import { toolPathsOutsideWorkspace } from "../sealed-workspace.js";
import type { AgentTrace } from "../types.js";

// A literal shell variable, which the resolver expands; not a template.
const BRACED_HOME = ["$", "{HOME}/postprint"].join("");
const open = { protectedPaths: ["/checkout"], sealHome: false };
const resolveOne = (root: string, guard = open) => resolveAllowedRoots([root], guard)[0] ?? "";

describe("resolveAllowedRoots", () => {
	it("expands ~, $HOME and $TMPDIR as this process sees them", () => {
		expect(resolveOne("~/postprint")).toBe(join(homedir(), "postprint"));
		expect(resolveOne(BRACED_HOME)).toBe(join(homedir(), "postprint"));
		expect(resolveOne("$TMPDIR/postprint")).toEndWith("/postprint");
		expect(resolveOne("/srv/runtime")).toBe("/srv/runtime");
	});
	it("refuses a root that is relative, everything, or contains the temp folder or home", () => {
		expect(() => resolveOne("postprint")).toThrow("must be absolute");
		expect(() => resolveOne("/")).toThrow("whole filesystem");
		expect(() => resolveOne("$TMPDIR")).toThrow("temp folder");
		expect(() => resolveOne(tmpdir())).toThrow("temp folder");
		expect(() => resolveOne("~")).toThrow("home folder");
		expect(() => resolveOne(join(homedir(), ".."))).toThrow("home folder");
	});
	it("refuses a root that overlaps the caller checkout either way", () => {
		expect(() => resolveOne("/checkout/answers")).toThrow("caller checkout");
		expect(() => resolveOne("/")).toThrow();
	});
	it("refuses a root in the real home when the home is sealed", () => {
		expect(() => resolveOne("~/postprint", { ...open, sealHome: true })).toThrow("--verdict-grade");
		expect(resolveOne("/srv/runtime", { ...open, sealHome: true })).toBe("/srv/runtime");
	});
});

describe("an allowed root at the boundary", () => {
	const trace = (command: string): AgentTrace => ({
		messages: [],
		toolCalls: [{ name: "Bash", args: { command } }],
		shellCommands: [command],
		artifacts: {},
	});
	const allowed = join(homedir(), "postprint");
	it("is no escape to name, while a folder beside it still is", () => {
		const boundary = { allowedRoots: [allowed] };
		expect(
			toolPathsOutsideWorkspace(trace(`cat ${allowed}/state.json`), "/work", boundary),
		).toEqual([]);
		expect(toolPathsOutsideWorkspace(trace(`cat ${allowed}-other/x`), "/work", boundary)).toEqual([
			`${allowed}-other/x`,
		]);
		expect(toolPathsOutsideWorkspace(trace(`cat ${allowed}/state.json`), "/work")).toEqual([
			`${allowed}/state.json`,
		]);
	});
	it("is readable on Claude and Codex", () => {
		const isolation = {
			cwd: "/work",
			readOnly: false,
			protectedPaths: [],
			allowedRoots: [allowed],
		};
		const settings = JSON.parse(claudeIsolationSettings(isolation));
		expect(settings.sandbox.filesystem.allowRead).toContain(allowed);
		expect(settings.permissions.additionalDirectories).toContain(allowed);
		expect(codexPermissionArgs(isolation).join(" ")).toContain(`"${allowed}"="read"`);
	});
});
