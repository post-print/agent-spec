import { createRoot } from "react-dom/client";

import ViewerApp from "./client.js";
import type { ViewerBootstrap } from "./events.js";

const root = document.getElementById("viewer-root");
const bootstrapData = document.getElementById("bootstrap-data")?.textContent;

if (!(root instanceof HTMLElement) || bootstrapData === undefined) {
	throw new Error("Viewer shell is missing its root or bootstrap data");
}

const bootstrap = JSON.parse(bootstrapData) as ViewerBootstrap;
createRoot(root).render(<ViewerApp bootstrap={bootstrap} />);
