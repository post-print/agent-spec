# Fix-loop ledger

<!-- doc-meta: owner=eng | last-reviewed=2026-07-15 -->

Portable state for review → fix → re-review convergence. The ledger travels in
the chat handoff and every contextual re-review council prompt; do not rely on
line numbers or finding order as identity.

## Theme record

Use one row per root invariant, not per symptom:

```markdown
| theme_id         | invariant                                        | surfaces            | state  | closure evidence                                      | contradiction |
| ---------------- | ------------------------------------------------ | ------------------- | ------ | ----------------------------------------------------- | ------------- |
| path-containment | Resolved paths remain inside the configured root | runtime, CLI, tests | closed | negative traversal + symlink tests; full check passed | none          |
```

- `theme_id`: stable kebab-case identity retained across renamed findings and
  moved code.
- `invariant`: behavior that must remain true for all relevant inputs.
- `surfaces`: affected contracts such as runtime, schema, exported types, CLI,
  config, docs, persistence, permissions, generated output, and tests.
- `state`: `open`, `closed`, `reopened`, `superseded`, `wontfix`, or `deferred`.
- `closure evidence`: implementation path, regression/negative test,
  **variant coverage checked**, sweep plan result, and validation
  command/result. State why a test is not possible when applicable.
- `contradiction`: disagreement between prior synthesis and fresh evidence.

## Invariant matrix

Before filing or closing a theme, derive only the applicable rows from the
diff. Add repo-specific dimensions when the changed behavior demands them.

| Change class                | Minimum dimensions to inspect                                                                                                                                                         |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Routing / validation        | empty, single, mixed, skipped, unknown; local vs CI; fail-open vs fail-closed                                                                                                         |
| Paths / files               | relative, absolute, normalized, traversal, symlink, missing target, platform separator                                                                                                |
| Source rewrites             | destination binding, titled links, duplicate URL text, inline links, reference definitions, label/title collisions, parser offsets, fence, inline code, prefix/suffix, generated file |
| Public contracts            | runtime, schema, exported declarations, docs/examples, CLI help, error behavior, generated artifacts                                                                                  |
| State / cache / persistence | read key, write key, invalidation, migration, retry, stale/concurrent state                                                                                                           |
| Auth / permissions          | anonymous, least privilege, denied, expired, cross-tenant, partial failure                                                                                                            |

The matrix is a review aid, not a mandate to file test inventory. Default filing
remains merge-blockers only.

## Same-invariant sweep

For every **Action** theme, attach a short sweep plan before the next fix or
re-review. List the symbols, APIs, config fields, docs surfaces, and tests that
share the invariant — not only the example that was filed.

```markdown
### Sweep · `theme-id`

- Symbols / APIs: <names>
- Config / schema fields: <names>
- Docs / CLI / help surfaces: <paths>
- Tests / fixtures: <paths or to-add>
- Matrix rows: <applicable invariant-matrix dimensions>
```

Rules:

1. Closure evidence is incomplete until the sweep plan was executed (or each
   skipped surface has an explicit N/A reason).
2. If a later pass finds an adjacent edge of the same invariant, mark prior
   closure incomplete and **reopen** the existing `theme_id`. Do not invent a
   fresh sibling theme.
3. On re-review, member prompts and the coordinator must ask: “what sibling
   variants would fail if the current fix is too narrow?” Return those under
   the same `theme_id`.

## Thrash signal

Stop symptom-by-symptom filing when either:

- Two or more Action blockers in the **same subsystem / theme family** appear
  on one pass, or
- Pass 2+ rediscovers adjacent holes next to a recently closed theme.

Then:

1. Pause filing further individual Action blocks for that family.
2. Perform a holistic same-invariant sweep across the shared surfaces.
3. Collapse symptoms into one `theme_id` (or reopen the existing one).
4. Prefer targeted contextual re-review after the sweep — not another reflex
   Full baseline council — unless [modes.md](modes.md) Full promotion triggers
   match.

## Variant coverage before closure

Do not mark a theme `closed` after fixing only the reported example. Before
closure evidence is complete:

1. List the applicable matrix dimensions for that invariant.
2. Execute the theme’s sweep plan (or record N/A per surface).
3. Check each dimension for the same failure mode (or state why it does not
   apply).
4. Prefer one theme-complete fix + regression coverage over a symptom patch.

If a later pass finds the **same invariant + a new edge**, prior closure
evidence was incomplete. Reopen the existing `theme_id`; do not invent a fresh
sibling theme for the adjacent hole.

Ask on every narrow fix: “what other variants of this invariant would fail if
this fix is too narrow?”

## Reconciliation

For every candidate found on pass 2+, classify it before synthesis:

1. Same theme, incomplete fix → reopen the existing `theme_id`.
2. Same invariant, new variant → add evidence under the existing theme
   (prior closure incomplete).
3. Genuinely different invariant → create a new `theme_id` and state in one line
   why prior passes missed this blocker class.
4. No reachable production failure → Noted or Deferred under normal filing rules.

Synthesis must **reject** a fresh Action block for an adjacent variant unless the
finding text explains why the root invariant is genuinely different.

## Repeated-review guard

When the same branch/thread is reviewed again after fixes:

1. Reconstruct the ledger before dispatch ([SKILL.md anti-thrash preflight](../SKILL.md#anti-thrash-preflight)).
2. Classify as `closure-re-review` vs `new-scope-review`.
3. Carry every prior `theme_id` into member prompts; do not renumber or rename
   for title wording changes.
4. Require Baseline contradictions when prior synthesis exists.
5. Do not claim merge-ready until the [exit gate](#exit-gate) passes.

## Hotspots

Before an exit pass, identify files or subsystems changed in two or more fix
commits/passes. Assign one council member or the coordinator to read each
hotspot holistically against its invariant matrix, not only the latest patch.

## Exit gate

Use merge-ready or “final blockers” language only when all are true:

- No ledger theme remains `open` or `reopened`; `wontfix` decisions are explicit.
- Baseline contradictions are empty.
- Repeatedly changed hotspots received aggregate re-review.
- Every repeated Action theme has variant coverage checked, a completed sweep
  plan (or N/A reasons), plus a regression test or a written reason one is not
  possible.
- The repository’s authoritative validation lane passed, or the output clearly
  states which validation was not run and does not claim merge-ready.

Zero findings alone does not satisfy this gate.
