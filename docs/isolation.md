# Isolation

<!-- source-of-truth: fixture workspace ownership and judge evidence -->
<!-- doc-meta: owner=eng | last-reviewed=2026-09-16 -->
<!-- review-deps: paths=packages/harness/src/sealed-workspace.ts,packages/harness/src/user-skills.ts,packages/test/src/sdk/workspace.ts,packages/test/src/sdk/runtime.ts,packages/test/src/sdk/judge.ts -->

Each test fixture owns a sealed temporary Git workspace. Comparison repetitions each get a fresh fixture; successive `agent.run()` calls within one fixture share its workspace and conversation.

`workspace` is a folder relative to the configuration directory. A subfolder copies that fixture. The default `.` copies committed HEAD. The SDK supplies attached skills and explicit context after preparing the workspace. Global skills are excluded unless `includeGlobalSkills: true` is set.

The runner rejects observed tool paths outside the workspace. `workspace.readFile()` checks lexical and real paths. Snapshot copying rejects symbolic links and excludes `.git` and `node_modules`. These checks complement the native host sandbox; they are not a universal sandbox for arbitrary custom adapter code.

Each run preserves initial/final snapshots, changes, observable transcript, tool calls, usage, and supplied starting context in the test output directory. Fixtures are cleaned up on completion or failure; session cancellation terminates the worker process group on POSIX systems.

Each judge receives separate evidence copies. Reference-only material is supplied to the judge, not the tested agent. Requests and responses are saved; evidence references must point into supplied files, transcript events, or references. Judge usage is separate from agent usage. See [the SDK guide](sdk-v2.md#what-judging-means).

Use ordinary fixture setup for seed changes before the first agent run. There is no in-place execution flag or legacy scenario retry loop.
