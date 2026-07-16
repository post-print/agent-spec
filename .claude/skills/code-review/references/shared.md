# Shared: Base Branch and Diff

Used by code-review PR/merge modes. PR body generation is a separate authoring skill.

## Base branch

- From user message (e.g. "Base branch: development") or `main`
- If PR exists on current branch: `gh pr view --json baseRefName -q .baseRefName`

## Diff commands

Always run before review:

```bash
git fetch origin <base>
git diff --stat origin/<base>...HEAD
git diff origin/<base>...HEAD
```

For merge review: `git diff <base>...HEAD` on the integration branch.

## Prerequisites

- `gh` required when applying body to PR (`gh pr edit`); not needed for review-only or file output
