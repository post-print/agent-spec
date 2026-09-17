import { expect, it } from "bun:test";
import { SKILL_ROOTS, skillNameFromWorkflowPath, skillOverlayRelPath } from "../skills-context.js";

it("recognizes skill manifests and references across native hosts", () => {
	for (const root of SKILL_ROOTS) {
		expect(skillNameFromWorkflowPath(`${root}/probe/SKILL.md`)).toBe("probe");
		expect(skillNameFromWorkflowPath(`${root}/probe/references/guide.md`)).toBe("probe");
		expect(skillOverlayRelPath(`${root}/probe/SKILL.md`)).toBe(`${root}/probe`);
	}
	expect(skillNameFromWorkflowPath("src/probe.ts")).toBeUndefined();
});
