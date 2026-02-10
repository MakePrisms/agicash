---
name: reflect
description: End-of-conversation review to capture learnings. Use when the user runs /reflect to review what happened and suggest improvements to CLAUDE.md, skills, or new skills.
disable-model-invocation: true
---

# Reflect

Review the current conversation and suggest high-ROI improvements. Keep suggestions brief and actionable.

## What to Look For

1. **CLAUDE.md updates** — Did you make a mistake that better guidance would prevent? Did the user correct you on a pattern or preference? Did you learn something about the codebase that would save time next session? Did anything in the conversation contradict or conflict with existing CLAUDE.md guidance (stale rules, outdated patterns, wrong assumptions)?

2. **Wallet documentation sync** — Did the conversation change any behavior documented in the `agicash-wallet-documentation` skill? Read its SKILL.md to understand what it covers, then selectively check only the reference files relevant to the changes made. Suggest edits if anything is now out of date.

3. **Skill improvements** — Did you use a skill that gave bad advice, was missing context, or had an awkward workflow? Would small edits make it more effective?

4. **New skills** — Did the conversation involve a repeatable workflow that would benefit from a skill? Only suggest if it came up naturally and seems like it would be used again.

## Workflow

1. Review the conversation history
2. For each category above, note anything worth capturing
3. For wallet documentation sync: read the SKILL.md overview, then only read references that overlap with the changes made in this conversation (e.g., if you changed the send flow, read `cashu-lightning-send.md` — don't read `spark-operations.md`)
4. Present a short numbered list of suggestions with a one-line rationale each
5. Ask the user which (if any) they want to act on
6. Based on their response, invoke the appropriate skill (`/update-context`, `/skill-creator`, or edit the skill/documentation directly)

## Guidelines

- Suggest 1-3 items max. If nothing is worth capturing, say so.
- Prefer updating existing context over creating new things
- Don't suggest things already covered in CLAUDE.md
- Be specific: "Add to CLAUDE.md that X" not "Maybe update docs"
