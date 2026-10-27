# Skeleton operations

<!-- doc-meta: owner=eng -->

<!-- review-deps: paths=src/cli.ts,src/context.ts,src/init/init.ts,src/init/skills-args.ts,src/review/**,package.json#scripts,package.json#bin,package.json#engines,package.json#packageManager,package.json#name -->

The package provides `catalog`, `context`, `audit`, `validate`, `route`, `review`, `init`, and `build-plugin` for Skeleton-enabled repositories.

## Setup

```bash
npm install -D @csark0812/skeleton
npx skeleton init --skills
```

Init adds a bounded `skeleton context` guide to `AGENTS.md` and adds `.skeleton/catalog.md` to `.gitignore`. A `no-context` result includes a recovery action to inspect code, tests, and nearby docs; repair an existing owner or document durable behavior; and repeat the same request until it finds the owner. Read-only tasks report the gap without editing. `--skills` copies this skill from the installed package so its guidance matches the CLI version. Edit `skeleton.toml` scan trees for the repository shape. Legacy `.skeleton/config.yaml` loads only when `skeleton.toml` is absent.

For ordinary source tasks, context includes `test-command` when it can derive the repository-native focused runner, and the guide stops after that command passes. It does not ask the agent to run repository audits or validation unless the user requested them or the focused test fails. Before a pull request it tells agents to run `skeleton review prepare --base <base branch>` and stop on any human-review path.

## Documentation workflow

1. Add `<!-- source-of-truth: one-line summary -->` to canonical documents.
2. Add `review-deps` paths or globs where source changes can invalidate a paper.
3. Run `npx --no-install skeleton audit docs` or `validate changed`; local runs refresh `.skeleton/catalog.md`.
4. Use `npx --no-install skeleton catalog` only for a standalone catalog refresh.

Catalog honesty is enforced by `ssot-summary` and near-duplicate audits. `CI=true` skips catalog writes.

When a change touches a file a document declares in `review-deps`, re-read the document and update it in the same commit. Nothing records reviews:

- `validate changed --staged` (pre-commit) fails with `review-dependency-changed` when the dependency changed and the document did not;
- `validate changed --base` (pull request CI) and `review prepare` only warn and list the document.

A `package.json` release `version`, keys outside a `#key` selector, and doc-meta-only edits do not count. If the document is still correct, commit once without that hook (`SKIP=<hook id> git commit …`).

Bare `--fix` changes anchors and legacy SSOT markers; it never edits document prose.

## CLI

| Command | Purpose |
| ------- | ------- |
| `route` | Print the lane card. |
| `route <path>` | Classify a path and print its validation command. |
| `audit self` | Audit docs and config. Excluded skill trees still need `audit skills`. |
| `audit docs` | Audit SSOT, duplication, links, metadata, and dependencies. |
| `audit skills` | Audit owned skills. |
| `catalog [--check] [--strict]` | Write or check the generated catalog. |
| `context <query> \| --path <path> [--staged] [--max-chars=N]` | Read-only canonical-document, source-owner, and focused-test evidence. |
| `build-plugin [--check]` | Build or verify plugin `.mjs` siblings. |
| `validate changed [--staged] [--base <ref>]` | Validate changed paths and their owning papers. |
| `review prepare [--staged \| --base <ref>] [--json] [--run]` | Print a fresh-context review bundle; `--run` pipes it to `[review] command`. |

When `context` reports `changed-since-review`, it also prints an `action` line requiring the final document to be checked against the returned sources and every mismatch to be corrected before finishing.

Context emits review actions for a document with no declared `review-deps` (`unreviewed`), a declared source that changed in the working tree or index while the document did not (`changed-since-review`), and a document whose last commit is older than the configured cadence (`review-required`). Without declared sources, compare active implementation claims with source; historical alternatives and future aspirations remain qualified intent. `current` means the declared sources read as committed, not that the document agrees with them.

Each matching paper receives a share of the excerpt budget so one broad owner cannot consume it all. `omitted` and `omitted-source` list excluded papers and declared sources, with an action to narrow the query, increase `--max-chars`, or report the remaining evidence limit. Review status compares the full declared dependency set, including files removed from a glob, even when excerpts are omitted. Complete the relevant review and omission actions before treating the packet as sufficient evidence.

Consumer prevention also requires `review-deps` for active implementation claims and running `validate changed` on source changes. Use a scoped `[reviewCoverage]` policy to reject unowned paths where ownership is required. A doc-only hook or `include = []` leaves those source changes outside the ownership gate. Skeleton does not infer semantic conflicts from prose.

`audit --json` emits the schema in `schemas/result.schema.json`. `validate changed` remains plain text.

## Review before a PR

`review prepare` stdout is the whole reviewer prompt: contract, human-review paths, documents to re-read and update, matching `REVIEW.md` guides, `AGENTS.md` without its agent context guide, and the diff. Configure it in `skeleton.toml`:

```toml
[review]
humanPaths = [".github/workflows/**", "src/auth/**"]   # an agent review does not count here
command = "./scripts/review-agent.sh"                  # optional; reads the bundle on stdin
```

A finding line is `<severity>\t<file>:<line>\t<bug class>\t<what breaks>`, with severity `important`, `nit`, or `pre-existing`. Only `important` blocks the author. Enforce human approval for `humanPaths` with CODEOWNERS and branch protection.

## Skill ownership

Edit synced toolbox skills in their owning repository. Use this skill for Skeleton configuration, routing, audits, catalog maintenance, and document dependencies—not ordinary feature work that only reads another toolbox skill.

Human documentation: [getting started](https://github.com/csark0812/skeleton/blob/main/docs/developer/getting-started.md) · [config](https://github.com/csark0812/skeleton/blob/main/docs/developer/config.md) · [troubleshooting](https://github.com/csark0812/skeleton/blob/main/docs/developer/troubleshooting.md).
