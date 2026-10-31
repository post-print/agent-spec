import { existsSync, writeFileSync } from "node:fs";

// It stops when asked through a file, because a sandbox can forbid signals between commands.
writeFileSync("dev.started", "started\n");
setInterval(() => {
	if (existsSync("dev.stop")) process.exit(0);
}, 50);
