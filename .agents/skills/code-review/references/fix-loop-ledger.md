# Fix-loop themes

<!-- doc-meta: owner=eng | last-reviewed=2026-07-16 -->

Portable state for review → fix → re-review convergence. Theme identity lives in
Action finding lines (`Theme: …`), coordinator/member prompts, and git tip /
hotspot archaeology across chats.

Do not rely on line numbers or finding order as identity.

## Continuity

Primary signals (in order):

1. Prior finding `Theme:` lines / synthesis in this thread (if present).
2. Prior synthesis embedded in PR body (if present).
3. Recent commit messages containing a `theme_id` or `Review ·` header.
4. **Commit-stack / hotspot archaeology:** tip history of micro-fixes on the same
   files/subsystem after a broad Action pass — reconstruct provisional themes for
   dispatch and member prompts.
5. Old leftover review ledger file from earlier skill versions (if present): read
   once. When the [exit gate](#exit-gate) is green (or no themes remain open),
   delete that leftover file and remove an empty `_agent/review/` directory.

Default user-facing output is findings + optional `Continuity:` line — not a
theme table (see [output.md](output.md)). Carry the full table in member prompts
whenever fix-loop applies. Emit the table in chat only on `show ledger` /
`include continuity`.

## Theme record

Use one row per root invariant, not per symptom. Keep this table for dispatch /
member prompts. Emit it in user chat only when the user asked `include continuity`
/ `show ledger`.

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

| Change class                | Minimum dimensions to inspect                                                                                                                                                                                                           |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Routing / validation        | empty, single, mixed, skipped, unknown; local vs CI; fail-open vs fail-closed                                                                                                                                                           |
| Paths / files               | relative, absolute, normalized, traversal, symlink, missing target, platform separator                                                                                                                                                  |
| Source rewrites             | destination binding, titled links, duplicate URL text, inline links, reference definitions, label/title collisions, parser offsets, fence, inline code, prefix/suffix, generated file                                                   |
| Public contracts            | runtime, schema, exported declarations, docs/examples, CLI help, error behavior, generated artifacts                                                                                                                                    |
| State / cache / persistence | read key, write key, invalidation, migration, retry, stale/concurrent state                                                                                                                                                             |
| Auth / permissions          | anonymous, least privilege, denied, expired, cross-tenant, partial failure                                                                                                                                                              |
| Parser / classifier output  | See [High-dimensional contract themes](#high-dimensional-contract-themes) — whole vs fenced vs preamble; object / array / primitive; trailing junk; English salvage prefixes; incidental mid-prose blobs; fail-closed vs legacy salvage |

The matrix is a review aid, not a mandate to file test inventory. Default filing
remains merge-blockers only.

## High-dimensional contract themes

Parsers, classifiers, serializers, and similar **high-dimensional input →
structured output** contracts thrash when each review files one reply shape and
marks the theme `closed`. Treat them as one matrix, not a stack of sibling bugs.

Before a parser/classifier (or equivalent) theme may move to `closed`:

1. Attach a **variant checklist** derived from the applicable matrix dimensions
   below (check or N/A each row — do not stop at the filed counterexample).
2. Prefer **one intentional matrix pass** + regression coverage over a chain of
   symptom patches across fresh chats.
3. On re-review, if an adjacent shape still fails, **reopen** the same
   `theme_id` and extend the checklist — MUST NOT invent a sibling Action theme.

Minimum checklist for judge / reply-parse / salvage-style invariants (adapt
names to the repo; keep the dimensions):

| Dimension                  | Examples to check (or N/A)                                       |
| -------------------------- | ---------------------------------------------------------------- |
| Framing                    | whole-text · markdown-fenced · prose-preamble + body             |
| Value shape                | object · array · string/number/bool/null primitive               |
| Contract validity          | valid schema · missing required keys · truncated / trailing junk |
| Salvage boundary           | refuse YES/NO when structured latch applies · allow legacy prose |
| English / list prefixes    | digit · digit+comma · bool/null word · numbered-list markers     |
| Incidental mid-prose blobs | scores lists · quote objects · instructional `"verdict":` prose  |

Filing a regression for only the reported example is **premature closure**.

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
   Full baseline council — unless [modes.md](modes.md) § Contextual re-review
   lists a qualifying Full reason **other than** whole-branch size alone.

## Premature closure (named failure mode)

Closing a theme after fixing only the reported example, a thin regression for
that example alone, or without matrix + sweep evidence is **premature closure**.
Symptoms:

- Theme marked `closed` but an adjacent variant of the same invariant still fails.
- Closure evidence lists only the filed example; **variants checked** is missing
  or names a single row without sweep execution.
- A regression test covers E1 only while E2/E3 of the same invariant remain reachable.

When premature closure is detected on pass 2+, **reopen** the existing `theme_id`
(same invariant, new edge). Do not invent a sibling Action theme. Record under
**Baseline contradictions** when prior synthesis claimed the theme closed (opt-in
verbose / internal reconciliation — not default user output).

## Variant coverage before closure

A theme MUST NOT move to `closed` unless variant checklist rows are checked or
explicitly N/A'd. Do not mark a theme `closed` after fixing only the reported
example. Before closure evidence is complete:

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

## Reopen on pass 2+ (thrash hardening)

When the **same** `theme_id` reopens on pass 2+ (adjacent edge, premature
closure, or incomplete prior sweep):

1. MUST complete the same-invariant sweep before filing further Action blocks
   in that theme family.
2. MUST NOT claim merge-ready until variant coverage is explicit in closure
   evidence.
3. MUST NOT invent a sibling Action theme for the adjacent edge — extend /
   reopen the existing `theme_id`.
4. Prefer targeted hotspot council on sweep surfaces — not a reflex Full
   symptom-hunting pass.

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

When the same branch/thread is reviewed again after fixes — **including bare
`review vs main` in a new chat**:

1. Reconstruct themes before dispatch ([anti-thrash.md](anti-thrash.md))
   from findings / PR / git archaeology.
2. Classify as `closure-re-review` vs `new-scope-review`.
3. Carry every prior `theme_id` into member prompts; do not renumber or rename
   for title wording changes.
4. Reconcile against prior themes (Baseline contradictions stay internal unless
   the user asked for verbose continuity).
5. Do not claim merge-ready until the [exit gate](#exit-gate) passes.
6. Do not Full-promote solely because the whole branch is large.
7. On green: omit Continuity footer; delete any leftover review ledger file if present.

## Hotspots

Before an exit pass, identify files or subsystems changed in two or more fix
commits/passes. Assign one council member or the coordinator to read each
hotspot holistically against its invariant matrix, not only the latest patch.

## Exit gate

Use merge-ready or “final blockers” language only when all are true:

- No theme remains `open` or `reopened`; `wontfix` decisions are explicit.
- No **premature closure** — every closed theme has variants checked + completed
  sweep (or N/A reasons) in closure evidence. [High-dimensional contract](#high-dimensional-contract-themes)
  themes also need their matrix checklist complete (not only the filed example).
- No reopened theme lacks a completed sweep plan after thrash signal or pass 2+
  reopen.
- Baseline contradictions are empty (internal check).
- Repeatedly changed hotspots received aggregate re-review.
- Every repeated Action theme has variant coverage checked, a completed sweep
  plan (or N/A reasons), plus a regression test or a written reason one is not
  possible.
- The repository’s authoritative validation lane passed, or the output clearly
  states which validation was not run and does not claim merge-ready.
- Any leftover review ledger file from older skill versions has been deleted when
  present.

Zero findings alone does not satisfy this gate.
