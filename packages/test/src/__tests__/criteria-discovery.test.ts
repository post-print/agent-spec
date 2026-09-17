import { expect, it } from "bun:test";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { playwrightCli } from "../sdk/playwright-cli.js";

const exec = promisify(execFile);

it("public SDK discovery derives expect criteria and preserves explicit criteria", async () => {
	const config = fileURLToPath(
		new URL("../../fixtures/criteria/agent-test.config.ts", import.meta.url),
	);
	const reporter = fileURLToPath(new URL("../sdk/reporter.ts", import.meta.url));
	const { stdout } = await exec(process.execPath, [
		playwrightCli(),
		"test",
		"--config",
		config,
		"--list",
		"--reporter",
		reporter,
	]);
	const catalog = stdout
		.split("\n")
		.map(parseJson)
		.find((message) => message?.type === "catalog");
	expect(catalog?.tests?.map((test) => test.criteria)).toEqual([
		["The response contains READY.", "The agent does not access secret.txt."],
		["The declared criterion wins."],
	]);
});

type CatalogMessage = { type?: string; tests?: Array<{ criteria?: string[] }> };
function parseJson(line: string): CatalogMessage | undefined {
	try {
		return JSON.parse(line) as CatalogMessage;
	} catch {
		return undefined;
	}
}
