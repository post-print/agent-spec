---
name: skeleton
description: Agent ops manual for skeleton-enabled repos — init, catalog, audit, and toolbox skill ownership. Use when editing skeleton.toml / .skeleton/, syncing toolbox skills, or running skeleton CLI.
---

<!-- review-deps: paths=src/cli.ts -->

# Skeleton

<!-- source-of-truth: maintaining a skeleton-enabled repo -->

<!-- doc-meta: owner=eng | last-reviewed=2026-09-13 -->

Ops manual for `catalog`, `audit`, `validate`, and `init` in a skeleton-enabled repo.

## Agent doc routing (token-cheap)

1. Local `audit` / `validate` writes `.skeleton/catalog.md` (skipped when `CI=true`).
2. Skim the catalog (path + one-line summary).
3. For a candidate, read only the `source-of-truth` line / first ~20 lines.
4. Open the full paper only if that line is truly relevant.

Human docs: [getting started](https://github.com/csark0812/skeleton/blob/main/docs/developer/getting-started.md) · [config](https://github.com/csark0812/skeleton/blob/main/docs/developer/config.md) · [troubleshooting](https://github.com/csark0812/skeleton/blob/main/docs/developer/troubleshooting.md).

## When to use

- Edit `skeleton.toml` or `.skeleton/`
- Run `skeleton audit`, `skeleton validate`, or `skeleton catalog`
- Sync or update skills from an external toolbox repo
- Avoid editing synced toolbox skill copies in the consumer repo

Catalog honesty is enforced by `audit docs` (`ssot-summary` / near-dupe) — do not assume one-liners stay accurate without that gate.

Doc-meta: one authored `last-reviewed` (human claim). Git is last-edit — no parallel edit stamp. When hash review proof is enabled, `.skeleton/review-lock.json` binds that claim to the exact document and `review-deps` bytes. `daysUntilStale` remains an optional re-read cadence. Details: [doc system](https://github.com/csark0812/skeleton/blob/main/docs/developer/doc-system.md#doc-meta).

Not for: normal feature work that only reads toolbox skills.

## Layout

```
skeleton.toml           # preferred root config (scan, stale, docsLint)
.skeleton/
├── catalog.md          # generated, gitignored — local audit writes it
├── review-lock.json    # review hashes when reviewProof.mode = "hash"
└── plugins/            # optional audit plugins (.ts + .mjs)
```

Legacy `.skeleton/config.yaml` still loads if no `skeleton.toml` is present.

## Setup

```bash
npm install -D @csark0812/skeleton
npx skeleton init --skills
```

Edit `skeleton.toml` scan trees for this repo shape.

## Workflow

1. Add `<!-- source-of-truth: one-line summary -->` (or visible `source-of-truth: …`) to canonical docs
2. Run `skeleton audit docs` (or `validate changed`) so the local catalog is written
3. Add `review-deps` paths or globs where repository changes can invalidate the paper
4. Run `skeleton catalog` only when you want a refresh without an audit

After a complete human re-read, record review evidence for explicit paths only:

```bash
skeleton audit docs --paths=docs/example.md --fix=doc-meta --confirm-reviewed
```

Do not run this command as a mechanical date cleanup. Bare `--fix` changes anchors and legacy SSOT markers only.

## CLI

| Command                                        | Purpose                                                 |
| ---------------------------------------------- | ------------------------------------------------------- |
| `skeleton audit self`                          | Full docs + config audit (excluded skill trees still need `audit skills`) |
| `skeleton audit docs`                          | Doc audit (SSOT, near-dupe, links, doc-meta, …)         |
| `skeleton audit docs --fix`                    | Autofix anchors + legacy SSOT rewrite                   |
| `skeleton audit docs --paths=… --fix=doc-meta --confirm-reviewed` | Record a completed review for explicit documents |
| `skeleton audit skills`                        | Skill audit                                             |
| `skeleton catalog` / `catalog --check --strict` | Write / check the gitignored agent catalog              |
| `skeleton build-plugin [--check]`              | Build / verify plugin `.mjs` siblings                   |
| `skeleton validate changed`                    | Changed-file validation + dependency-driven doc discovery |
| `skeleton validate changed --staged`           | Pre-commit hook (index bytes + coverage + owning papers) |
| `skeleton validate changed --base origin/main` | CI / PR                                                 |

`register`, `customize`, and `hook` were removed. Add a source-of-truth marker and run `skeleton catalog`. Edit skills in the owning repo.

Plugins: [docs/developer/plugins.md](https://github.com/csark0812/skeleton/blob/main/docs/developer/plugins.md)

Machine consumers: `audit --json` emits one versioned result document. Validate it with the exported `schemas/result.schema.json`; use `@csark0812/skeleton/result-types` for TypeScript. `validate changed` is plain text only, with affected documents, matching dependencies, native gates, and a final pass/fail line.
