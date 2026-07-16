---
name: skeleton
description: Agent ops manual for skeleton-enabled repos — init, register, audit, customize hooks, and toolbox skill overrides. Use when editing .skeleton/, syncing toolbox skills, or running skeleton CLI.
---

# Skeleton

**Source of truth for** maintaining a skeleton-enabled repo.

<!-- doc-meta: owner=eng | last-reviewed=2026-07-15 -->

Before project-specific routing: read `<repo-root>/.skeleton/registry.md` and follow links. If the project has a consumer harness playbook (commonly `docs/developer/agent-harness.md`), read it for skill sync perimeter and migration phase.

Human docs: [getting started](https://github.com/csark0812/skeleton/blob/main/docs/developer/getting-started.md) · [config](https://github.com/csark0812/skeleton/blob/main/docs/developer/config.md) · [troubleshooting](https://github.com/csark0812/skeleton/blob/main/docs/developer/troubleshooting.md).

## When to use

- Edit `.skeleton/customize/<slug>.md` (project bindings for toolbox skills)
- Run `skeleton audit`, `skeleton validate`, or `skeleton register`
- Sync or update skills from an external toolbox repo
- Avoid editing synced toolbox skill copies in the consumer repo

Not for: normal feature work that only reads toolbox skills (customize injects automatically on skill reads via hooks, including skill-tree / references Reads).

## Layout

```
.skeleton/
├── config.yaml       # audit scan perimeter
├── registry.md       # topic index → canonical files
├── plugins/          # optional audit plugins (.ts + .mjs)
└── customize/        # per-slug overrides for toolbox-bound skills
    └── <slug>.md
```

## Customize hooks

`skeleton init` merges IDE hooks that run a cwd-local
`node node_modules/@csark0812/skeleton/dist/cli.js hook customize` on skill reads
(Cursor `Read`, Claude `Read`/`Skill`, Codex `read_file`). Inside this repo the
hook runs `bun src/cli.ts hook customize`.

- Hook injects `.skeleton/customize/<slug>.md` when path is `/SKILL.md` **or** under a skill tree (`.claude/skills/<slug>/**`, `.agents/skills/<slug>/**`, or flat `<slug>/references/**`); Grep/shell still skip
- **Never edit synced toolbox `SKILL.md` files in the consumer repo** — override in `.skeleton/customize/<slug>.md`
- Project-specific dispatch overlays (e.g. product-intent council prompts) belong in customize, not in toolbox skill trees

Manual resolve:

```bash
skeleton customize resolve <slug>
```

Register customize files:

```bash
skeleton register .skeleton/customize/<slug>.md
```

Details: [docs/developer/customize.md](https://github.com/csark0812/skeleton/blob/main/docs/developer/customize.md)

## Setup

```bash
npm install -D @csark0812/skeleton
npx skeleton init --skills
```

`--skills` installs this skill and wires hooks. Append [skills add flags](https://github.com/vercel-labs/skills) after `--skills` (e.g. `-g`, `--all`, `-a codex`, `--copy`).

Edit `.skeleton/config.yaml` scan trees for this repo shape.

## Workflow

1. Write canonical files with a `**Source of truth for** …` banner
2. Run `skeleton register <path>`
3. Run `skeleton audit self`

## CLI

| Command                                        | Purpose                                                 |
| ---------------------------------------------- | ------------------------------------------------------- |
| `skeleton audit self`                          | SSOT / harness audit (`.skeleton/**` + registered docs) |
| `skeleton audit docs`                          | Doc audit (configured scan perimeter)                   |
| `skeleton audit docs --fix`                    | Autofix doc-meta + anchors, then re-audit               |
| `skeleton audit skills`                        | Skill audit                                             |
| `skeleton build-plugin [--check]`              | Build / verify plugin `.mjs` siblings                   |
| `skeleton validate changed`                    | Changed-file validation                                 |
| `skeleton validate changed --staged`           | Pre-commit                                              |
| `skeleton validate changed --base origin/main` | CI / PR                                                 |
| `skeleton references sync`                     | Materialize shared references into skills               |
| `skeleton references check`                    | Verify generated references match sources               |
| `skeleton customize resolve <slug>`            | Print merged customize for a skill slug                 |
| `skeleton register <path>`                     | Register a canonical file in registry                   |

Plugins: [docs/developer/plugins.md](https://github.com/csark0812/skeleton/blob/main/docs/developer/plugins.md)

Framework docs: [getting started](https://github.com/csark0812/skeleton/blob/main/docs/developer/getting-started.md) · [install](https://github.com/csark0812/skeleton/blob/main/docs/developer/install.md) · [validation](https://github.com/csark0812/skeleton/blob/main/docs/developer/validation.md)
