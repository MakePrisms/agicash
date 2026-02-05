---
name: update-context
description: You are the expert maintainer of this project's CLAUDE.md — the persistent, high-value context file that prevents stale assumptions and context pollution. Use when (1) running `/update-context` command for full analysis, (2) user asks to "update CLAUDE.md" with specific information, (3) user wants to add/remove/modify project context, or (4) after significant codebase changes that affect patterns or conventions.
---

# Update Context Skill

Maintain CLAUDE.md as an evolving knowledge base that captures learnings and prevents repeated mistakes.

## Core Philosophy

**CLAUDE.md is a living document that makes Claude smarter over time.** Each line should save hours of future mistakes. The goal isn't minimal size—it's maximum learning retention.

### Guiding Principles

1. **Learn > Forget** - Capture every hard-won lesson before it's lost
2. **Why > What** - Every rule needs context: "Learned from: [session/date/issue]"
3. **Consolidate > Duplicate** - Merge similar rules, don't add redundant ones
4. **Specific > Vague** - "Use 2-space indentation" beats "Format code properly"
5. **Test > Assume** - Rules should be verifiable, not abstract preferences

## Update Modes

### Mode 1: Post-Correction Reflex (Most Important!)

**Trigger**: After any fix, correction, or "aha" moment in the conversation.

This is the #1 habit for improving Claude's effectiveness. When you catch yourself making a mistake or learning something new:

1. **Analyze what went wrong** - What was the root cause? What did we miss?
2. **Draft a prevention rule** - Write a specific, testable rule (under 3 lines)
3. **Add "Learned from" context** - Include date and brief description of the incident
4. **Check for duplicates** - Search CLAUDE.md for existing related rules
5. **Consolidate or add** - Either strengthen an existing rule or add a new one
6. **Propose the change** - Show the exact edit and wait for approval

Example format:
```markdown
## Common Pitfalls & How to Avoid Them

- **Don't use `useEffect` for data fetching** — Use TanStack Query instead. Learned from: 2026-01-15, spent 30 min debugging stale closure issues.
```

### Mode 2: Full Reflection Analysis (via /update-context)

When triggered by the command, perform a comprehensive review:

1. **Review conversation history first**
   - Summarize key corrections, learnings, and patterns from recent sessions
   - Identify rules that were violated or needed but missing
   - Note any repeated mistakes that indicate missing documentation

2. **Read current CLAUDE.md** in full

3. **Analyze git history** to understand codebase evolution:
   ```bash
   # Find last CLAUDE.md update commit
   git log -1 --format="%H %ci" -- CLAUDE.md

   # Summarize changes since then
   git diff <commit>..HEAD --stat -- . ':!CLAUDE.md' ':!docs/' ':!tests/' ':!*.test.*' ':!*.spec.*'
   ```

4. **Identify improvements** in these categories:
   - **Rules to add**: Lessons learned that aren't yet captured
   - **Rules to strengthen**: Vague rules that need specific examples
   - **Rules to consolidate**: Duplicate or overlapping guidance
   - **Rules to remove**: Genuinely stale content (not just old)
   - **"Learned from" gaps**: Rules missing their origin context

5. **Output reflection report**:
   ```
   ## Reflection Report — [Date]

   ### Conversation Insights
   - [Key learnings from recent sessions]

   ### Codebase Changes Since Last Update
   - [Brief summary of meaningful changes]

   ### Proposed Updates

   #### Add (with "Learned from" context)
   - [Rule]: [Why/When learned]

   #### Strengthen/Clarify
   - [Before] → [After]

   #### Consolidate
   - [Rules being merged] → [New unified rule]

   #### Remove (with reason)
   - [Rule]: [Why it's stale]

   ### Health Check
   - Estimated token count: ~XXX
   - Last updated: [Date]
   - Staleness risk: [Low/Medium/High]
   ```

6. **Wait for approval** before making changes

### Mode 3: Targeted Update (ad-hoc requests)

When user asks to add/update specific content:

1. **Read current CLAUDE.md** to understand structure
2. **Research the topic** in the codebase
3. **Search for existing coverage** — can we strengthen an existing rule?
4. **Draft the addition** with "Learned from" context if applicable
5. **Validate**: Is this specific and testable? Will it prevent future mistakes?
6. **Propose the edit** with exact location and diff
7. **Apply after confirmation**

## Context Evolution Rules

Add this section to every CLAUDE.md you maintain:

```markdown
## Context Evolution Rules

- When adding rules, ALWAYS include "Learned from: [date/session/issue]" context
- Before adding a new rule, search for existing related rules to consolidate
- Rules must be specific and testable (bad: "write clean code", good: "use Money class for all arithmetic")
- Review and update after major refactors or repeated mistakes
- Prefer strengthening existing rules over adding new ones
```

## Preventing Common Pitfalls

| Pitfall | Prevention Strategy |
|---------|---------------------|
| **Stale context** | Every rule needs "Learned from" with date; review quarterly |
| **Vague rules** | Must be specific enough to test (use examples) |
| **Forgetting why** | Always include the incident/session that taught us |
| **Duplicate rules** | Search before adding; consolidate when found |
| **Missing learnings** | Use post-correction reflex religiously |
| **Bloat** | Use `.claude/rules/*.md` for topic-specific deep dives |

## Recommended CLAUDE.md Structure

```markdown
# CLAUDE.md

## Overview
[1-2 sentences about the project]

## Tech Stack
[Table format]

## File Structure
[Tree view, ~10 lines max]

## Key Patterns
[Project-specific patterns that differ from defaults]

## Common Pitfalls & How to Avoid Them
[The gold — every hard-won lesson with "Learned from" context]

## Context Evolution Rules
[Meta-rules for maintaining this file]

## Commands
[Common commands table]

## Skills
[Links to available skills for deep dives]

<!-- Last updated: YYYY-MM-DD -->
```

## Reference Materials

For content standards and style guidelines, see [standards.md](references/standards.md).
