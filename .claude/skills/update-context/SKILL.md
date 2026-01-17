---
name: update-context
description: You are the expert maintainer of this project's CLAUDE.md — the persistent, high-value context file that prevents stale assumptions and context pollution. Use when (1) running `/update-context` command for full analysis, (2) user asks to "update CLAUDE.md" with specific information, (3) user wants to add/remove/modify project context, or (4) after significant codebase changes that affect patterns or conventions.
---

# Update Context Skill

Maintain CLAUDE.md as a lean, accurate, high-ROI context file.

## Core Principles

1. **Concise > Comprehensive** - Target 120-150 lines max.
2. **Delete > Add** - Prefer removal of stale content over additions.
3. **Durable > Transient** - Only document repeating patterns, not one-offs.
4. **Point > Copy** - Reference external docs instead of duplicating.

## Update Modes

### Mode 1: Full Analysis (via /update-context)

When triggered by the command, perform complete analysis:

1. **Read current CLAUDE.md** in full.

2. **Analyze git history** to understand what changed since last update:
   - Find when CLAUDE.md was last updated
   - Summarize meaningful changes since then (exclude docs, tests, CLAUDE.md itself)

   ```bash
   # Find last CLAUDE.md update commit
   git log -1 --format="%H %ci" -- CLAUDE.md

   # Summarize changes since then
   git diff <commit>..HEAD --stat -- . ':!CLAUDE.md' ':!docs/' ':!tests/' ':!*.test.*' ':!*.spec.*'
   ```

3. **Classify changes** using the standards in [standards.md](references/standards.md):
   - **Must-add**: New critical patterns not yet documented
   - **Must-update**: Current content that's now wrong/misleading
   - **Should-remove**: Stale, redundant, or low-value content

4. **Output report** with these sections:
   - Summary of Changes Since Last Update (4-8 bullets)
   - Proposed Deletions (quote snippet + reason)
   - Proposed Modifications (before/after + reason)
   - Proposed Additions (only if high-value & durable, with justification)
   - Recommendation (minimal/medium/full refresh + estimated line count)

5. **Wait for approval** before making changes. If approved, apply edits and commit with message: "Update CLAUDE.md: [brief summary]".

### Mode 2: Targeted Update (ad-hoc requests)

When user asks to add/update specific content (e.g., "update CLAUDE.md to include how transactions work"):

1. **Read current CLAUDE.md** to understand structure and style.
2. **Research the topic** in the codebase using grep/glob or code search tools.
3. **Draft minimal addition** that fits existing style and principles.
4. **Validate against principles** in [standards.md](references/standards.md):
   - Is this durable (will it apply to many future sessions)?
   - Is it already documented elsewhere (prefer linking)?
   - Does it justify its token cost (saves more tokens in future interactions)?
   - Will it stay accurate without frequent updates?
5. **Propose the edit** showing exact location (section header), before/after content, and diff if helpful.
6. **Apply after confirmation** (or immediately if user said "just do it"). Commit with descriptive message.

## Reference Materials

For detailed guidance on content standards, style guidelines, and decision frameworks, see [standards.md](references/standards.md).