# Address PR Feedback

Addresses inline review comments on the current branch's PR with human oversight.

## Usage

```
/address-pr-feedback [PR number]
```

If no PR number provided, uses the PR for the current branch.

## Workflow

### Phase 1: Fetch & Filter

1. **Fetch comments** via `gh api repos/{owner}/{repo}/pulls/{pr}/comments`
2. **Filter out**:
   - Comments from the PR author (these are explanations, not feedback)
   - Replies in threads where feedback was already addressed
   - Comments that are just acknowledgments ("sounds good", "thanks")
3. **Group threaded comments** - understand the full conversation before categorizing

### Phase 2: Analyze & Present

Categorize each piece of feedback:
- **Fix**: Clear request for a code change
- **Suggestion**: Reviewer proposing an alternative approach (phrased as question but implies change)
- **Clarification**: Genuine question needing explanation only

For each item, use subagents liberally to investigate code in parallel when deeper analysis is needed.

Present a summary:

```
## PR Feedback Summary

### Fixes Needed (X items)
1. [file:line] - What reviewer wants
   **Proposed change:** <specific change to make>

### Suggestions (Y items)
1. [file:line] - Reviewer's suggestion
   **Analysis:** <investigation of whether suggestion improves the code>
   **Recommendation:** <adopt/reject with reasoning>

### Clarifications (Z items)
1. [file:line] - Reviewer's question
   **Answer:** <explanation based on code analysis>
   **Action:** Reply to reviewer / Add code comment / No action needed

## Proposed Plan
[Numbered list of all changes, combining fixes and adopted suggestions]

Waiting for your approval. Let me know which items to proceed with.
```

### Phase 3: Implement (after approval)

1. Make approved changes
2. Run `bun run fix:all`
3. Show summary of changes made
4. **Do NOT commit or push** - user reviews and decides

## Complexity Assessment

Before presenting the plan, assess the overall complexity:

**Simple (single commit):**
- Feedback is focused on the same area of code
- Changes are straightforward fixes or small improvements
- No architectural decisions needed

**Medium (multiple commits):**
- Feedback touches unrelated areas
- Some changes are independent and reviewable separately
- Recommend grouping into logical commits (e.g., "refactor scanner lifecycle" + "improve error handling")

**Large change required for merge:**
When feedback requires significant changes before the PR can be merged:
- Recommend opening a stacked PR (new PR targeting the current branch)
- Current PR stays open until the stacked PR is reviewed and merged into it
- This keeps changes reviewable in digestible chunks

```
⚠️ **Large Change Needed**

This feedback requires [significant change]. Recommend:
1. Open a new PR targeting this branch for [change description]
2. Get that reviewed and merged into this branch
3. Then this PR can be re-reviewed and merged to master

This keeps each review focused and high quality.
```

**Out of scope:**
When feedback suggests improvements unrelated to the PR's purpose:
- Note it as out of scope
- Recommend a separate follow-up PR after this one merges
- Don't block the current PR on unrelated work

## Analysis Guidelines

**Suggestions disguised as questions:**
Questions like "I wonder if..." or "maybe we should..." are often suggestions. Investigate the alternative approach and recommend whether to adopt it.

**Unreachable code:**
If feedback questions whether code is needed, investigate if the code path is actually reachable. If unreachable, recommend either:
- Removing it entirely, or
- Replacing with a defensive error (`throw new Error("Unexpected state: ...")`)

**Use subagents for investigation:**
When analysis requires reading multiple files or tracing code paths, spawn exploration subagents in parallel with other work.

## Human Control Points

- User approves the plan before any changes are made
- User can modify, skip, or add to proposed changes
- User handles commit and push
- For ambiguous feedback where multiple approaches are valid, present options rather than picking one

## Notes

- Never auto-commit or push
- Flag feedback that conflicts with CLAUDE.md patterns
- Batch all changes, run fix:all once at the end
- Explain the reasoning behind each proposed change
