# Layered agent-test showcase

<!-- source-of-truth: decisions for the layered showcase -->

<!-- doc-meta: owner=eng | last-reviewed=2026-09-15 -->

<!-- review-deps: paths=agent-suites/**/scenarios.json,package.json,packages/test/src/types.ts,packages/test/src/compare-scenario.ts,scripts/test-sdk-*.mjs,scripts/test-reliability.mjs -->

Status: implemented.

## Goal

Replace the old examples with tests that teach the product and define the public contract, while keeping provider-backed execution manual.

```mermaid
flowchart LR
  Task["Same task"] --> Control["Control arm"]
  Task --> Experiment["Experiment arm"]
  Control --> Result["Separate results"]
  Experiment --> Result
  Result --> Gates["Declared gates"]
```

## Decisions

- `tour` is a seven-scenario product tour.
- `test-sdk-capabilities` is an eleven-scenario manual live check of supported
  `runAgentTest` behavior.
- Configuration mechanics live in the suite authoring guide and internal test
  fixtures, not in a runnable peer suite.
- Each scenario starts in a new sealed workspace.
- Most scenarios use one small TypeScript task-list project.
- Skill tests use a separate copy so the skill cannot affect other tests.
- Test names, prompts, descriptions, questions, and failures use Simple English.
- Capability, tour, host-matrix, and 20-run qualification runs are manual.
- CI runs offline product checks and never launches a provider-backed host.

## Comparison contract

A comparison keeps a separate outcome and measurements for each arm. Gates can check outcome, turns, tokens, tools, duration, or one per-arm judge question. Numeric pair gates require the named winner to use less. Outcome and judge pair gates require the winner to pass and the loser to fail. Every declared gate must pass. A tie or missing value fails a strict gate. Metrics with no gate remain information. Reports do not invent one overall winner.

The old `compare.faster` and `compare.cheaper` fields are removed. Configuration checks reject them and show the gate migration.

## Test layers

The product tour covers project facts, diagnosis, repair, MCP, skills, three MCP workflows, and a control-versus-tool experiment.

The suite authoring guide and internal fixtures cover defaults, overrides, validation, CLI behavior, viewer behavior, cancellation, persistence, routing, and review-depth conventions without provider usage.

The manual capability suite covers reply scoring, forbidden tools, file reads, writes and commands, ordered MCP calls, provided context, seed patches, sealed workspaces, supplied skills, judge scoring, and comparison gates.

SDK coverage packs both packages, installs them in a clean Node 22 project, compiles public imports, runs a fake adapter, inspects comparison results, and runs the installed CLI. A separate manual smoke calls the direct API on Cursor, Claude, and Codex.

The reliability command runs deterministic good and bad controls, then runs the Cursor capability suite 20 times. Each scenario needs at least 19 clean behavior runs and 19 clean infrastructure runs. The judge needs at least 19 passes. Any workspace leak, recording error, or judge-format error fails the qualification.

## Verification

- All suite files must pass `agent-test --check`.
- Unit tests must cover every gate form in pass and fail cases.
- Console, viewer, HTML, and debug output must show arm outcomes and gates.
- The installed package test must need no host credentials.
- CI product checks remain offline.
- The capability suite, host matrix, and 20-run qualification remain manual proofs.
