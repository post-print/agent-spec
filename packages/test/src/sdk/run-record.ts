import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import type {
	AgentDefinition,
	AgentTrace,
	Confinement,
	HostConditions,
	McpCatalogEntry,
	NetworkState,
} from "@post-print/agent-harness";
import type { StartingContext, WorkspaceSnapshot } from "./workspace.js";

const run = promisify(execFile);

/** The test asked about something this run cannot show, so it has no verdict either way. */
export class ConditionsUnknownError extends Error {
	readonly kind = "conditions-unknown" as const;
	constructor(message: string) {
		super(message);
		this.name = "ConditionsUnknownError";
	}
}

export interface OfferedTool {
	name: string;
	server?: string;
	description?: string;
}
/**
 * `host`: the host listed every tool it offered. `mcp-query`: the harness asked the MCP servers,
 * so MCP tools are known and built-in tools are not. `unknown`: nothing could be established.
 */
export interface RunExposure {
	source: "host" | "mcp-query" | "unknown";
	tools: OfferedTool[];
	mcpServers: { name: string; status: string; error?: string }[];
}

function catalogTools(catalog: McpCatalogEntry[]): OfferedTool[] {
	return catalog.flatMap((entry) =>
		entry.status === "listed"
			? entry.tools.map(({ name, description }) => ({ name, server: entry.server, description }))
			: [],
	);
}
function hostToolDetail(name: string, catalog: OfferedTool[]): OfferedTool {
	const known = catalog.find((tool) => name === `mcp__${tool.server}__${tool.name}`);
	return known ? { ...known, name } : { name };
}
function reportedServers(report: AgentTrace["hostReport"], catalog: McpCatalogEntry[]) {
	const failures = new Map(
		catalog.flatMap((entry) => (entry.status === "failed" ? [[entry.server, entry.error]] : [])),
	);
	if (report?.mcpServers)
		return report.mcpServers.map(({ name, status }) => ({ name, status: status ?? "unknown" }));
	return catalog.map(({ server, status }) => ({
		name: server,
		status,
		...(failures.has(server) ? { error: failures.get(server) } : {}),
	}));
}
export function runExposure(
	report: AgentTrace["hostReport"],
	catalog: McpCatalogEntry[],
): RunExposure {
	const fromServers = catalogTools(catalog);
	const mcpServers = reportedServers(report, catalog);
	if (report?.tools)
		return {
			source: "host",
			tools: report.tools.map((name) => hostToolDetail(name, fromServers)),
			mcpServers,
		};
	const everyServerListed = catalog.length > 0 && catalog.every((e) => e.status === "listed");
	return {
		source: everyServerListed ? "mcp-query" : "unknown",
		tools: fromServers,
		mcpServers,
	};
}
function namesTool(tool: OfferedTool, requested: string): boolean {
	return (
		tool.name === requested ||
		(tool.server !== undefined && `mcp__${tool.server}__${tool.name}` === requested) ||
		tool.name.endsWith(`__${requested}`)
	);
}
export function listedTool(exposure: RunExposure, requested: string): boolean {
	return exposure.tools.some((tool) => namesTool(tool, requested));
}
/** Whether the agent was offered a tool. An unknown catalog answers neither yes nor no. */
export function offeredTool(exposure: RunExposure, requested: string): boolean {
	if (listedTool(exposure, requested)) return true;
	if (exposure.source === "unknown")
		throw new ConditionsUnknownError(
			`Cannot tell whether the agent was offered ${requested}: this run recorded no tool catalog.`,
		);
	return false;
}

export interface RunRecord {
	host: string;
	binary?: string;
	binaryVersion?: string;
	authMode?: string;
	confinement: Confinement;
	network: NetworkState;
	settingSources?: string[];
	overridingEnv: string[];
	requestedModel?: string;
	observedModel?: string;
	/** False when no definition names a model, so the host or environment chose it. */
	modelPinned: boolean;
	/** Conditions the suite declared it accepts going without, with its reason. */
	accepted?: { conditions: readonly string[]; reason: string };
	/** True when this host version has a passing host probe on record. */
	calibrated: boolean;
	/** Every escape vector the host is said to enforce held in a battery run from the last week. */
	confinementProven: boolean;
	packageVersion?: string;
	git?: { sha: string; dirty: boolean };
	hashes: {
		suite?: string;
		prompt: string;
		skills: string;
		tools: string;
		settings: string;
		initialSnapshot: string;
	};
}
export interface RunRecordBase {
	baseDir: string;
	packageVersion?: string;
	git?: { sha: string; dirty: boolean };
	suiteHash?: string;
}

