import { expect, it } from "bun:test";
import { mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ExecutionStore, recoverExecutionHistory } from "../sdk/execution-store.js";
import {
	preserveSourceChanges,
	releaseSnapshots,
	snapshotBudget,
} from "../sdk/snapshot-storage.js";
import { snapshot } from "../sdk/workspace.js";

async function fixture() {
	const root = await mkdtemp(join(tmpdir(), "snapshot-storage-"));
	const source = join(root, "source");
	await mkdir(source);
	await writeFile(join(source, "code.ts"), "source");
	return { root, source, dispose: () => rm(root, { recursive: true, force: true }) };
}
it("snapshot budget is shared, removes partial copies, and preserves hashes after cleanup", async () => {
	const f = await fixture();
	try {
		const budget = { ...snapshotBudget(), maximumBytes: 10, minimumFreeBytes: 0 };
		const target = join(f.root, "runs", "initial");
		expect((await snapshot(f.source, target, budget)).files["code.ts"]?.bytes).toBe(6);
		await expect(snapshot(f.source, join(f.root, "runs", "final"), budget)).rejects.toThrow(
			"budget exceeded",
		);
		await expect(readdir(join(f.root, "runs", "final"))).rejects.toThrow();
		await releaseSnapshots(join(f.root, "runs"));
		const manifest = JSON.parse(await readFile(`${target}.snapshot.json`, "utf8"));
		expect(manifest).toMatchObject({ status: "removed", files: { "code.ts": { bytes: 6 } } });
		await expect(readdir(target)).rejects.toThrow();
	} finally {
		await f.dispose();
	}
});
it("snapshot excludes known caches and explicit generated output, but preserves source dist by default", async () => {
	const f = await fixture();
	try {
		for (const name of [".agent-test", ".qualification-cache", "node_modules", "dist", "target"]) {
			await mkdir(join(f.source, name));
			await writeFile(join(f.source, name, "data"), "data");
		}
		const budget = snapshotBudget();
		budget.excludedNames.add("target");
		const result = await snapshot(f.source, join(f.root, "initial"), budget);
		expect(Object.keys(result.files).sort()).toEqual(["code.ts", "dist/data"]);
	} finally {
		await f.dispose();
	}
});
it("snapshot rejects symlinks and low free space without leaving partial data", async () => {
	const f = await fixture();
	try {
		await symlink(join(f.source, "code.ts"), join(f.source, "link"));
		await expect(snapshot(f.source, join(f.root, "initial"))).rejects.toThrow("symlinks");
		await rm(join(f.source, "link"));
		const budget = { ...snapshotBudget(), minimumFreeBytes: Number.MAX_SAFE_INTEGER };
		await expect(snapshot(f.source, join(f.root, "final"), budget)).rejects.toThrow("free space");
		await expect(readdir(join(f.root, "final"))).rejects.toThrow();
	} finally {
		await f.dispose();
	}
});
it("terminal outcomes release copies while preserving evidence and unrelated attachments", async () => {
	const f = await fixture();
	try {
		for (const status of ["passed", "failed", "interrupted"] as const) {
			const root = join(f.root, status);
			const store = await ExecutionStore.create({ root, id: status, config: "test" });
			const target = join(root, "test-results", "attempt", "agent-runs", "operation", "initial");
			await snapshot(f.source, target);
			await writeFile(join(root, "result.json"), "evidence");
			await mkdir(join(root, "attachment", "initial"), { recursive: true });
			await store.finish(status);
			await expect(readdir(target)).rejects.toThrow();
			expect(await readFile(join(root, "result.json"), "utf8")).toBe("evidence");
			expect(await readdir(join(root, "attachment", "initial"))).toEqual([]);
		}
	} finally {
		await f.dispose();
	}
});
it("recovery protects an active owner and cleans orphan snapshots on repeated execution", async () => {
	const f = await fixture();
	try {
		const active = join(f.root, "active");
		await ExecutionStore.create({
			root: active,
			id: "active",
			config: "test",
			ownerPid: process.pid,
		});
		await snapshot(f.source, join(active, "initial"));
		for (let index = 0; index < 5; index++) {
			const id = `orphan-${index}`,
				root = join(f.root, id);
			await ExecutionStore.create({ root, id, config: "test", ownerPid: 999_999 });
			await snapshot(f.source, join(root, "initial"));
			await recoverExecutionHistory(f.root);
			await expect(readdir(join(root, "initial"))).rejects.toThrow();
		}
		expect(await readFile(join(active, "initial", "code.ts"), "utf8")).toBe("source");
	} finally {
		await f.dispose();
	}
});

it("source evidence keeps modifications and deletion records within its own budget", async () => {
	const f = await fixture();
	try {
		const initial = await snapshot(f.source, join(f.root, "initial"));
		await rm(join(f.source, "code.ts"));
		await writeFile(join(f.source, "small.txt"), "new");
		await writeFile(join(f.source, "large.txt"), "too much");
		const final = await snapshot(f.source, join(f.root, "final"));
		await preserveSourceChanges({
			initial,
			final,
			directory: f.root,
			budget: { ...snapshotBudget(), maximumBytes: 3 },
		});
		await releaseSnapshots(f.root);
		expect(await readFile(join(f.root, "changed-files", "small.txt"), "utf8")).toBe("new");
		expect(JSON.parse(await readFile(join(f.root, "changes.json"), "utf8"))).toMatchObject({
			changes: { "code.ts": "deleted", "large.txt": "omitted-budget", "small.txt": "preserved" },
		});
	} finally {
		await f.dispose();
	}
});
it("execution recovery after SIGKILL removes partial snapshot storage", async () => {
	const f = await fixture();
	const storeModule = new URL("../sdk/execution-store.ts", import.meta.url).pathname;
	const snapshotModule = new URL("../sdk/workspace.ts", import.meta.url).pathname;
	const root = join(f.root, "killed");
	const script = `const { ExecutionStore } = await import(${JSON.stringify(storeModule)}); const { snapshot } = await import(${JSON.stringify(snapshotModule)}); await ExecutionStore.create({root:${JSON.stringify(root)},id:'killed',config:'test',ownerPid:process.pid}); await snapshot(${JSON.stringify(f.source)},${JSON.stringify(join(root, "initial"))}); console.log('ready'); setInterval(()=>{},1000);`;
	const child = Bun.spawn([process.execPath, "-e", script], { stdout: "pipe", stderr: "inherit" });
	try {
		const reader = child.stdout.getReader();
		await reader.read();
		reader.releaseLock();
		child.kill("SIGKILL");
		await child.exited;
		await recoverExecutionHistory(f.root);
		await expect(readdir(join(root, "initial"))).rejects.toThrow();
		expect(JSON.parse(await readFile(join(root, "execution.json"), "utf8"))).toMatchObject({
			status: "interrupted",
		});
	} finally {
		if (child.exitCode === null) child.kill("SIGKILL");
		await f.dispose();
	}
});

it("snapshot refuses an existing destination without deleting its contents", async () => {
	const f = await fixture();
	try {
		const target = join(f.root, "initial");
		await mkdir(target);
		await writeFile(join(target, "keep.txt"), "existing evidence");
		await expect(snapshot(f.source, target)).rejects.toThrow();
		expect(await readFile(join(target, "keep.txt"), "utf8")).toBe("existing evidence");
	} finally {
		await f.dispose();
	}
});
