import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
export interface ProcessOwner {
	pid: number;
	startedAt?: string;
}

export async function processOwner(pid = process.pid): Promise<ProcessOwner> {
	try {
		const { stdout } = await execFileAsync("ps", ["-p", String(pid), "-o", "lstart="]);
		return { pid, startedAt: stdout.trim() || undefined };
	} catch {
		return { pid };
	}
}

/** Unknown identity or permission failures protect storage conservatively. */
export async function ownerIsActive(owner: ProcessOwner): Promise<boolean> {
	try {
		process.kill(owner.pid, 0);
	} catch (error) {
		return (error as NodeJS.ErrnoException).code !== "ESRCH";
	}
	if (!owner.startedAt) return true;
	const current = await processOwner(owner.pid);
	return !current.startedAt || current.startedAt === owner.startedAt;
}
