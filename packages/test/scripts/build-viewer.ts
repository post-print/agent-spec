import { mkdir, writeFile } from "node:fs/promises";
import { extname, resolve } from "node:path";
import { unpluginFactory } from "@stylexjs/unplugin";
import type { BunPlugin, Loader } from "bun";

/**
 * StyleX's own Bun adapter rewrites the stylesheet on every module load without awaiting
 * earlier writes, so a stale partial write can land last and drop rules. Transform modules
 * here and write the collected stylesheet once, after the bundle finishes.
 */
type StylexTransformer = {
	buildStart?: () => Promise<void> | void;
	buildEnd?: () => Promise<void> | void;
	transform?: (code: string, id: string) => Promise<{ code?: string } | null | undefined>;
	__stylexCollectCss?: () => string;
};

const LOADERS: Record<string, Loader> = {
	".js": "js",
	".mjs": "js",
	".cjs": "js",
	".jsx": "jsx",
	".ts": "ts",
	".mts": "ts",
	".cts": "ts",
	".tsx": "tsx",
};

const SCRIPT_MODULE = /\.[cm]?[jt]sx?$/;
const output = resolve("dist/viewer");
const stylex = unpluginFactory(
	{ dev: false, runtimeInjection: false, useCSSLayers: true },
	{ framework: "bun" },
) as unknown as StylexTransformer;

const stylexTransform: BunPlugin = {
	name: "stylex-transform",
	setup(build) {
		build.onLoad({ filter: SCRIPT_MODULE }, async (args) => {
			const code = await Bun.file(args.path).text();
			const result = await stylex.transform?.(code, args.path);
			return { contents: result?.code ?? code, loader: LOADERS[extname(args.path)] ?? "js" };
		});
	},
};

await stylex.buildStart?.();
const result = await Bun.build({
	entrypoints: ["./src/viewer/client-entry.tsx"],
	outdir: output,
	target: "browser",
	minify: true,
	define: { "process.env.NODE_ENV": '"production"' },
	plugins: [stylexTransform],
});
await stylex.buildEnd?.();

if (result.success) {
	await mkdir(output, { recursive: true });
	const css = stylex.__stylexCollectCss?.() ?? "";
	await writeFile(
		resolve(output, "stylex.css"),
		`:root { --stylex-injection: 0; }\n${css}`,
		"utf8",
	);
} else {
	for (const log of result.logs) console.error(log);
	process.exitCode = 1;
}
