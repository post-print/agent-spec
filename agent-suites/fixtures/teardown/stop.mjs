import { writeFileSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";

writeFileSync("dev.stop", "stop\n");
await sleep(300);
console.log("Stopped.");
