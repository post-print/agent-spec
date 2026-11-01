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
/** Whether the agent was offered a tool. An unknown catalog answers neither yes nor no. */
export function offeredTool(exposure: RunExposure, requested: string): boolean {
	if (exposure.tools.some((tool) => namesTool(tool, requested))) return true;
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
	/** True when this host version has a passing host probe on record. */
	calibrated: boolean;
	packageVersion?: string;
	git?: { sha: string; dirty: boolean };
	hashes: { suite?: string; prompt: string; skills: string; initialSnapshot: string };
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
function calibrationPath(baseDir: string, host: string, version: string): string {
	const safeVersion = version.replace(/[^\w.-]+/g, "_");
	return join(baseDir, ".agent-test", "calibration", `${host}-${safeVersion}.json`);
}
async function hostCalibrated(baseDir: string, host: string, version?: string): Promise<boolean> {
	if (!version) return false;
	return readFile(calibrationPath(baseDir, host, version)).then(
		() => true,
		() => false,
	);
}
/** Called by the host probe after every check passed. Other runs read it to label themselves. */
export async function recordHostCalibration(
	configDir: string,
	record: Pick<RunRecord, "host" | "binaryVersion">,
): Promise<void> {
	if (!record.binaryVersion) throw new Error("Cannot calibrate a host with an unknown version");
	const path = calibrationPath(configDir, record.host, record.binaryVersion);
	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, JSON.stringify({ ...record, at: new Date().toISOString() }, null, 2));
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
		calibrated: await hostCalibrated(base.baseDir, conditions.host, binaryVersion),
		packageVersion: base.packageVersion,
		git: base.git,
		hashes: {
			suite: base.suiteHash,
			prompt: sha256(prompt),
			skills: await skillsDigest(context),
			initialSnapshot: snapshotDigest(initial),
		},
	};
}
