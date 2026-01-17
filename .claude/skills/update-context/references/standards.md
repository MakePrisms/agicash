# CLAUDE.md Content Standards

Reference this file when evaluating what content belongs in CLAUDE.md and how to structure it.

## What Belongs in CLAUDE.md

- Project overview (1-2 sentences)
- Tech stack summary (table format)
- File structure (tree view, max 10 lines)
- Critical patterns that differ from defaults (e.g., custom hooks, state management)
- Common commands (e.g., build, deploy)
- Links to skills or external docs for detailed guidance

## What Does NOT Belong

- Transient info (current bugs, WIP features)
- Detailed API documentation (link to docs instead)
- Long code examples (put in skills)
- Obvious conventions Claude already knows (e.g., standard React patterns)
- Step-by-step tutorials (put in skills)
- Version numbers that change often (use ranges or link to package.json)

## Style Guidelines

- Use tables for structured data (tech stack, commands)
- Use code blocks for file trees and patterns
- Use headers sparingly (##, ### only)
- Keep each section to 5-10 lines max
- Use `code` formatting for file names and commands
- Ensure consistent tone: direct, factual, actionable

## Decision Framework

Before adding content, ask:

| Question | If No → |
|----------|---------|
| Will this change how Claude writes code? | Don't add |
| Does Claude need this for >50% of tasks? | Put in skill instead |
| Will this stay true for 6+ months? | Don't add |
| Is this unique to our project? | Don't add (Claude knows it) |

## Common Mistakes to Avoid

- Adding content "just in case" someone needs it
- Documenting standard library/framework behavior
- Including debugging tips for solved issues
- Copying content from README or other docs
- Adding sections for features that aren't built yet
- Overloading with details that could be inferred from code
