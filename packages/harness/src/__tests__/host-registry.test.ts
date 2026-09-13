import { afterEach, describe, expect, it } from "bun:test";

import { createAdapter } from "../adapters/index.js";
import { missingClassifierAuth } from "../classifier.js";
import {
	clearRegisteredHostAdapters,
	isKnownAgentHost,
	knownAgentHosts,
	registerHostAdapter,
} from "../host-registry.js";
import { runAgent } from "../index.js";
import type { HostAdapter } from "../types.js";

function stubAdapter(host: string): HostAdapter {
	return {
		host,
		async run(options) {
			return {
				host,
				status: "completed",
				durationMs: 1,
				trace: {
					messages: [{ role: "assistant", content: options.prompt }],
					toolCalls: [],
					shellCommands: [],
					artifacts: {},
				},
			};
		},
		missingAuth() {
			return undefined;
		},
	};
}

describe("registerHostAdapter", () => {
	afterEach(() => {
		clearRegisteredHostAdapters();
	});

	it("runs a consumer adapter through runAgent", async () => {
		registerHostAdapter(stubAdapter("stub"));
		expect(isKnownAgentHost("stub")).toBe(true);
		expect(knownAgentHosts()).toContain("stub");
		expect(createAdapter("stub").host).toBe("stub");

		const session = await runAgent({
			host: "stub",
			cwd: process.cwd(),
			prompt: "hello from stub",
			context: {
				profile: "shared",
				cwd: process.cwd(),
				sources: [],
				preamble: "",
			},
		});
		expect(session.host).toBe("stub");
		expect(session.status).toBe("completed");
		expect(session.trace.messages[0]?.content).toBe("hello from stub");
	});

	it("rejects reserved and duplicate ids", () => {
		expect(() => registerHostAdapter(stubAdapter("cursor"))).toThrow(/reserved/);
		expect(() => registerHostAdapter(stubAdapter("ALL"))).toThrow(/lowercase slug/);
		registerHostAdapter(stubAdapter("stub"));
		expect(() => registerHostAdapter(stubAdapter("stub"))).toThrow(/already registered/);
	});

	it("names a missing classifier on a custom host", () => {
		registerHostAdapter(stubAdapter("stub"));
		expect(missingClassifierAuth("stub")).toMatch(/no classifier/);
	});
});
