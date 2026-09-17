# Isolation

<!-- source-of-truth: fixture workspace ownership and judge evidence -->
<!-- doc-meta: owner=eng | last-reviewed=2026-09-16 -->
<!-- review-deps: paths=packages/harness/src/sealed-workspace.ts,packages/harness/src/user-skills.ts,packages/test/src/sdk/workspace.ts,packages/test/src/sdk/runtime.ts,packages/test/src/sdk/judge.ts -->

Every `agent.run` owns a sealed temporary Git workspace and host session. Independent runs may execute concurrently. Only `run.continue` shares the original task workspace and history.

A test owns all its runs and evaluations. Teardown aborts pending operations, waits for them to settle, and closes sessions and workspaces. POSIX workers terminate their process groups. Setup callbacks run before the host starts and remain test-owned code.

Workspace source paths resolve against the config directory. A fixture folder is copied; the default dot uses committed HEAD. Attached skills and context are supplied afterward. Global skills remain excluded unless explicitly enabled.

Observed tool paths outside the workspace are rejected. Snapshot copying rejects symlinks and excludes .git and node_modules. These checks complement host restrictions; they are not a universal sandbox for arbitrary adapter or setup code.

Judges receive a fresh read-only workspace containing their own explicit resources. No tested-agent workspace or transcript is copied automatically. The caller selects JSON input. Requests, responses, schema validation errors, and separate token usage are recorded as artifacts. See [the SDK guide](sdk-v2.md#explicit-judge-inputs).
