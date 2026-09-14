#!/usr/bin/env node

import { execFile } from "node:child_process";
import { cp, mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { promisify } from "node:util";

const exec = promisify(execFile);
const root = resolve(import.meta.dirname, "..");
const trackedManifests = [join(root, "packages/harness/package.json"), join(root, "packages/test/package.json")];
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
	const { stdout } = await exec("npm", ["pack", path, "--pack-destination", tarballs, "--json"], { cwd: root, env: npmEnv });
	const rows = JSON.parse(stdout);
	return join(tarballs, rows[0].filename);
}

const harnessTarball = await pack(join(stage, "harness"));
const testTarball = await pack(join(stage, "test"));
const chalkTarball = await pack(join(root, "node_modules/chalk"));
const nodeTypesTarball = await pack(join(root, "node_modules/@types/node"));
const undiciTypesTarball = await pack(join(root, "node_modules/undici-types"));
await writeFile(
	join(consumer, "package.json"),
	`${JSON.stringify({ name: "agent-test-consumer", private: true, type: "module" }, null, 2)}\n`,
);
await exec("npm", ["install", "--offline", "--omit=optional", "--ignore-scripts", "--no-audit", "--no-fund", chalkTarball, nodeTypesTarball, undiciTypesTarball, harnessTarball, testTarball], {
	cwd: consumer,
	env: npmEnv,
});
await writeFile(
	join(consumer, "tsconfig.json"),
	`${JSON.stringify({ compilerOptions: { strict: true, target: "ES2022", module: "NodeNext", moduleResolution: "NodeNext", outDir: "dist", skipLibCheck: false, types: ["node"] }, include: ["src.ts"] }, null, 2)}\n`,
);
await writeFile(
	join(consumer, "src.ts"),
	`import { registerHostAdapter, runAgentTest, type CompareArmResult, type HostAdapter, type ScenarioResult } from "@post-print/agent-test";

const adapter: HostAdapter = {
  host: "fixture",
  async run(options) {
    const short = options.prompt.includes("short");
    return {
      host: "fixture",
      status: "completed",
      durationMs: short ? 1 : 2,
      trace: {
        messages: [{ role: "assistant", content: "SDK_OK" }],
        toolCalls: short ? [] : [{ name: "Read", args: { path: "PROJECT.md" } }],
        shellCommands: [],
        artifacts: {},
        usage: { totalTokens: short ? 10 : 20 }
      }
    };
  }
};

registerHostAdapter(adapter);
const result: ScenarioResult = await runAgentTest({
  cwd: process.cwd(),
  host: "fixture",
  judge: false,
  worktree: false,
  scenario: {
    name: "installed package",
    prompt: "Return SDK_OK.",
    rubric: { must: ["SDK_OK"] },
    compare: {
      a: { description: "Uses one read." },
      b: { description: "Uses fewer tokens.", prompt: "Return SDK_OK in a short answer." },
      gates: [
        { metric: "outcome", arm: "a", operator: "equal", value: "pass" },
        { metric: "tokens", winner: "b", loser: "a" }
      ]
    }
  }
});
const arms: CompareArmResult[] = result.compare?.arms ?? [];
if (!result.passed || arms.length !== 2 || result.compare?.gateResults?.some((gate) => !gate.passed)) {
  throw new Error("The installed package contract did not pass.");
}
console.log("Installed declarations and direct API: OK");
`,
);
await exec(process.execPath, [join(root, "node_modules/typescript/bin/tsc"), "--project", "tsconfig.json"], {
	cwd: consumer,
});
await exec(process.execPath, [join(consumer, "dist/src.js")], { cwd: consumer, env: { ...process.env, AGENT_TEST_ALLOW_IN_PLACE: "1" } });

const suites = join(consumer, "suites/basic");
await mkdir(suites, { recursive: true });
await writeFile(
	join(suites, "scenarios.json"),
	`${JSON.stringify({ name: "basic", defaults: { host: "cursor", skills: "none" }, scenarios: [{ name: "exact text", prompt: "Reply with OK.", rubric: { must: ["OK"] } }] }, null, 2)}\n`,
);
await exec(process.execPath, [join(consumer, "node_modules/@post-print/agent-test/dist/cli.js"), "--check", "--suites-dir", "suites"], { cwd: consumer });

const after = await Promise.all(trackedManifests.map((path) => readFile(path, "utf8")));
if (before.some((value, index) => value !== after[index])) {
	throw new Error("The package test changed a tracked package manifest.");
}
console.log(`Installed CLI: OK (${basename(testTarball)})`);
