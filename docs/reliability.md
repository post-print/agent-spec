# Reliability

<!-- source-of-truth: offline checks and manual provider proof -->
<!-- doc-meta: owner=eng | last-reviewed=2026-09-16 -->
<!-- review-deps: paths=package.json,agent-suites/**/*.ts,.github/workflows/test.yml -->

Offline checks do not establish live provider reliability. Unit tests cover retained host capture/isolation and viewer behavior; SDK contracts use a fake adapter to prove fixtures, cleanup, comparisons, judging, and evidence validation.

```sh
bun run test:unit
bun run test:sdk:contracts
bun run test:sdk:consumer
bun run test:e2e
```

Provider-backed runs are manual and consume the configured host credentials:

```sh
bun run test:tour
bun run test:capabilities
bun run test:matrix
bun run test:reliability
```

The reliability command repeats the eleven TypeScript capability tests twenty times on Cursor, with no retries. It now requires every repetition to pass. This replaces the old JSON-specific 19-of-20 classifier/category calculation; there is no second scoring pipeline. The configured OpenAI reviewer also needs authentication.

Missing usage never becomes zero or a partial average. Agent and judge usage are reported separately. Token differences across providers do not imply equivalent cost. A few repeated runs are not statistical qualification.

The strict Biome policy remains a separate gate. Existing violations in retained host and viewer code must be resolved before the repository-wide lint gate can pass. Do not weaken the policy or treat passing runtime tests as lint proof.
