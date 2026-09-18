import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { useEffect } from "react";
import { createRoot } from "react-dom/client";

import type { ViewerBootstrap } from "./bootstrap.js";
import { viewerRouter } from "./v2-client.js";

const root = document.getElementById("viewer-root");
const bootstrapData = document.getElementById("bootstrap-data")?.textContent;

if (!(root instanceof HTMLElement) || bootstrapData === undefined) {
	throw new Error("Viewer shell is missing its root or bootstrap data");
}

const bootstrap = JSON.parse(bootstrapData) as ViewerBootstrap;
const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 5_000 } } });

function ExecutionSync({ bootstrap }: { bootstrap: ViewerBootstrap }) {
	useEffect(() => {
		return connectExecutionSync(bootstrap);
	}, [bootstrap]);
	return null;
}

type LiveEvent = {
	type: string;
	catalog?: unknown;
	executions?: LiveExecution[];
	execution?: { id?: unknown };
};
type LiveExecution = { id: string; status: string };

function applyLiveEvent(message: MessageEvent): void {
	const event = JSON.parse(message.data) as LiveEvent;
	if (event.type === "catalog.snapshot") queryClient.setQueryData(["test-catalog"], event.catalog);
	if (event.type === "executions.snapshot") applyExecutionHistory(event.executions ?? []);
	if (event.type === "execution.snapshot" && typeof event.execution?.id === "string")
		queryClient.setQueryData(["execution", event.execution.id], event.execution);
}

function applyExecutionHistory(executions: LiveExecution[]): void {
	const previous = queryClient.getQueryData<LiveExecution[]>(["execution-history"]);
	queryClient.setQueryData(["execution-history"], executions);
	const executionId = newlyRunningExecution(previous, executions);
	if (executionId && !pageShowsExecution(executionId))
		void viewerRouter.navigate({
			to: "/executions/$executionId",
			params: { executionId },
		});
}

function pageShowsExecution(executionId: string): boolean {
	const url = new URL(window.location.href);
	return (
		url.pathname === `/executions/${executionId}` ||
		url.searchParams.get("execution") === executionId
	);
}

function newlyRunningExecution(
	previous: LiveExecution[] | undefined,
	executions: LiveExecution[],
): string | undefined {
	const known = new Set(previous?.map(({ id }) => id) ?? []);
	return executions.find(({ id, status }) => status === "running" && !known.has(id))?.id;
}

function connectExecutionSync(bootstrap: ViewerBootstrap): (() => void) | undefined {
	const socket = bootstrap.capabilities.socket;
	if (!socket) return undefined;
	let connection: WebSocket | undefined;
	let reconnect: ReturnType<typeof setTimeout> | undefined;
	let stopped = false;
	let opened = false;
	let delay = 250;
	const connect = () => {
		const protocol = location.protocol === "https:" ? "wss:" : "ws:";
		connection = new WebSocket(`${protocol}//${location.host}${socket.path}?token=${socket.token}`);
		connection.onopen = () => {
			if (opened) void queryClient.invalidateQueries({ queryKey: ["execution"] });
			opened = true;
			delay = 250;
			connection?.send(
				JSON.stringify({
					type: "hello",
					protocol: socket.protocol,
					subscriptions: ["catalog", "executions"],
				}),
			);
		};
		connection.onmessage = applyLiveEvent;
		connection.onclose = () => {
			if (stopped) return;
			reconnect = setTimeout(connect, delay);
			delay = Math.min(delay * 2, 5_000);
		};
	};
	connect();
	return () => {
		stopped = true;
		if (reconnect) clearTimeout(reconnect);
		connection?.close();
	};
}
createRoot(root).render(
	<QueryClientProvider client={queryClient}>
		<ViewerRoot />
	</QueryClientProvider>,
);

function ViewerRoot() {
	return (
		<div>
			<ExecutionSync bootstrap={bootstrap} />
			<RouterProvider router={viewerRouter} />
		</div>
	);
}
