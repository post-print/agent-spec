---
name: skeleton
description: Use Skeleton to find canonical repository context for questions or source changes, to prepare a code review before a pull request, or to perform setup, configuration, auditing, review proof, and skill ownership.
---

# Skeleton

<!-- source-of-truth: maintaining a skeleton-enabled repo -->

<!-- doc-meta: owner=eng -->

## Repository context

Make `npx --no-install skeleton context "<topic>"` the first repository command. Use `--path` only for a known implementation path and `--staged` for staged-code questions. Returned document, source, and test excerpts are already read; do not read those files again unless an action requires a complete review. Complete every `action` line and verify it against the final files. Preserve existing work. If a test is returned, edit and run only that test. Otherwise use one combined command to find and read the focused test. Stop when it passes. Do not run Skeleton audits, validation, or review-proof commands unless the user requested them, the focused test fails, or you are preparing a pull request (see below). Broader discovery or another context command is reserved for `no-context`, review gaps, omitted evidence, or a failing focused test.

A packet with review actions or omitted evidence is incomplete. Resolve the relevant gap before relying on active implementation claims. Preserve historical alternatives and future aspirations as qualified intent. A matching hash proves recorded bytes, not semantic agreement; source changes need declared `review-deps` and source-triggered validation in the consumer.

## Source implementation work

For source work, use the returned source excerpt to identify the implementation seam, then locate the nearest focused test with a targeted search. Preserve existing work, make one consistent source/test/document change, then run the focused test after the final edit. Do not replace that final test with a broad audit or an intermediate completion claim.

Do not run Skeleton commands just because Skeleton is installed. They are not a substitute for the focused test.

## Before a pull request

When you are about to open a pull request, or the user asks for a review, run `npx --no-install skeleton review prepare --base <base branch>`. Then:

1. Re-read each listed document whose review proof no longer matches, fix it, and attest it with `npx --no-install skeleton audit docs --paths=<doc> --fix=doc-meta --confirm-reviewed`.
2. If the output names human-review paths, stop and tell the user which paths need a person. Do not attest or approve them yourself.
3. Get a review with fresh context: use `--run` when `[review] command` is set; otherwise give the printed bundle to a new session or subagent. Fix every `important` finding. Resolve the others with a one-line reason.
4. Run at most three review cycles. After the first, review only the new diff (`--base <last reviewed commit>`). Fix a named bug class everywhere it occurs. Do not re-report resolved findings. After three cycles, stop and ask the user to re-evaluate the approach.

## Skeleton operations

For setup, configuration, auditing, review proof, CLI details, or skill ownership, read [references/operations.md](references/operations.md). For a change to Skeleton configuration, run `npx --no-install skeleton route <path>` and then its printed validation command.
