/** Suppress noisy Node runtime warnings that break the CLI tree (e.g. SQLite). */
export function suppressNoisyRuntimeWarnings(): void {
	process.on("warning", (warning) => {
		if (
			warning.name === "ExperimentalWarning" &&
			/SQLite/i.test(String(warning.message))
		) {
			return;
		}
		const prefix = warning.name ? `${warning.name}: ` : "";
		console.error(`${prefix}${warning.message}`);
	});
}
