import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";

spawn(process.execPath, ["dev.mjs"], { detached: true, stdio: "ignore" }).unref();
while (!existsSync("dev.started")) await sleep(50);
console.log("Started.");
