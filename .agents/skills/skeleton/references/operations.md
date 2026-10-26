# Skeleton operations

<!-- doc-meta: owner=eng -->

<!-- review-deps: paths=src/cli.ts,src/context.ts,src/init/init.ts,src/init/skills-args.ts,src/review/**,package.json -->

The package provides `catalog`, `context`, `audit`, `validate`, `route`, `review`, `init`, and `build-plugin` for Skeleton-enabled repositories.

## Setup

```bash
npm install -D @csark0812/skeleton
npx skeleton init --skills
```

Init adds a bounded `skeleton context` guide to `AGENTS.md`. A `no-context` result includes a recovery action to inspect code, tests, and nearby docs; repair an existing owner or document durable behavior; and repeat the same request until it finds the owner. Read-only tasks report the gap without editing. `--skills` copies this skill from the installed package so its guidance matches the CLI version. Edit `skeleton.toml` scan trees for the repository shape. Legacy `.skeleton/config.yaml` loads only when `skeleton.toml` is absent.

For ordinary source tasks, context includes `test-command` when it can derive the repository-native focused runner, and the guide stops after that command passes. It does not ask the agent to run repository audits, validation, or review-proof commands unless the user requested them or the focused test fails. Before a pull request it tells agents to run `skeleton review prepare --base <base branch>` and stop on any human-review path.

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

Attestation rewrites that document's line in `.skeleton/review-proof` and writes no date into the document. Commit that file with the change. Entries are one line each with a blank line between them, so parallel PRs that review different documents do not conflict. To upgrade from Skeleton 5 or 6 proof, to resolve a merge conflict in that file, or to move or drop entries for renamed or deleted documents, run `npx --no-install skeleton audit docs --fix=review-proof`; it never attests anything new.

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
| `review prepare [--staged \| --base <ref>] [--json] [--run]` | Print a fresh-context review bundle; `--run` pipes it to `[review] command`. |

When `context` reports `changed-since-review`, it also prints an `action` line requiring the final document to be checked against the returned sources and every mismatch to be corrected before finishing.

Context emits review actions for missing proof (`unreviewed`), dependency changes (`changed-since-review`), and a document edited after its review or a review older than the configured cadence (`review-required`). Missing proof requires comparing active implementation claims with source; historical alternatives and future aspirations remain qualified intent. A matching hash proves recorded bytes, not semantic agreement.

Each matching paper receives a share of the excerpt budget so one broad owner cannot consume it all. `omitted` and `omitted-source` list excluded papers and declared sources, with an action to narrow the query, increase `--max-chars`, or report the remaining evidence limit. Review status compares the full declared dependency set, including files removed from a glob, even when excerpts are omitted. Complete the relevant review and omission actions before treating the packet as sufficient evidence.

Consumer prevention also requires `review-deps` for active implementation claims and running `validate changed` on source changes. Use a scoped `[reviewCoverage]` policy to reject unowned paths where ownership is required. A doc-only hook or `include = []` leaves those source changes outside the ownership gate. Skeleton does not infer semantic conflicts from prose.

`audit --json` emits the schema in `schemas/result.schema.json`. `validate changed` remains plain text.

## Review before a PR

`review prepare` stdout is the whole reviewer prompt: contract, human-review paths, documents to re-read, matching `REVIEW.md` guides, `AGENTS.md`, and the diff. Configure it in `skeleton.toml`:

```toml
[review]
humanPaths = [".github/workflows/**", "src/auth/**"]   # an agent review does not count here
command = "./scripts/review-agent.sh"                  # optional; reads the bundle on stdin
```

A finding line is `<severity>\t<file>:<line>\t<bug class>\t<what breaks>`, with severity `important`, `nit`, or `pre-existing`. Only `important` blocks the author. Enforce human approval for `humanPaths` with CODEOWNERS and branch protection.

## Skill ownership

Edit synced toolbox skills in their owning repository. Use this skill for Skeleton configuration, routing, audits, catalog maintenance, and review proof—not ordinary feature work that only reads another toolbox skill.

Human documentation: [getting started](https://github.com/csark0812/skeleton/blob/main/docs/developer/getting-started.md) · [config](https://github.com/csark0812/skeleton/blob/main/docs/developer/config.md) · [troubleshooting](https://github.com/csark0812/skeleton/blob/main/docs/developer/troubleshooting.md).
