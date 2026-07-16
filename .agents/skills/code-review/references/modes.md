# Review Modes

`pr` and `merge` diff/base → [shared.md](shared.md). Agent selection → [agent-selection.md](agent-selection.md).

---

## `pr`

**Diff:** [shared.md](shared.md) · **Depth:** Thorough

**Escalate to Full** if any: auth/payments/privacy/security; API/schema changes; **>10 code files or >600 code lines** touching shared modules/boundaries/persistence (app packages, shared libraries — **exclude** `docs/`, skill trees, agent entry files from counts); **>20 code files or >1200 code lines** (same exclusion); weak/missing tests on risky paths. Record escalation in synthesis header per [output.md](output.md) § Status line (`Escalation: Stayed Thorough` / `Promoted to Full` / `Stayed targeted contextual` / `Promoted to Full contextual` + reason).

**Mixed PR** (product code + docs-only agent-workflow edits): default **Thorough** (4 agents) unless auth/security/API-schema paths hit.

**Docs / skills / agent-infra:** Excluding those paths from Full escalation **counts** does **not** waive council. Thorough still spawns **4** members; Full still spawns **5**. Solo coordinator review is never authorized by path theme.

**Optional architecture slot (not a council skip):** when the diff has a clear single theme and no placement/boundary change, the coordinator may omit `architecture` from **optional** slots — log that omit in the dispatch plan. This never zeros the depth budget and never authorizes writing a review report without Task/Subagent member runs.

**Promoted to Full → fix-loop applies.** Deliver findings in chat per [output.md](output.md) and initialize the stable-theme ledger in [fix-loop-ledger.md](fix-loop-ledger.md). Consumer review-fix-loop/customize may extend this lifecycle.

**Overlay:** Reviewer-ready? Breaking changes, regressions, missing contract updates?

**Emphasis:** shared-util regression; OpenAPI client regen; missing tests; PR vs implementation match. Path boosts: query/cache → `correctness`; backend → `api`; UI → `ux`.

### Depth contract for `review vs main`

`review vs main` on a branch → mode `pr`, diff `main...HEAD` (whole branch). Depth is **calibrated**, not always Full.

| Condition                                                                                                              | Depth                              | Council agents | Diff scope                          |
| ---------------------------------------------------------------------------------------------------------------------- | ---------------------------------- | -------------- | ----------------------------------- |
| Default (no escalation triggers below)                                                                                 | **Thorough**                       | 4              | Whole branch                        |
| Auth/security/API/schema; >10 files or >600 lines on shared paths; >20 files or >1200 lines; weak tests on risky paths | **Full** (escalated)               | 5              | Whole branch                        |
| Fix-loop pass 2+ · `closure-re-review` (diff only prior themes)                                                        | **Standard** (targeted contextual) | 2 (or Quick 1) | Whole branch + theme sweep surfaces |
| Fix-loop pass 2+ · Full promotion triggers (below) — **size thresholds alone do not qualify** on `closure-re-review`   | **Full** (contextual re-review)    | 5              | Whole branch                        |

Agent budget table: [agent-selection.md](agent-selection.md).

### Contextual re-review

