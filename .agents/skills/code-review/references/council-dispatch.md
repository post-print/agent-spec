# Council Dispatch

End-to-end parallel council review. Spawn mechanics → [`multi`](../../multi/SKILL.md) non-negotiables. Entry → [`code-review`](../SKILL.md) workflow steps 1–2 (mode, depth, diff, fix-loop).

## Hard gate (before any review report)

1. Read [`multi` Non-negotiables](../../multi/SKILL.md#non-negotiables) this turn (Fit check does **not** apply — code-review already chose council).
2. Select members for the depth budget, then issue **one Task/Subagent call per selected member**.
3. Only after those calls complete → [synthesis.md](synthesis.md) → [output.md](output.md).

**Forbidden:** Solo `Review · …` synthesis because the diff is docs/skills/agent-infra, “single theme,” already inspected via coordinator tools, latency, or tokens. Coordinator `Read` / `Grep` / `Shell` is not a council.

**Valid member omit:** Only [modes.md](modes.md) § Optional architecture slot (log in plan) or a [`multi` valid skip](../../multi/SKILL.md#non-negotiables) that still leaves the remaining SELECTED members spawned. User decline / host cannot run Task → say so and **stop** (no fabricated report).

## Workflow

1. **Inputs from code-review** — mode, depth (after escalation per [modes.md](modes.md)), diff, filing mode, fix-loop state.
2. **Select agents** — [agent-selection.md](agent-selection.md) with profile `review` and current `depth`.
3. **Dispatch plan** — write per [multi workflow](../../multi/SKILL.md#workflow) plus review fields:

```markdown
Task: Code review — [mode] at [depth]
Classification: review
Pass class: [first-baseline | fix-implementation | closure-re-review | new-scope-review]
Source of truth: diff
Goal: [coverage / perspectives per depth]
Parent model: [Auto | <named model>]
User model overrides: [none | member=slug, …]

Loop state:

- Prior themes: [theme_id list or none]
- Ledger recovery source: [chat | _agent/review/REVIEW_LEDGER.md | PR body | git log | none]
- Last fix commits/files: [SHAs / paths or n/a]
- Hotspots (2+ passes): [paths or none]
- Thrash signal: [none | family + sweep required]
- Why this council size: [targeted Standard/Quick rationale OR Full promotion reason]

Selected members:

- [agent] · tier=[tier] · model=[inherit-auto | slug] · stance=[id]: [lens sub-task]

Why these members: [from agent-selection availability log]
Synthesis plan: council synthesis per synthesis.md → output.md
```

`inherit-auto` means **omit** the Task/Subagent `model` argument. It is not a model slug. Under an Auto parent, all members inherit Auto unless the user explicitly names a model for a member. Tier labels (including Premium) must not select a slug when `Parent model: Auto`.

Dispatch plans for pass 2+ **must** include loop state. Missing prior themes / council-size justification on a `closure-re-review` = incomplete dispatch.

4. **Overlays** — append to dispatch plan and **every** member Task `prompt`:
   1. **Generic Review overlay** (always) — [task-prompt-review.md](task-prompt-review.md) § Review overlay (mode, depth, diff).
   2. **Portable Default filing** — [task-prompt-review.md](task-prompt-review.md) § Default filing overlay, **unless** the consumer overlay SSOT replaces it.
   3. **Invariant overlay** — [task-prompt-review.md](task-prompt-review.md) § Invariant overlay for Thorough+ reviews **and** for any fix-loop contextual re-review (targeted or Full).
   4. **Contextual ledger overlay** — [task-prompt-review.md](task-prompt-review.md) § Contextual ledger overlay whenever prior Action findings exist (targeted or Full).
   5. **Consumer overlays** — when skill-read injection provided a fuller overlay set, append those sections (Default filing, Filing gate, Product intent, Baseline, Contextual Full, path boosts, Needs confirmation). Prefer injected consumer overlays over portable stubs when both exist; consumer context may extend but must not remove ledger reconciliation or the portable exit gate.

5. **Pre-spawn model-routing gate** — run [multi Pre-spawn model-routing gate](../../multi/SKILL.md#pre-spawn-model-routing-gate) and [Fail closed](../../multi/SKILL.md#fail-closed-do-not-spawn) **before** any Task/Subagent call. Review dispatch does not redefine that gate; it only supplies review members and overlays.
6. **Spawn (mandatory)** — one Task per selected agent in parallel. Compose base prompt per [multi task-prompt.md](../../multi/references/task-prompt.md); append review overlays. Apply [multi model assignment](../../multi/SKILL.md#model-assignment): `model=inherit-auto` in the plan means omit `model` on the tool call; an explicit slug is allowed only when the multi gate says it is. Skipping this step and writing findings yourself is a **violation**.

7. **Synthesize** — only after step 6 completes → [synthesis.md](synthesis.md) → [output.md](output.md).

## Checklist before synthesis

- [ ] [`multi` Non-negotiables](../../multi/SKILL.md#non-negotiables) read this turn
- [ ] Anti-thrash preflight completed when prior Action findings / re-review apply
- [ ] Dispatch plan includes pass class, prior themes, hotspots, and council-size justification on pass 2+
- [ ] Every member prompt includes Default filing overlay (consumer or portable)
- [ ] Every member prompt includes Review overlay (mode/depth/diff)
- [ ] Thorough+ **or** contextual re-review prompts include the invariant overlay and applicable matrix dimensions
- [ ] Pass 2+ prompts include the current stable-theme ledger (from chat **or** recovered from `_agent/review/REVIEW_LEDGER.md` / PR / git), sweep plans, reconciliation rules, and explicit “reject sibling Action themes for adjacent variants”
- [ ] Availability log recorded in dispatch plan
- [ ] One Task/Subagent completed per SELECTED member (architecture optional-slot omit logged if used; targeted Quick/Standard budget logged)
- [ ] Injected consumer overlays applied when present (Thorough+ Filing gate, product-intent when paths match, contextual ledger when prior Action findings exist)
- [ ] No review report written if zero members ran
- [ ] Adjacent variants on pass 2+ extend existing `theme_id`s (no fresh sibling Action blocks without a different-invariant justification)

## Related

- Council walkthrough → injected consumer agent-workflows overlay when present
- Fix-loop re-review → injected consumer review-fix-loop overlay § Contextual Full re-review
