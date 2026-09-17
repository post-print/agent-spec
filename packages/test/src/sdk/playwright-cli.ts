import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

export function playwrightCli(): string {
	return require.resolve("@playwright/test/cli");
}
