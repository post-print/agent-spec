import { enrichTrace, mergeAgentUsage } from "./capture.js";
import { formatTraceForJudge } from "./judge.js";
import { isUserInputTool } from "./run-guards.js";
import type { AgentSession, AgentTrace, AgentUsage } from "./types.js";

export interface UserQuestion {
	toolName: string;
	prompt: string;
	options?: string[];
}

export interface UserSimulator {
	reply(input: { questions: UserQuestion[]; trace: AgentTrace; turn: number }): Promise<string>;
}

export interface RunConversationOptions {
	initialPrompt: string;
	runTurn: (prompt: string, turn: number) => Promise<AgentSession>;
	userSimulator: UserSimulator;
	maxTurns?: number;
}

const DEFAULT_MAX_TURNS = 6;

function questionText(value: unknown): string | undefined {
	if (typeof value === "string" && value.trim()) {
		return value.trim();
	}
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		return undefined;
	}
	const record = value as Record<string, unknown>;
	for (const key of ["prompt", "question", "text", "message", "title"]) {
		const text = questionText(record[key]);
		if (text) {
			return text;
		}
	}
	return undefined;
}

function optionLabels(value: unknown): string[] | undefined {
	if (!Array.isArray(value)) {
		return undefined;
	}
	const labels = value
		.map((item) => {
			if (typeof item === "string") {
				return item;
			}
			if (item && typeof item === "object" && "label" in item) {
				const label = (item as { label?: unknown }).label;
				return typeof label === "string" ? label : undefined;
			}
			return undefined;
		})
		.filter((item): item is string => Boolean(item));
	return labels.length > 0 ? labels : undefined;
}

function questionsFromArgs(
	toolName: string,
	args: Record<string, unknown> | undefined,
): UserQuestion[] {
	if (!args) {
		return [{ toolName, prompt: "(agent asked a question with empty args)" }];
	}
	const nested = args.questions;
	if (Array.isArray(nested) && nested.length > 0) {
		return nested.map((item) => ({
			toolName,
			prompt: questionText(item) ?? "(untitled question)",
			options: optionLabels(
				item && typeof item === "object" ? (item as { options?: unknown }).options : undefined,
			),
		}));
	}
	return [
		{
			toolName,
			prompt: questionText(args) ?? JSON.stringify(args),
			options: optionLabels(args.options),
		},
	];
}

/** Pull AskQuestion-style prompts from a live trace. */
export function extractUserQuestions(trace: AgentTrace): UserQuestion[] {
	const questions: UserQuestion[] = [];
	for (const call of trace.toolCalls) {
		if (!isUserInputTool(call.name)) {
			continue;
		}
		questions.push(...questionsFromArgs(call.name, call.args));
	}
	return questions;
}

function nextSeq(trace: AgentTrace): number {
	const messageSeq = trace.messages.map((m) => m.seq ?? 0);
	const toolSeq = trace.toolCalls.map((call) => call.seq ?? 0);
	return Math.max(0, ...messageSeq, ...toolSeq) + 1;
}

/** Append a user reply and the next agent turn onto the conversation trace. */
export function mergeConversationTraces(
	prior: AgentTrace,
	userReply: string,
	next: AgentTrace,
): AgentTrace {
	const seq = nextSeq(prior);
	const userMessage = { role: "user" as const, content: userReply, seq };
	const offset = seq + 1;
	const shiftedMessages = next.messages.map((message) => ({
		...message,
		seq: (message.seq ?? 0) + offset,
	}));
	const shiftedTools = next.toolCalls.map((call) => ({
		...call,
		seq: (call.seq ?? 0) + offset,
	}));
	return enrichTrace({
		messages: [...prior.messages, userMessage, ...shiftedMessages],
		toolCalls: [...prior.toolCalls, ...shiftedTools],
		shellCommands: [...new Set([...prior.shellCommands, ...next.shellCommands])],
		skillsInvoked: [...new Set([...(prior.skillsInvoked ?? []), ...(next.skillsInvoked ?? [])])],
		gitDiff: next.gitDiff ?? prior.gitDiff,
		prBody: next.prBody ?? prior.prBody,
		artifacts: { ...prior.artifacts, ...next.artifacts },
		routing: next.routing ?? prior.routing,
		assistantTextBeforeTools: prior.assistantTextBeforeTools,
		usage: mergeAgentUsage(prior.usage, next.usage),
	});
}

function withConversationMeta(trace: AgentTrace, turns: number): AgentTrace {
	return {
		...trace,
		artifacts: {
			...trace.artifacts,
			conversationTurns: String(turns),
		},
	};
}

/** Rebuild a follow-up turn so a new host process still sees the conversation. */
export function composeFollowUpPrompt(
	initialPrompt: string,
	prior: AgentTrace,
	userReply: string,
): string {
	return [
		`Original task:\n${initialPrompt}`,
		"",
		"Conversation so far:",
		formatTraceForJudge(prior),
		"",
		`User reply to your question:\n${userReply}`,
		"",
		"Continue the task. Do not repeat finished work.",
	].join("\n");
}

/** Drive a test agent and a user simulator until the agent finishes or hits maxTurns. */
export async function runConversation(options: RunConversationOptions): Promise<AgentSession> {
	const maxTurns = options.maxTurns ?? DEFAULT_MAX_TURNS;
	let turnPrompt = options.initialPrompt;
	let lastReply: string | undefined;
	let merged: AgentTrace | undefined;
	let lastSession: AgentSession | undefined;
	let usage: AgentUsage | undefined;
	const started = performance.now();

	for (let turn = 1; turn <= maxTurns; turn++) {
		const session = await options.runTurn(turnPrompt, turn);
		lastSession = session;
		usage = mergeAgentUsage(usage, session.usage);
		merged =
			lastReply === undefined
				? enrichTrace(session.trace)
				: mergeConversationTraces(merged ?? session.trace, lastReply, session.trace);

		if (session.status !== "completed" && !extractUserQuestions(session.trace).length) {
			return {
				...session,
				trace: withConversationMeta(merged, turn),
				usage,
				durationMs: Math.round(performance.now() - started),
			};
		}

		const askedThisTurn = extractUserQuestions(session.trace);
		if (askedThisTurn.length === 0) {
			return {
				...session,
				status: "completed",
				trace: withConversationMeta(merged, turn),
				usage,
				durationMs: Math.round(performance.now() - started),
				error: undefined,
			};
		}

		if (turn === maxTurns) {
			return {
				host: session.host,
				status: "failed",
				trace: withConversationMeta(merged, turn),
				usage,
				durationMs: Math.round(performance.now() - started),
				error: `agent kept asking questions after maxTurns=${maxTurns}`,
			};
		}

		lastReply = (
			await options.userSimulator.reply({ questions: askedThisTurn, trace: merged, turn })
		).trim();
		if (!lastReply) {
			return {
				host: session.host,
				status: "failed",
				trace: withConversationMeta(merged, turn),
				usage,
				durationMs: Math.round(performance.now() - started),
				error: "user simulator returned an empty reply",
			};
		}
		turnPrompt = composeFollowUpPrompt(options.initialPrompt, merged, lastReply);
	}

	return {
		host: lastSession?.host ?? "cursor",
		status: "failed",
		trace: withConversationMeta(
			merged ?? { messages: [], toolCalls: [], shellCommands: [], artifacts: {} },
			maxTurns,
		),
		usage,
		durationMs: Math.round(performance.now() - started),
		error: `agent kept asking questions after maxTurns=${maxTurns}`,
	};
}
