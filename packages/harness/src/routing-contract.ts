export type RoutingContract = "hands-on" | "hands-off";

/** Live dogfood output contract derived from agent-routing.md (not scenario answer keys). */
export function buildRoutingContract(mode: RoutingContract): string {
	if (mode === "hands-off") {
		return [
			"Output contract (mandatory — first lines of your reply, before tools or other prose):",
			"Print the PR § Routing block from agent-routing.md exactly as markdown:",
			"## Routing",
			"- **Tier:** Low | Medium | High",
			"- **Signals:** …",
			"- **Invariant applied:** …",
			"- **Escalations:** none | …",
			"- **Open questions:** none | …",
			"Do not call tools or write planning text until this block is complete.",
			"After the Routing block, continue the task with tools and the deliverable — do not end the turn at the announce.",
		].join("\n");
	}

	return [
		"Output contract (before any tools or edits):",
		"Announce routing per agent-routing.md hands-on rule — one line with tier, e.g.:",
		"  Tier: low — …   OR   Medium — …   OR   Routing: Medium — …",
		"After the announce line, continue the task with tools — do not end the turn at the announce.",
	].join("\n");
}
