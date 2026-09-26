# Skeleton operations

<!-- doc-meta: owner=eng | last-reviewed=2026-09-26 -->

<!-- review-deps: paths=src/cli.ts,src/context.ts,src/init/init.ts,src/init/skills-args.ts,package.json -->

The package provides `catalog`, `context`, `audit`, `validate`, `route`, `init`, and `build-plugin` for Skeleton-enabled repositories.

## Setup

```bash
npm install -D @csark0812/skeleton
npx skeleton init --skills
```

Init adds a bounded `skeleton context` guide to `AGENTS.md`. A `no-context` result includes a recovery action to inspect code, tests, and nearby docs; repair an existing owner or document durable behavior; and repeat the same request until it finds the owner. Read-only tasks report the gap without editing. `--skills` copies this skill from the installed package so its guidance matches the CLI version. Edit `skeleton.toml` scan trees for the repository shape. Legacy `.skeleton/config.yaml` loads only when `skeleton.toml` is absent.

For ordinary source tasks, context includes `test-command` when it can derive the repository-native focused runner, and the guide stops after that command passes. It does not ask the agent to run repository audits, validation, or review-proof commands unless the user requested them or the focused test fails.

## Documentation workflow

1. Add `<!-- source-of-truth: one-line summary -->` to canonical documents.
2. Add `review-deps` paths or globs where source changes can invalidate a paper.
3. Run `npx --no-install skeleton audit docs` or `validate changed`; local runs refresh `.skeleton/catalog.md`.
4. Use `npx --no-install skeleton catalog` only for a standalone catalog refresh.

Catalog honesty is enforced by `ssot-summary` and near-duplicate audits. `CI=true` skips catalog writes.

After a complete human re-read, record review evidence for explicit paths only:

```bash
npx --no-install skeleton audit docs --paths=docs/example.md --fix=doc-meta --confirm-reviewed
```

Bare `--fix` changes anchors and legacy SSOT markers; it does not attest review.

## CLI

| Command | Purpose |
| ------- | ------- |
| `route` | Print the lane card. |
| `route <path>` | Classify a path and print its validation command. |
| `audit self` | Audit docs and config. Excluded skill trees still need `audit skills`. |
| `audit docs` | Audit SSOT, duplication, links, metadata, dependencies, and review proof. |
| `audit skills` | Audit owned skills. |
| `catalog [--check] [--strict]` | Write or check the generated catalog. |
| `context <query> \| --path <path> [--staged] [--max-chars=N]` | Read-only canonical-document, source-owner, and focused-test evidence. |
| `build-plugin [--check]` | Build or verify plugin `.mjs` siblings. |
| `validate changed [--staged] [--base <ref>]` | Validate changed paths and their owning papers. |

When `context` reports `changed-since-review`, it also prints an `action` line requiring the final document to be checked against the returned sources and every mismatch to be corrected before finishing.

`audit --json` emits the schema in `schemas/result.schema.json`. `validate changed` remains plain text.

## Skill ownership

Edit synced toolbox skills in their owning repository. Use this skill for Skeleton configuration, routing, audits, catalog maintenance, and review proof—not ordinary feature work that only reads another toolbox skill.

Human documentation: [getting started](https://github.com/csark0812/skeleton/blob/main/docs/developer/getting-started.md) · [config](https://github.com/csark0812/skeleton/blob/main/docs/developer/config.md) · [troubleshooting](https://github.com/csark0812/skeleton/blob/main/docs/developer/troubleshooting.md).