function sha256(value: string | Buffer): string {
	return createHash("sha256").update(value).digest("hex");
}
async function gitState(baseDir: string): Promise<RunRecordBase["git"]> {
	try {
		const options = { cwd: baseDir };
		const { stdout: sha } = await run("git", ["rev-parse", "HEAD"], options);
		const { stdout: status } = await run("git", ["status", "--porcelain"], options);
		return { sha: sha.trim(), dirty: status.trim().length > 0 };
	} catch {
		return undefined;
	}
}
async function packageVersion(): Promise<string | undefined> {
	try {
		const url = new URL("../../package.json", import.meta.url);
		return (JSON.parse(await readFile(url, "utf8")) as { version?: string }).version;
	} catch {
		return undefined;
	}
}
export async function runRecordBase(baseDir: string, testFile?: string): Promise<RunRecordBase> {
	return {
		baseDir,
		packageVersion: await packageVersion(),
		git: await gitState(baseDir),
		suiteHash: testFile ? sha256(await readFile(testFile).catch(() => "")) : undefined,
	};
}
async function directoryDigest(path: string): Promise<string> {
	const hash = createHash("sha256");
	const items = await readdir(path, { withFileTypes: true, recursive: true });
	const files = items
		.filter((item) => item.isFile())
		.map((item) => join(item.parentPath, item.name))
		.sort();
	for (const file of files) hash.update(file.slice(path.length)).update(await readFile(file));
	return hash.digest("hex");
}
async function skillsDigest(context: StartingContext): Promise<string> {
	const digests = await Promise.all(
		context.skills.map(({ source }) => directoryDigest(source).catch(() => "unreadable")),
	);
	return sha256(digests.join("\n"));
}
function snapshotDigest(snapshot: WorkspaceSnapshot): string {
	const entries = Object.entries(snapshot.files)
		.map(([path, { sha256: digest }]) => `${path}:${digest}`)
		.sort();
	return sha256(entries.join("\n"));
}
/** Keys in a fixed order, so the same configuration always hashes the same. */
function stableJson(value: unknown): string {
	return JSON.stringify(value, (_key, item: unknown) =>
		item && typeof item === "object" && !Array.isArray(item)
			? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)))
			: item,
	);
}
/**
 * What a definition gives its agent besides what the record names on its own. A deadline is left
 * out: it is cut to the time left in each test, and it does not change what the agent can do.
 */
function definitionDigests({ options }: AgentDefinition) {
	const { model, skills, auth, timeoutMs, tools, mcpServers, ...settings } = options;
	return {
		tools: sha256(stableJson({ tools, mcpServers })),
		settings: sha256(stableJson(settings)),
	};
}
/** A calibration speaks for one host version under one auth mode, and only for a week. */
const CALIBRATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
type CalibrationKey = Pick<RunRecord, "host" | "binaryVersion" | "authMode">;
function calibrationPath(baseDir: string, { host, binaryVersion, authMode }: CalibrationKey) {
	const safe = (value: string) => value.replace(/[^\w.-]+/g, "_");
	const name = `${host}-${safe(binaryVersion ?? "")}-${safe(authMode ?? "none")}.json`;
	return join(baseDir, ".agent-test", "calibration", name);
}
/** Calibrated only by a probe of this exact host, version and auth mode, in the last week. */
async function hostCalibrated(baseDir: string, key: CalibrationKey, now = Date.now()) {
	if (!key.binaryVersion) return false;
	const stored = await readFile(calibrationPath(baseDir, key), "utf8").catch(() => undefined);
	if (!stored) return false;
	try {
		const at = Date.parse((JSON.parse(stored) as { at?: string }).at ?? "");
		return Number.isFinite(at) && now - at <= CALIBRATION_TTL_MS;
	} catch {
		return false;
	}
}
/**
 * Ways out of a sealed workspace the escape battery tries. The first six are what the harness says
 * a host enforces, so a pass needs each one held. The rest are recorded findings: the real home and
 * global git config are sealed only under `--verdict-grade`, and nothing yet contains the parent's
 * environment or a process the agent leaves running.
 */
export const ENFORCED_VECTORS = [
	"caller-checkout",
	"sealed-manifest",
	"temp-folder",
	"symlink-out",
	"write-outside",
	"network-off",
] as const;
export const SEALED_HOME_VECTORS = ["real-home", "global-git-config"] as const;
export const FINDING_VECTORS = ["parent-env", "outlives-run"] as const;
export type EscapeVector =
	| (typeof ENFORCED_VECTORS)[number]
	| (typeof SEALED_HOME_VECTORS)[number]
	| (typeof FINDING_VECTORS)[number];
