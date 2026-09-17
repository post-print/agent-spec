import { customAgent } from "../../../harness/dist/index.js";
import { defineConfig } from "../../dist/index.js";

const fake = customAgent({
	adapter: new URL("./fake-agent.mjs", import.meta.url).href,
	options: {},
});
export default defineConfig({
	testDir: ".",
	outputDir: "./test-results/contracts",
	testMatch: "contract.spec.ts",
	agent: fake,
	judge: fake,
	workspace: "./project",
});
