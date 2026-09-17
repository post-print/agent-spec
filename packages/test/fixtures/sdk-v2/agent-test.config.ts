import { defineConfig } from "../../dist/index.js";
export default defineConfig({
	testDir: ".",
	testMatch: "contract.spec.ts",
	use: { workspace: "./project" },
});