const JSON_SUFFIX = /\.json$/;
type VectorOutcomes = Record<string, { outcome: "held" | "breached"; at: string }>;
function vectorsPath(baseDir: string, key: CalibrationKey): string {
	return calibrationPath(baseDir, key).replace(JSON_SUFFIX, ".vectors.json");
}
async function storedVectors(baseDir: string, key: CalibrationKey): Promise<VectorOutcomes> {
	const stored = await readFile(vectorsPath(baseDir, key), "utf8").catch(() => "{}");
	try {
		return JSON.parse(stored) as VectorOutcomes;
	} catch {
		return {};
	}
}
/** Called by the escape battery for each vector it tried, held or not. */
export async function recordEscapeVector(
	configDir: string,
	key: CalibrationKey,
	result: { vector: EscapeVector; held: boolean },
): Promise<void> {
	if (!key.binaryVersion) throw new Error("Cannot record a vector for a host of unknown version");
	const vectors = await storedVectors(configDir, key);
	const outcome = result.held ? "held" : "breached";
	vectors[result.vector] = { outcome, at: new Date().toISOString() };
	await mkdir(dirname(vectorsPath(configDir, key)), { recursive: true });
	await writeFile(vectorsPath(configDir, key), JSON.stringify(vectors, null, 2));
}
/** Every vector the host is said to enforce held in the last week, for this host, version and auth. */
async function confinementProven(baseDir: string, key: CalibrationKey, now = Date.now()) {
	if (!key.binaryVersion) return false;
	const vectors = await storedVectors(baseDir, key);
	return ENFORCED_VECTORS.every((vector) => {
		const entry = vectors[vector];
		const at = Date.parse(entry?.at ?? "");
		return entry?.outcome === "held" && Number.isFinite(at) && now - at <= CALIBRATION_TTL_MS;
	});
}
/** One judge: the same prompt and schema on the same host and model. */
export function judgeKey(input: {
	prompt: string;
	schema: unknown;
	host?: string;
	model?: string;
}) {
	return sha256(
		stableJson([input.prompt, input.schema, input.host ?? "custom", input.model ?? ""]),
	);
}
function judgePath(baseDir: string, key: string): string {
	return join(baseDir, ".agent-test", "calibration", `judge-${key.slice(0, 32)}.json`);
}
/** Whether labelled fixtures agreed with this judge in the last week. */
export async function judgeCalibrated(baseDir: string, key: string, now = Date.now()) {
	const stored = await readFile(judgePath(baseDir, key), "utf8").catch(() => undefined);
	if (!stored) return false;
	try {
		const at = Date.parse((JSON.parse(stored) as { at?: string }).at ?? "");
		return Number.isFinite(at) && now - at <= CALIBRATION_TTL_MS;
	} catch {
		return false;
	}
}
/** Called by the judge calibration suite once every labelled fixture agreed with the judge. */
export async function recordJudgeCalibration(
	configDir: string,
	evaluation: { name: string; judge: { key: string } },
	agreed: { fixtures: number },
): Promise<void> {
	const path = judgePath(configDir, evaluation.judge.key);
	await mkdir(dirname(path), { recursive: true });
	const at = new Date().toISOString();
	await writeFile(path, JSON.stringify({ name: evaluation.name, ...agreed, at }, null, 2));
}
/** Called by the host probe after every check passed. Other runs read it to label themselves. */
export async function recordHostCalibration(
	configDir: string,
	record: CalibrationKey,
): Promise<void> {
	if (!record.binaryVersion) throw new Error("Cannot calibrate a host with an unknown version");
	const path = calibrationPath(configDir, record);
	await mkdir(dirname(path), { recursive: true });
	const { host, binaryVersion, authMode } = record;
	const at = new Date().toISOString();
	await writeFile(path, JSON.stringify({ host, binaryVersion, authMode, at }, null, 2));
}
export async function buildRunRecord(
	base: RunRecordBase,
	input: {
		conditions: HostConditions;
		definition: AgentDefinition;
		hostReport: AgentTrace["hostReport"];
		prompt: string;
		context: StartingContext;
		initial: WorkspaceSnapshot;
	},
): Promise<RunRecord> {
	const { conditions, definition, hostReport, prompt, context, initial } = input;
	const binaryVersion = hostReport?.version ?? conditions.binaryVersion;
	return {
		...conditions,
		binaryVersion,
		requestedModel: definition.options.model,
		observedModel: hostReport?.model,
		modelPinned: Boolean(definition.options.model),
		calibrated: await hostCalibrated(base.baseDir, { ...conditions, binaryVersion }),
		confinementProven: await confinementProven(base.baseDir, { ...conditions, binaryVersion }),
		packageVersion: base.packageVersion,
		git: base.git,
		hashes: {
			suite: base.suiteHash,
			prompt: sha256(prompt),
			skills: await skillsDigest(context),
			...definitionDigests(definition),
			initialSnapshot: snapshotDigest(initial),
		},
	};
}
