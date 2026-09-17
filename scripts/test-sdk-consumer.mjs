#!/usr/bin/env node

import { execFile } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { promisify } from "node:util";

const exec = promisify(execFile);
const root = resolve(import.meta.dirname, "..");
const trackedManifests = [
	join(root, "packages/harness/package.json"),
	join(root, "packages/test/package.json"),
];
const before = await Promise.all(trackedManifests.map((path) => readFile(path, "utf8")));
const temp = await mkdtemp(join(tmpdir(), "agent-test-consumer-"));
const stage = join(temp, "stage");
const tarballs = join(temp, "tarballs");
const consumer = join(temp, "consumer");
const npmEnv = { ...process.env, npm_config_cache: join(temp, "npm-cache") };
await mkdir(tarballs, { recursive: true });
await mkdir(consumer, { recursive: true });

await cp(join(root, "packages/harness"), join(stage, "harness"), { recursive: true });
await cp(join(root, "packages/test"), join(stage, "test"), { recursive: true });
const testPackagePath = join(stage, "test/package.json");
const testPackage = JSON.parse(await readFile(testPackagePath, "utf8"));
testPackage.dependencies["@post-print/agent-harness"] = testPackage.version;
await writeFile(testPackagePath, `${JSON.stringify(testPackage, null, 2)}\n`);

async function pack(path) {
	const { stdout } = await exec("npm", ["pack", path, "--pack-destination", tarballs, "--json"], {
		cwd: root,
		env: npmEnv,
	});
	const rows = JSON.parse(stdout);
	return join(tarballs, rows[0].filename);
}

const harnessTarball = await pack(join(stage, "harness"));
const testTarball = await pack(join(stage, "test"));
const dependencyTarballs = [];
for (const name of [
	"zod",
	"react",
	"react-dom",
	"scheduler",
	"playwright",
	"playwright-core",
	"@playwright/test",
	"@types/node",
	"undici-types",
]) {
	dependencyTarballs.push(await pack(join(root, "node_modules", name)));
}
await writeFile(
	join(consumer, "package.json"),
	JSON.stringify({ name: "agent-test-consumer", private: true, type: "module" }),
);
await exec(
	"npm",
	[
		"install",
		"--offline",
		"--omit=optional",
		"--ignore-scripts",
		"--no-audit",
		"--no-fund",
		...dependencyTarballs,
		harnessTarball,
		testTarball,
	],
	{ cwd: consumer, env: npmEnv },
);
await writeFile(
	join(consumer, "tsconfig.json"),
	`${JSON.stringify({ compilerOptions: { strict: true, target: "ES2022", module: "NodeNext", moduleResolution: "NodeNext", outDir: "dist", skipLibCheck: false, types: ["node"] }, include: ["src.ts"] }, null, 2)}\n`,
);
await cp(
	join(root, "packages/test/fixtures/sdk-v2/fake-agent.mjs"),
	join(consumer, "fake-agent.mjs"),
);
await mkdir(join(consumer, "project"));
await writeFile(join(consumer, "project/PROJECT.md"), "The owner is Mina.");
await writeFile(
	join(consumer, "src.ts"),
	`
import { describe, expect, z, type Run } from "@post-print/agent-test";
import { customAgent } from "@post-print/agent-harness";
const fake = customAgent({adapter: new URL("../fake-agent.mjs", import.meta.url).href, options: {}});
const test = describe("installed resources", ({agent, judge}) => ({
 coder: agent({agent: fake, workspace: "./project"}),
 accuracy: judge({agent: fake, prompt: "Check", schema: z.object({correct: z.boolean()})}),
}));
test("installed SDK", async ({coder, accuracy}) => {
 const run: Run = await coder.run({prompt: "Who owns the project?"});
 expect(run.output).toContain("Mina");
 expect(run).toHaveReadPath("PROJECT.md");
 const evaluation = await accuracy.run({input: {answer: run.output}});
 const typed: boolean = evaluation.output.correct;
 // @ts-expect-error The schema must not collapse to any.
 const invalid: string = evaluation.output.correct;
 expect(typed).toBe(true);
});
`,
);
await exec(
	process.execPath,
	[join(root, "node_modules/typescript/bin/tsc"), "--project", "tsconfig.json"],
	{ cwd: consumer },
);
await writeFile(
	join(consumer, "agent-test.config.ts"),
	`
import {defineConfig} from "@post-print/agent-test";
export default defineConfig({testDir: "./dist", testMatch: "src.js"});
`,
);
const { stdout } = await exec(
	process.execPath,
	[join(consumer, "node_modules/@post-print/agent-test/dist/cli.js"), "test"],
	{ cwd: consumer },
);
console.log(stdout);
const after = await Promise.all(trackedManifests.map((path) => readFile(path, "utf8")));
if (before.some((value, index) => value !== after[index]))
	throw new Error("Consumer check changed a tracked manifest");
console.log(`Installed SDK, declarations, judge, and CLI: OK (${basename(testTarball)})`);
