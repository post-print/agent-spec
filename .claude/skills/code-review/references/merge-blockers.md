# Default filing — merge-blockers only

**SSOT:** Which finding **categories** to file by default on review (merge-blockers vs improvements mode). Edit here; cite from [output.md](output.md), [SKILL.md](../SKILL.md), [task-prompt-review.md](task-prompt-review.md).

**Per-finding Action bar** (introduced/reachable/behavior delta/PR-aligned → Action vs Noted/Deferred) → consumer worth-doing gate / customize. Apply **both**: this doc sets filing breadth; worth-doing gate filters individual findings at synthesis.

## Default (no extra keywords)

File **only merge-blockers** — bugs that would **surface in production** and need fixing before merge.

| File                                                        | Do not file (default)                                                             |
| ----------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Reachable wrong user-visible behavior                       | Test inventory / "add test for X" without a reachable untested bug                |
| Data loss or corruption on a real path                      | Docs-only gaps (unless missing security policy blocks deploy)                     |
| Auth / OAuth / security exploit on a reachable path         | Refactor, dedup, module placement, architecture nits                              |
| Core product action fails for a meaningful user segment     | UX copy polish, loading-state micro-edges, a11y polish                            |
| High-probability production regression with a named trigger | RFC/spec compliance with no known client break (note in Open questions if unsure) |

**Registry + synthesis:** `scope: ship-blocker` only. Do not append `hardening` or `improvement` rows unless improvements mode is active.

**Council still reads the whole diff** at the configured depth — filing is what gets narrowed, not audit scope.

**Synthesis status line** (when zero merge-blockers):

```markdown
No merge-blockers in scope.
```

When merge-blockers exist, count only ship-blockers in the findings line (omit hardening/improvement counts).

## Improvements mode (explicit opt-in)

Activate when the user says any of: **include improvements**, **improvements too**, **full audit**, **hardening pass**, **polish**, **test inventory**, **exhaustive audit**, **comprehensive pass**, or **do not cap findings**.

Then also file:

| `scope`         | File when                                                                                  |
| --------------- | ------------------------------------------------------------------------------------------ |
| **hardening**   | Real edge trigger → broken behavior; would affect production under plausible conditions    |
| **improvement** | Refactor, test inventory, docs, architecture — use Deferred improvements tail on re-review |

Record in synthesis header: `Filing: merge-blockers + improvements` (or `Filing: exhaustive`).

## Member prompt one-liner

```
Default filing: merge-blockers only ([merge-blockers.md](merge-blockers.md)). File only reachable production bugs (scope: ship-blocker). No test-gap, docs, refactor, or polish findings unless user requested improvements mode.
```