Pass 2+ is **not** an automatic Full council. After [anti-thrash preflight](../SKILL.md#anti-thrash-preflight), choose a lane:

**Prefer targeted contextual re-review** (`closure-re-review`) when all are true:

- A stable-theme ledger exists from a prior pass (recovered from chat, `REVIEW_LEDGER.md`, PR body, or git — not only in-message).
- The latest fix commit / diff only touches prior themes and their [sweep surfaces](fix-loop-ledger.md#same-invariant-sweep).
- No unresolved baseline contradictions.
- Scope did not materially expand (no new subsystems / public-contract surfaces outside the ledger).
- Whole-branch `main...HEAD` exceeds file/line size thresholds — **does not** override this lane when classified `closure-re-review`. Record the carve-out in the synthesis header.

Targeted lane rules:

- Depth default **Standard** (2 members). Use **Quick** (1) only when a single theme’s hotspot needs independent scrutiny and the coordinator already completed the invariant + matrix sweep.
- Coordinator reconstructs the ledger, runs hotspot reads, and verifies each open/reopened theme’s sweep plan before synthesizing.
- Filing stays contextual: no sibling Action blocks for adjacent holes on an existing theme — extend / reopen that `theme_id`.
- Synthesis header must include `Pass class: closure-re-review`, `Pass: targeted contextual`, and one line why the pass stayed targeted (including size carve-out when applicable).

**Promote to Full contextual re-review** when any:

- Ledger missing or corrupted **after** ordered recovery ([SKILL.md anti-thrash preflight](../SKILL.md#anti-thrash-preflight) step 2).
- Unresolved baseline contradictions.
- Diff introduces new subsystems, boundaries, or auth/security/API/schema paths **outside** the recovered ledger scope.
- User explicitly asked for Full / exhaustive / include improvements on this re-review.

**Size thresholds (>10/600, >20/1200) and first-baseline auth/API/schema Full triggers apply to `first-baseline` and `new-scope-review` only.** They MUST NOT alone promote `closure-re-review` to Full contextual. When whole-branch size would have Full-promoted a first baseline but the pass is `closure-re-review`, header MUST record: `Escalation: Stayed targeted contextual (closure-re-review; whole-branch size ignored)`.

**Incomplete thrash sweep:** When a [thrash signal](fix-loop-ledger.md#thrash-signal) fired and the same-invariant sweep is incomplete, MUST NOT reflexively spawn a Full symptom-hunting council. Prefer targeted hotspot council on sweep surfaces from the reconstructed ledger; force sweep completion and [exit gate](fix-loop-ledger.md#exit-gate) block. Promote to Full contextual only when sweep surfaces cannot be bounded from the recovered ledger or a qualifying reason above applies (not size alone).

Full contextual lane still reads the **whole** branch diff, reconciles every candidate to the prior ledger, applies the invariant matrix, and holistically reviews multi-pass hotspots. Header: `Pass: Full contextual` + promotion reason.

**Contextual filing ≠ shallow read.** Targeted or Full, filing rules restrict what gets **appended** (no sibling blocks on closed themes except contradictions; improvements → Deferred tail). Do not waive member Task spawns; calibrate the budget instead.

**Depth regression:** If Full promotion triggers match but synthesis stays targeted/Thorough without recording why, treat as incomplete depth — re-run at Full or record the carve-out.

**Merge gate:** Exit any contextual re-review (targeted or Full) only when the [portable exit gate](fix-loop-ledger.md#exit-gate) passes — not merely when a pass reports zero findings. Consumer rules may strengthen but not weaken this gate.

**Default filing:** merge-blockers only — [merge-blockers.md](merge-blockers.md). Say `include improvements` for polish, tests, refactor.

---

## `commit`

**Diff:** `git show HEAD` or `git show <sha>` · **Depth:** Standard

**Overlay:** Atomic commit? Message matches diff? Stray debug/unrelated files?

**Emphasis:** atomicity, message accuracy, `console.log` / `.only` / stray files.

---

## `unstaged`

**Diff:** `git diff` · **Depth:** Standard

**Overlay:** WIP-safe to continue? Half-finished paths, session-breaking logic?

**Emphasis:** WIP blockers, resume-hostile structure — hygiene via consumer AI-drift / customize § Review lens.

---

## `staged`

**Diff:** `git diff --cached` · **Depth:** Standard

**Overlay:** Commit-ready? Accidental files, missing tests, CI lint blockers?

**Emphasis:** accidental `.env`/artifacts; staged logic tests; regenerate clients if schema changed; run consumer validation on touched paths; hygiene via consumer AI-drift / customize § Review lens.

---

## `merge`

**Diff:** [shared.md](shared.md) base + `git diff <base>...<head>` · **Depth:** Thorough

**Overlay:** Semantic conflicts beyond git merge? Feature complete vs spec?

**Emphasis:** integration correctness; migration ordering; duplicate parallel logic.

---

## `implementation`

**Diff:** `git diff <base> -- <paths>` + read files holistically · **Depth:** Thorough (leans Full)

**Overlay:** Right design, placement, naming for the domain — not just the delta.

**Emphasis:** architecture fit, abstraction level, module placement. Default base `main`; ask if paths unclear.
