# Anti-thrash preflight

<!-- doc-meta: owner=eng | last-reviewed=2026-07-16 -->

Run this **before council dispatch** on every `pr`, `review vs main`, and `merge`
review — **not** only when this chat already has prior review output. Bare
`review vs main` in a **new** chat is the common thrash entry; treat it as a
continuity check, not a fresh baseline. Continuity comes from prior findings
(`Theme:`), PR body, and git tip/hotspot archaeology.

Depth lane after classification → [modes.md](modes.md) § Contextual re-review.
Theme records, sweeps, exit gate → [fix-loop-ledger.md](fix-loop-ledger.md).
User-facing Continuity / `show ledger` → [output.md](output.md).

1. **Detect repeated review** — MUST treat as repeated when any is true:
   - Same branch/thread as a prior `Review · …` pass, or user asked to re-review
     after fixes.
   - Bare prompts (`review`, `review vs main`, `check the PR`) with no prior
     themes in the message.
   - Same branch with recent review-fix commits after a Full/Thorough Action
     pass.
   - **Commit-stack thrash:** tip history shows **≥2** consecutive commits that
     mostly touch the same hotspot file(s) / subsystem after an earlier broad
     Action pass (micro-fix trail).
   - Prior `Review ·` synthesis, `Theme:` finding lines, or theme table in
     commit messages or PR body; or an old leftover review ledger file from
     earlier skill versions (read once if present).
2. **Reconstruct themes** — rebuild the stable-theme table for dispatch from, in
   order ([fix-loop-ledger.md](fix-loop-ledger.md)):
   1. In-message synthesis / finding `Theme:` lines (if present).
   2. Prior synthesis embedded in PR body (if present).
   3. Recent commit messages containing a `theme_id` or `Review ·` block.
   4. Old leftover review ledger file (if present): read once for continuity.
   5. **Provisional themes from archaeology** when 1–4 miss: `git log` + hotspot
      paths from the micro-fix trail (one provisional `theme_id` per repeatedly
      patched invariant/family). Keep for member prompts / coordinator state.
      Do not reset closed themes. Missing chat context alone MUST NOT imply
      `first-baseline`.
3. **Classify the request** (record in dispatch plan and synthesis header as
   `Pass class:`):
   - `first-baseline` — no prior Action findings for this diff/PR **and** no
     recoverable themes / commit-stack signal from steps 1–2.
   - `fix-implementation` — user asked to implement/address findings (not a
     re-review yet).
   - `closure-re-review` — re-review after fixes; recoverable themes **and/or**
     commit-stack thrash; latest tip commit(s) only touch prior themes / their
     sweep surfaces / multi-pass hotspots. **Default** when step 1 detects
     repeated review. Still `closure-re-review` when themes look closed but the
     tip is another narrow patch on the same hotspot (verify exit gate — do not
     Full-baseline).
   - `new-scope-review` — re-review where scope materially expanded (new
     subsystems, new boundaries outside reconstructed themes), chat/PR/git
     archaeology all fail to bound themes, or contradictions unresolved.
4. **Choose depth lane** — `closure-re-review` → MUST prefer
   [targeted contextual re-review](modes.md#contextual-re-review) over another
   Full baseline council. Whole-branch file/line size thresholds MUST NOT alone
   promote to Full on this lane ([modes.md](modes.md)). Promote to Full
   contextual only when [modes.md](modes.md) § Contextual re-review lists a
   qualifying reason **other than** size alone. `new-scope-review` and
   `first-baseline` follow normal escalation.
5. **Thrash signal** — if the prior pass filed **two or more** Action blockers
   in the same subsystem / theme family, the same `theme_id` **reopened** on
   pass 2+, **or** the tip is another micro-fix on a multi-pass hotspot, MUST
   NOT spawn a symptom-hunting Full council. Require a
   [same-invariant sweep](fix-loop-ledger.md#same-invariant-sweep) for that
   family before filing more Action blocks; MUST NOT claim merge-ready until
   variant coverage is explicit. For
   [high-dimensional contract](fix-loop-ledger.md#high-dimensional-contract-themes)
   themes (parsers/classifiers), refuse theme `closed` until the matrix
   checklist is complete.
6. **Green cleanup** — when exit gate passes or zero themes are
   `open`/`reopened`, and an old leftover review ledger file is present, delete
   it.
