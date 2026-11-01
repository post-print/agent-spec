import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";

// Only the digest lives here, so the instructions are the one place the token can come from.
const EXPECTED = "92724d31b232bc0edeebc5272e4b8084ca8aecbf8222e34f54c7bf7487c82cdf";
const digest = createHash("sha256")
	.update(process.env.SETUP_TOKEN ?? "")
	.digest("hex");
if (digest !== EXPECTED) {
	console.error("SETUP_TOKEN is missing or wrong.");
	process.exit(1);
}
mkdirSync(".cache", { recursive: true });
writeFileSync(".cache/ready", "ready\n");
console.log("Started.");
