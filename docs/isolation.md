# Isolation

<!-- source-of-truth: sealed workspace isolation and debug evidence -->

<!-- doc-meta: owner=eng | last-reviewed=2026-09-14 -->

<!-- review-deps: paths=packages/harness/src/sealed-workspace.ts,packages/harness/src/context.ts,packages/harness/src/user-skills.ts,packages/harness/src/cursor-run.ts,packages/test/src/live-isolation.ts,packages/test/src/debug-bundle.ts,packages/test/src/viewer/events.ts -->

A **sealed workspace** is a temp git repo that the host must not leave. The runner fails the scenario when a tool path leaves that folder. A leftover caller-tree check still restores leaked caller edits.

## Workspace copy

`createSealedWorkspace` builds the temp folder, then runs `git init` so git does not walk to the caller repo.

| `workspace` value | Copy |
| --- | --- |
| Omit, empty, or `"."` | `git archive HEAD` plus caller context overlays |
| Subfolder | That folder only. Parent HEAD files stay out |

Overlays on a HEAD copy include `AGENTS.md`, `CLAUDE.md`, `.cursor/rules`, `skeleton.toml`, `.skeleton/registry.md`, `.skeleton/config.yaml`, `.skeleton/customize`, and project skill trees.

A subfolder path must stay repo-relative. It must not contain `..`.

In-repo suites set `workspace` on every scenario. Treat that folder as a fixture.

## Skills

Hosts load project skills from `.agents/skills`, `.cursor/skills`, `.codex/skills`, and `.claude/skills` inside the sealed folder.

The `skills` field only overlays extra repo-relative folders that are not already in that repo. `"none"` adds no extra overlay.

Host-global user skills stay out unless `allowUserSkills` is true. Those trees live under `~/.cursor/skills-cursor`, `~/.cursor/skills`, `~/.claude/skills`, `~/.codex/skills`, and `~/.agents/skills`. Keep `allowUserSkills` false for a custom workspace fixture.

The deny path uses Cursor `settingSources: ["project"]` plus a temp `HOME` with no skill trees. That temp home copies `~/.cursor/sdk` so subscription login still works. Claude uses `--setting-sources project` or `--bare`. Codex uses `--ignore-user-config`. Cursor still indexes user skills from `os.homedir()` when `settingSources` omits `user`. The harness then points `HOME` at an empty tree for that Node process.

## Context

`loadContext` builds a preamble from profile sources. Profiles are `shared`, `cursor`, `claude`, and `skeleton`.

`contextSources` adds files after the profile sources. When `workspace` is a subfolder, a bare name is a file in that workspace root.

The `skeleton` profile loads `skeleton.toml` when present. It falls back to `.skeleton/config.yaml` and legacy `customize.alwaysInclude` only when the TOML file is absent.

## In-place runs

`--no-worktree` runs in the caller checkout. Set `AGENT_TEST_ALLOW_IN_PLACE=1`. Agent edits persist in your working tree. Prefer the sealed default.

`Ctrl+C` cancels host work and deletes the sealed temp folder.

## Debug evidence

`--debug` writes a bundle under `$TMPDIR/agent-spec/sessions/<id>/` by default. Use `--debug-dir` to override the parent directory. Keep that path outside the git repo.

The bundle holds the transcript, trace, environment snapshot, and a rerun command.

Isolated children inherit `--host`, `--adapter`, and `--auth-mode` from the parent.

Host SDK INFO lines stay hidden. Set `AGENT_TEST_HOST_LOGS=1` or `--debug` to print them.

A TTY run prints `agent started`, then updates an `agent` clock every 0.1s. Tool names and a short reply preview print as the host streams them. The HTML report line is a localhost link.

`agent-test viewer` can attach a pipe on fd 3. Isolated children write one JSON event per line. The viewer page shows the chat as the host streams it.

## Isolation target

Zero tool paths outside the sealed temp workspace. See [reliability.md](reliability.md). A `worktree_leak` fails `--fail-on=behavior`.
