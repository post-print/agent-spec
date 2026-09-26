#!/usr/bin/env node

process.stdout.write(
	`${JSON.stringify({
		type: "item.completed",
		item: { type: "agent_message", text: "Progress before the stall." },
	})}\n`,
);

setInterval(() => undefined, 1_000);
