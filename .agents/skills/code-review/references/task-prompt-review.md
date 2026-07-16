# Task Prompt — Review Overlays

<!-- doc-meta: owner=eng | last-reviewed=2026-07-15 -->

Review-specific member prompt overlays. Generic template → [multi task-prompt.md](../../multi/references/task-prompt.md).

Orchestrated by [`code-review`](../SKILL.md) via [`multi`](../../multi/SKILL.md) kernel + [council-dispatch.md](council-dispatch.md).

**Consumer overlays:** Consumers keep product-intent, filing-gate → quality-gates, baseline, and contextual Full overlay _prose_ in project-injected context — not in this portable file. See [council-dispatch.md](council-dispatch.md) § Overlays.

**Mandatory consumer overlay gate:** When skill-read injection provided consumer overlays, prefer that overlay set for Filing gate, product-intent, Baseline, or Contextual Full. This file's thinned portable sections are **not** sufficient when injected overlays exist — do not stop here.

## Review overlay (always — toolbox)

Include in the coordinator dispatch plan before spawning:

```
Mode: <mode>
Depth: <depth>  # after escalation / anti-thrash calibration per modes.md
Pass class: <first-baseline | closure-re-review | new-scope-review | fix-implementation>
Selected agents: <from agent-selection>
Diff source: <command from modes.md>
Mode overlay: "<overlay from modes.md>"
```

Append to each member Task `prompt`:

```
Review: [mode] at [depth] depth.

Diff:
<diff content>

Mode framing: <overlay from modes.md>

Apply your [agent-name] lens (map depth: Quick→quick, Standard→standard, Thorough→thorough, Full→full per agent file).
```

Synthesis → [synthesis.md](synthesis.md) then [output.md](output.md).

## Invariant overlay (Thorough+ and contextual re-review)

Append to the coordinator plan and every Thorough/Full member prompt, and to
every targeted contextual re-review member prompt:

```
Invariant review:
- State the behavioral invariant for each candidate before filing it.
- Derive the applicable input/contract rows from fix-loop-ledger.md § Invariant matrix.
- Inspect every affected contract surface, not only the reported example.
- Merge symptoms and edge variants under one root invariant.
- Ask: what sibling variants would fail if the current fix is too narrow?
  Return those under the same theme_id — do not invent adjacent sibling Action themes.
- Default filing remains merge-blockers only; the matrix broadens inspection, not filing.
```

For path, routing, source-rewrite, contract, state/persistence, or
auth/permission changes, include the matching portable matrix dimensions from
[fix-loop-ledger.md](fix-loop-ledger.md).

## Default filing overlay (portable optional)

When the consumer has **not** supplied a fuller Default filing overlay, append:

```
Default filing: merge-blockers only
- File ONLY scope: ship-blocker — reachable production bugs (wrong behavior, data loss, auth/security on path)
- Do NOT file: test inventory, docs gaps, refactor, architecture nits, UX polish, RFC gaps without reachable client break
- Council depth unchanged — still read whole diff; narrow what you FILE
- Improvements mode only if user said: include improvements, full audit, hardening pass, polish, test inventory, or exhaustive triggers
```

Prefer the injected consumer overlay set when skill read provided one.

## Pointer — consumer overlays

After the Review overlay (and portable Default filing if used), append **injected consumer overlays** when present:

- Arrives via skill-read customization / alwaysInclude injection
- Typically: Default filing (consumer wording), Filing gate, Product intent, Baseline checklist, Contextual Full re-review, path boosts, Needs confirmation

Do **not** hardcode consumer repo paths in this toolbox file.

## Contextual ledger overlay (pass 2+)

When prior Action findings exist — including when the coordinator **recovered**
the ledger from `REVIEW_LEDGER.md`, PR body, or git rather than the user
message — append to the coordinator plan and every member prompt in addition
to any consumer overlay. Record recovery source in the dispatch plan. Use the
matching depth lane:

```
Fix-loop: contextual re-review
Pass lane: <targeted contextual | Full contextual>
Ledger recovery source: <chat | REVIEW_LEDGER.md | PR body | git log>
Prior synthesis + ledger: <paste current stable-theme ledger>
Sweep plans: <paste Sweep · theme-id blocks>
Depth: <Standard|Quick|Full>; diff: whole branch + sweep surfaces

Reject sibling Action themes for adjacent variants — extend/reopen the existing theme_id.
If the same theme_id reopened on pass 2+, complete the same-invariant sweep before filing more Action blocks in that family.

Read the assigned scope independently, then reconcile every candidate:
1. Same theme, incomplete fix → reopen existing theme_id.
2. Same invariant, new variant → add evidence to the existing theme (prior closure incomplete).
3. Genuinely new invariant → create a theme_id and explain in one line why prior passes missed this blocker class.
4. No reachable production failure → Noted/Deferred under filing rules.

Reject fresh Action blocks for adjacent variants unless the root invariant differs.
For every theme marked closed or newly fixed, ask: what other variants of this
invariant would fail if this fix is too narrow? Check fix-loop-ledger.md
§ Same-invariant sweep, § Variant coverage before closure, and the applicable matrix rows.

Thrash signal: if 2+ blockers share a subsystem/theme family, stop filing symptoms and perform a holistic invariant audit under one theme_id.

Identify files/subsystems changed in 2+ fix passes and review those hotspots holistically.
Do not claim merge-ready or "final blockers" unless fix-loop-ledger.md § Exit gate passes.
```

Theme identity and closure state do not reset between passes. Targeted lane still
reconciles against prior-theme risk on the whole branch; Full lane revisits the
entire branch when promotion triggers match.
