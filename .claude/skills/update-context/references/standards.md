# CLAUDE.md Content Standards

Reference this file when evaluating what content belongs in CLAUDE.md and how to structure it.

## The Golden Rule

**Every line in CLAUDE.md should save hours of future mistakes.** If a rule has prevented (or would prevent) repeated errors, it belongs. If it's just "nice to know," it doesn't.

## What Belongs in CLAUDE.md

### High-Value Content (Always Include)

- **Project overview** (1-2 sentences)
- **Tech stack summary** (table format)
- **File structure** (tree view, ~10 lines max)
- **Common Pitfalls & How to Avoid Them** — The most valuable section:
  - Every hard-won lesson from past mistakes
  - Each with "Learned from: [date/context]" annotation
  - Specific, testable rules (not vague guidance)
- **Critical patterns** that differ from defaults
- **Context Evolution Rules** — Meta-rules for maintaining the file
- **Common commands** (build, test, deploy)
- **Links to skills** for detailed guidance

### What Makes a Good Rule

| Good Rule | Bad Rule |
|-----------|----------|
| "Use Money class for all arithmetic — never raw numbers" | "Handle money carefully" |
| "Don't use useEffect for data fetching — use TanStack Query" | "Follow React best practices" |
| "Encrypt all sensitive data before storage using lib/crypto" | "Be security-conscious" |

Good rules are:
- **Specific**: Clear enough that compliance is obvious
- **Testable**: You can verify if code follows it
- **Actionable**: Tells you exactly what to do
- **Contextual**: Includes why/when this was learned

## What Does NOT Belong

- **Transient info** (current bugs, WIP features)
- **Detailed API documentation** (link to docs/skills instead)
- **Long code examples** (put in skills)
- **Obvious conventions** Claude already knows (standard React patterns)
- **Step-by-step tutorials** (put in skills)
- **Version numbers** that change often (use ranges or link to package.json)
- **Rules without context** — If you can't explain when/why, reconsider adding it

## The "Learned From" Pattern

Every rule in "Common Pitfalls" should include origin context:

```markdown
## Common Pitfalls & How to Avoid Them

- **Always use `Money` class for financial calculations** — Never use raw arithmetic on amounts. Learned from: 2026-01-10, rounding errors caused $0.01 discrepancies in transaction totals.

- **Don't commit `.env` files** — Use `.env.example` as template. Learned from: 2026-01-05, accidentally exposed staging API keys.

- **Validate all Zod schemas at system boundaries** — Internal functions can trust typed inputs. Learned from: 2026-01-20, redundant validation added 200ms to hot path.
```

This pattern:
1. Preserves the *why* behind each rule
2. Helps identify stale rules (old dates + outdated tech = review candidate)
3. Gives weight to rules (recent + severe incident = important)
4. Makes the file a true learning record

## Style Guidelines

- Use tables for structured data (tech stack, commands)
- Use code blocks for file trees and patterns
- Use headers sparingly (##, ### only)
- Keep sections focused but don't sacrifice clarity for brevity
- Use `code` formatting for file names and commands
- Tone: direct, factual, actionable
- End file with `<!-- Last updated: YYYY-MM-DD -->`

## Decision Framework

Before adding content, ask:

| Question | Action |
|----------|--------|
| Has this caused a mistake before? | **Add with "Learned from" context** |
| Is this project-specific (Claude wouldn't know)? | Add to appropriate section |
| Does this apply to >50% of tasks? | Add to CLAUDE.md |
| Does this apply to <50% of tasks? | Put in a skill instead |
| Is there a similar existing rule? | Consolidate, don't duplicate |
| Is this vague or untestable? | Make it specific or don't add |

## Consolidation Over Duplication

When you find related rules scattered across CLAUDE.md:

**Before:**
```markdown
- Don't use raw numbers for money
- Always use the Money class
- Financial calculations need Money wrapper
```

**After:**
```markdown
- **Use `Money` class for all financial arithmetic** — Never use raw numbers. Handles precision, currency conversion, and display formatting. Learned from: 2026-01-10.
```

## Managing Size: When to Extract to Skills

If CLAUDE.md exceeds ~2000 tokens or a section exceeds ~20 lines:

1. Extract detailed guidance to `.claude/skills/[topic]/`
2. Keep a 2-3 line summary in CLAUDE.md
3. Link to the skill: "See `/topic-skill` for details"

This keeps CLAUDE.md scannable while preserving all learnings.

## Health Checks

Run these periodically (or during `/update-context`):

- [ ] Every pitfall rule has "Learned from" context
- [ ] No duplicate or overlapping rules
- [ ] Rules are specific and testable
- [ ] File is under ~2000 tokens
- [ ] Last updated date is recent
- [ ] No references to removed code/patterns
