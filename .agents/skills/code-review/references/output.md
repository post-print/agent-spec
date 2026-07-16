# Review output

Extends [output-schema.md](https://raw.githubusercontent.com/csark0812/toolbox/main/.skeleton/references/output-schema.md). Synthesis via [synthesis.md](synthesis.md) ends here. Worth-doing gate → consumer worth-doing gate / customize.

**Default filing:** Merge-blockers only — [merge-blockers.md](merge-blockers.md). Unless the user opted into improvements mode, file **only** `scope: ship-blocker` (reachable production bugs). Do not file test inventory, docs gaps, refactor, or polish.

Match the **scannable finding-block shape** for **Action** items — short imperative title, one location line, brief description (informally "Bugbot-style"; not the Cursor `bugbot` subagent). No numbered action lists, severity badges in titles, or process narration.

## Output tiers

| Tier         | Chat                                             |
| ------------ | ------------------------------------------------ |
| **Action**   | Primary body — finding blocks                    |
| **Noted**    | **Noted (out of PR scope)** tail — one line each |
| **Deferred** | **Deferred improvements** tail — one line each   |

## Status line

**Required header** (first line of every `pr` / `merge` synthesis, including zero-findings):

```markdown
Review · pr · Full · Pass class: first-baseline · Escalation: Promoted to Full (auth/security, 40 files) · Filing: merge-blockers only
```

Format: `Review · {mode} · {depth} · Pass class: {first-baseline|closure-re-review|new-scope-review} · Escalation: {Stayed Thorough|Promoted to Full|Stayed targeted contextual|Promoted to Full contextual} ({brief reason})`. Required on every `pr` / `merge` review that ran anti-thrash preflight. Optional: `Pass: targeted contextual` / `Pass: Full contextual` on fix-loop re-reviews; `Filing: merge-blockers only` (default) or `Filing: merge-blockers + improvements` when user opted in — [merge-blockers.md](merge-blockers.md). Missing escalation line on a `pr` review = **incomplete turn**. Depth regression: if Full triggers in [modes.md](modes.md) apply but header says Thorough/targeted without a recorded carve-out, fix depth before ending the turn.

**Closure re-review size carve-out example:**

```markdown
Review · pr · Standard · Pass class: closure-re-review · Escalation: Stayed targeted contextual (closure-re-review; whole-branch size ignored) · Pass: targeted contextual · Filing: merge-blockers only
```

**Commit-stack / missing-ledger carve-out example:**

```markdown
Review · pr · Standard · Pass class: closure-re-review · Escalation: Stayed targeted contextual (closure-re-review; commit-stack archaeology; whole-branch size ignored) · Pass: targeted contextual · Filing: merge-blockers only
```

**Findings count line** (second line):

```markdown
1 action · 0 ship-blocker · 1 high · 5 noted · 3 deferred
```

Format: `N action · N ship-blocker · severity breakdown (high/medium/low on Action only) · N noted · N deferred`

Zero Action ship-blockers (default filing):

```markdown
No merge-blockers in scope.
```

Zero Action items overall (worth-doing gate filtered everything):

```markdown
No action items in scope.
```

Improvements mode with zero ship-blockers:

```markdown
No merge-blockers in scope · 4 improvement (improvements mode)
```

Zero findings on small PR (Thorough, no fix-loop):

```markdown
No findings in scope.
```

### Dual zero lines (Thorough vs Full exit)

| Line                          | When                                                                                                        | Merge-ready?        |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------- | ------------------- |
| `No merge-blockers in scope.` | Default filing; Full fix-loop **exit** pass; any `pr` review in merge-blockers mode with zero ship-blockers | Yes (fix-loop exit) |
| `No action items in scope.`   | Worth-doing gate filtered all council observations; Noted/Deferred may remain                               | Context-dependent   |
| `No findings in scope.`       | Thorough/small PR, **no fix-loop**                                                                          | Yes (small PR)      |

Both zero merge-blocker lines mean "nothing blocking merge **for this pass type**." Do not treat first Full baseline `No merge-blockers` as exit — baseline with open Action themes is not merge-ready.

Optional one-line scope may precede the header. In improvements mode, include scope counts (`ship-blocker` · `hardening` · `improvement`).

## Finding blocks (Action only — primary body)

One block per **Action** issue, severity descending (critical → high → medium → low). **Noted** and **Deferred** never use finding blocks.

**Fix-loop baseline:** merge duplicates and shared invariants into **one block** per high/medium theme — mandatory, not optional. Assign a stable kebab-case `theme_id`; variants are description bullets inside the block, not sibling blocks.

**Cross-turn references (fix-loop):** cite the stable `theme_id` from [fix-loop-ledger.md](fix-loop-ledger.md). Titles and locations may change without creating a new theme.

**Re-review:** classify every candidate as incomplete fix, same-invariant variant, genuinely new invariant, or non-blocking. Same invariant + new edge extends the existing `theme_id` (incomplete prior closure) — never a fresh sibling for an adjacent hole. Do not append sibling blocks for minor edges on **closed** themes. A genuinely new Action theme on pass 2+ must include `Prior-pass miss: <why this blocker class escaped earlier invariant/contract coverage>.` Header must record `Pass: targeted contextual` or `Pass: Full contextual` with reason.

```markdown
## Reset panelMode on host navigation

`<app>/path/to/File.tsx:71-85` · Theme: `host-navigation-lifecycle` · Severity: high · Scope: ship-blocker

<details>
<summary>Description</summary>

Host `pushState`/`replaceState` updates `url`, but `panelMode` is never reset. After SPA navigation from a generic page into a detected paper site, the panel can stay on Save or identify instead of loading paper metadata.
</details>
```

**Title** — short imperative phrase (what to fix or what's wrong). Not `**[High]**` prefixes.

**Location line** — `` `path/to/file.ts:line` `` or `` `path:start-end` `` · Theme: `stable-theme-id` · Severity: critical|high|medium|low · Scope: ship-blocker|hardening (lowercase severity; theme, severity, and scope required for Action items).

**Description** — 1–4 sentences: starting state → user action → runtime condition → visible failure/impact. Answer "How would this happen to a real user?" No filler, no agent attribution.

**Needs confirmation** — append to location line: `· Needs confirmation` when reachability or intentional UX change is unproven **and** not covered by a PR intent section when one exists.

Missing tests alone ≠ an Action item unless tied to reachable production risk — route to **Deferred** (`test inventory · <path>`). In default mode, untested risky path without a named reachable failure = **do not file** ([merge-blockers.md](merge-blockers.md)). Hardening Action bar requires passing consumer worth-doing gate / customize, not merely "real trigger somewhere."

## Noted (out of PR scope)

When council observations fail the worth-doing gate but are worth recording. **Mandatory section when any Noted items exist.** One line per item — no collapsible blocks.

Schema: `` `path` or area — <category> · <context> · <defer hint> ``

Categories: `pre-existing` · `parity-only` · `script-only` · `annotation-system follow-up`

```markdown
## Noted (out of PR scope)

- `utils_merge.py` incoming ORM vs SQL — parity-only · same semantics per tests · unify when refactoring merge_sources
- `utils_merge.py` identifier UPDATE collision — pre-existing · fast-batch · defer unless arxiv merge hits duplicates
- `toolset.py` update_/move_ idempotent inference — annotation-system follow-up · add @mcp_tool or fix prefix rule in MCP pass
```

Not a todo list — context for deferral, not implied merge work.

## Deferred improvements

Polish, test inventory, closed-theme minor edges, refactor out of PR scope. Use on **baseline and re-review** when applicable. One line per item.

Schema: `` `path` or topic — test inventory · <gap> `` or `<topic> · <area>`

```markdown
## Deferred improvements

- `test_mcp_tool_annotations_drift.py` — test inventory · golden manifest for semantic hints, not wiring-only
- Fast-batch citation tests — test inventory · NULL reference_order scenarios exist on slow path only
```

Do not append as Action findings. Do not block fix-loop exit.

## Tail sections

Required rows below must appear in their stated lifecycle; use optional rows
only when they add decision value. Keep each section concise.

| Section                     | When                                                                                        |
| --------------------------- | ------------------------------------------------------------------------------------------- |
| **Continuity**              | Fix-loop with open/reopened themes — one line after findings (default)                      |
| **Fix-loop themes**         | Only when user asked `include continuity` / `show ledger`                                   |
| **Baseline contradictions** | Only with verbose continuity (`show ledger` / `include continuity`) on re-review            |
| **Closure evidence**        | Closing a theme that spanned 2+ passes — in verbose continuity or merge-ready Exit evidence |
| **Exit evidence**           | Contextual re-review that claims merge-ready — short bullets                                |
| **Open questions**          | Product or backend assumptions block Action severity                                        |
| **Testing gaps**            | Residual coverage not already in Deferred tail                                              |
| **Change summary**          | User asked for overview, or first review on a large PR — max 3 sentences                    |

Omit **Change summary** by default. Do not restate Action items in tail sections.
Default user output is findings-first: header → findings → optional Continuity line
→ synthesis. Carry full theme tables in member prompts
([fix-loop-ledger.md](fix-loop-ledger.md)).

Default chat shape (no `show ledger` / `include continuity`):

```markdown
Review · pr · Standard · Pass class: closure-re-review · …

## Findings

### …

`path` · Theme: `theme-id` · …

Continuity: theme-id still open on path (reason). Next review stays targeted.

## Review synthesis

…
```

Leave out `## Fix-loop` / theme tables and `## Baseline contradictions` in that
default shape. Those sections are opt-in below.

## Continuity (default when themes remain open)

When Action themes remain `open` or `reopened` and the user did **not** ask for
verbose continuity, end findings with **one** line (before synthesis):

```markdown
Continuity: query-preservation still open on redirect.ts (hash variant). Next review stays targeted.
```

Include `theme_id`, hotspot path, and why it remains open. No table. On green /
zero open themes: omit this line. If an old leftover review ledger file is
present, delete it.

## Fix-loop themes (opt-in verbose)

Emit the full theme table + open/reopened sweep blocks only when the user asked
`include continuity`, `show ledger`, or `show fix-loop ledger`. Schema →
[fix-loop-ledger.md](fix-loop-ledger.md). Also emit **Baseline contradictions**
on re-review when verbose. Without that ask, prefer the Continuity one-liner and
omit this section.

```markdown
## Baseline contradictions

| Theme                     | Prior synthesis | Fresh Full                              | Action               |
| ------------------------- | --------------- | --------------------------------------- | -------------------- |
| host-navigation-lifecycle | fixed           | Same root_cause still broken in App.tsx | Reopen — partial fix |
```

## Closure evidence (repeated themes)

When a theme was open across two or more passes, keep compact closure evidence
for exit-gate checks (and in verbose continuity / Exit evidence when claiming
merge-ready):

```markdown
### Closure · `theme-id`

- Variants checked: <matrix rows covered / N/A reasons>
- Regression evidence: <test path or why impossible>
- Validation: <command + result>
- Hotspot review: <files/subsystems + who reviewed>
```

Missing **variants checked** means the theme is not closed — reopen or leave
`open`. See [fix-loop-ledger.md](fix-loop-ledger.md) § Variant coverage before
closure.

## Exit evidence

Before writing `Merge-ready`, `final blockers`, or equivalent, report short bullets:

- Open/reopened themes: none.
- Repeated hotspots reviewed holistically.
- Variants / regression evidence for repeated Action themes.
- Authoritative repository validation command and result.

If validation was not run or any exit-gate row is unknown, state that and do not
claim merge-ready even when no Action findings were filed.

## Scope (Action items)

| Scope            | File when                                                       | Blocks exit?                  |
| ---------------- | --------------------------------------------------------------- | ----------------------------- |
| **ship-blocker** | User-visible wrong behavior, data loss, auth on reachable path  | Yes                           |
| **hardening**    | In-scope edge with real trigger **and** passes worth-doing gate | Yes if medium+ and theme open |

**improvement** scope → **Deferred** tail, not Action blocks.

Severity = user harm if shipped. Scope = whether this pass must act on **Action** items.

## Severity

| Level        | Bar                                                                                                     |
| ------------ | ------------------------------------------------------------------------------------------------------- |
| **critical** | Data loss, security exposure, core path total break                                                     |
| **high**     | Core action fails for meaningful segment; bad state propagation; high-probability production regression |
| **medium**   | Non-core regression, moderate edge-case mismatch, narrow blast radius                                   |
| **low**      | Rare/low-impact edge; contained scope                                                                   |

Adjust: raise if common trigger and retries can't heal; lower if guards make trigger improbable. Never raise for complexity alone.

## GitHub / plain-text fallback

When `<details>` won't render, flatten each Action item to three lines: `## Title`, location + severity + scope, then description paragraph (no collapsible). Noted/Deferred as plain bullet lists.

Short, informal; no cheerleading. Thread replies → include original comment verbatim.
