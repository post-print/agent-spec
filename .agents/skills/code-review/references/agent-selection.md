# Agent Selection (Review)

Discover council agents, score against the diff, and select members within a depth budget. **Review profile only.**

Mechanical discovery → [multi agent-discovery.md](../../multi/references/agent-discovery.md). Orchestration kernel → [`multi`](../../multi/SKILL.md).

## Input

| Field          | Source                                                       |
| -------------- | ------------------------------------------------------------ |
| Profile        | `review` (always for this doc)                               |
| Scoring inputs | diff paths, diff keywords, `depth` from [modes.md](modes.md) |
| Budget         | depth table (below)                                          |
| Paths          | diff stat / `git diff --name-only` / explicit diff file list |
| Text           | diff body for keyword scoring                                |

## Depth order and budget

Depth ranks: `quick` < `standard` < `thorough` < `full`.

| Depth    | Member budget | Notes                                           |
| -------- | ------------- | ----------------------------------------------- |
| Quick    | 1             | Targeted single-theme hotspot only              |
| Standard | 2             | Default for targeted contextual re-review       |
| Thorough | 4             | Default first `pr` / `merge`                    |
| Full     | 5             | Escalated baseline or Full contextual re-review |

Budget expands to fit all **required** agents (never drop a required member to save slots).

**Spawn count = |SELECTED|.** Every SELECTED agent gets one Task/Subagent call ([council-dispatch.md](council-dispatch.md)). Budget and optional-slot omits change who is SELECTED — they never authorize zero-member solo synthesis. Targeted contextual re-review calibrates to Quick/Standard; it does not waive spawn.

## Selection algorithm

Run [agent-discovery](../../multi/references/agent-discovery.md) steps 1–2, then:

```
3. PROFILE ← review
4. AVAILABLE ← agents where PROFILE ∈ dispatch.contexts (default [review])
5. PATHS ← diff paths
6. TEXT ← diff body
7. REQUIRED ← agents where:
     depth ≥ dispatch.depth.required_from
     OR (dispatch.path_trigger AND path/keyword match AND depth ∈ dispatch.depth.eligible)
8. BUDGET ← max(depth_budget[depth], |REQUIRED|)
9. SCORE optional agents (eligible, not in REQUIRED, context includes review):
     +50 per path prefix match on PATHS
     +50 per path_glob match
     +20 per keyword match in TEXT
     + dispatch.priority (tie-breaker)
10. SELECTED ← REQUIRED ∪ top_scored(optional, BUDGET − |REQUIRED|)
11. If SELECTED empty → fallback: host built-in subagent_type + slice in Task prompt
```

Path/keyword matching and model tier → [agent-discovery.md](../../multi/references/agent-discovery.md).

**Quick + path-triggered `api` only** → Fast tier is acceptable.

## Availability log

Include in dispatch plan per [agent-discovery § Availability log](../../multi/references/agent-discovery.md#availability-log-required-in-dispatch-plan) with `Profile: review` and `Depth` filled in.

## Integration

Review workflow supplies `depth` (from mode default + [escalation rules](modes.md)). No static depth→agent table.

Task prompts → [task-prompt-review.md](task-prompt-review.md). Synthesis → [synthesis.md](synthesis.md) → [output.md](output.md).

Dispatch walkthrough → [council-dispatch.md](council-dispatch.md).
