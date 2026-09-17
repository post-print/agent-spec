import { resolve } from "node:path";
import { createStylexBunPlugin } from "@stylexjs/unplugin/bun";

const output = resolve("dist/viewer");
const result = await Bun.build({
	entrypoints: ["./src/viewer/client-entry.tsx"],
	outdir: output,
	target: "browser",
	minify: true,
	define: { "process.env.NODE_ENV": '"production"' },
	plugins: [createStylexBunPlugin({ dev: false, bunDevCssOutput: resolve(output, "stylex.css") })],
});

if (!result.success) {
	for (const log of result.logs) console.error(log);
	process.exitCode = 1;
}
