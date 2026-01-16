# Add Skill

Install a Claude Code skill from MCPMarket, GitHub, or by searching skill collections.

## Arguments

- `$ARGUMENTS` - One of:
  - MCPMarket skill URL (e.g., `https://mcpmarket.com/tools/skills/skill-name`)
  - Skill name to search for (e.g., `next-js-cache`, `skill-writer`)
  - GitHub repository URL (e.g., `https://github.com/owner/repo`)

## Instructions

### Step 0: Request Permissions Upfront

Before proceeding, determine what permissions will be needed and request them all at once:

1. **Analyze the source type** from `$ARGUMENTS`:
   - MCPMarket URL → Will need: WebSearch or Playwright browser operations, git clone, find/search files, read files, create directories, copy files, edit files, verify installation, cleanup /tmp, git commit
   - Skill name search → Will need: WebSearch, git clone, find/search files, read files, create directories, copy files, edit files, verify installation, cleanup /tmp, git commit
   - GitHub URL → Will need: git clone, find/search files, read files, create directories, copy files, edit files, verify installation, cleanup /tmp, git commit

2. **Request all permissions** using AskUserQuestion:
   - Present a clear list of operations that will be performed
   - Ask user to confirm once to proceed with all operations
   - Example message: "To install this skill, I'll need to:
     - Search for the skill online (if needed)
     - Clone a git repository to /tmp
     - Search/list files to find the skill folder
     - Read SKILL.md to verify and extract skill information
     - Create .claude/skills/ directory if needed
     - Copy skill files to .claude/skills/
     - Modify SKILL.md to add source reference
     - Verify installation by listing installed files
     - Clean up temporary files in /tmp
     - Commit the changes to git (after your confirmation)

     Proceed with these operations?"

3. **Only after confirmation**, proceed with the installation steps below.

**Note:** This upfront permission request prevents multiple individual prompts during execution.

---

First, determine the source type from `$ARGUMENTS`:

---

### Source Type 1: MCPMarket Skill URL

If the argument matches `https://mcpmarket.com/tools/skills/<skill-slug>`:

1. **Extract the skill slug** from the URL (e.g., `skill-writer-2` from `https://mcpmarket.com/tools/skills/skill-writer-2`)

2. **Try Playwright MCP first** (if available):
   ```
   browser_navigate → https://mcpmarket.com/tools/skills/<skill-slug>
   browser_snapshot → look for GitHub link/source URL on the page
   ```
   - Look for a GitHub repository link on the skill page
   - Extract the skill name, description, and author if visible
   - If GitHub link found, proceed to Source Type 3

3. **Fallback to WebSearch** (if Playwright unavailable or page doesn't have GitHub link):
   ```
   Query: "<skill-slug>" mcpmarket github source
   ```
   Look for results containing the GitHub repository URL or skill collections.

4. **If no exact match found**, search known collections:
   - `https://github.com/travisvn/awesome-claude-skills` - Curated skill list
   - `https://github.com/anthropics/skills` - Official Anthropic skills
   - `https://github.com/raisiqueira/claude-code-plugins` - Plugin collection

5. **If installing a similar skill** (not exact match):
   - **MUST ask user for confirmation**: "I couldn't find '<skill-slug>' but found '<similar-skill>' which seems related. Install this instead?"
   - Do NOT proceed without explicit user approval
   - If user declines, report "Skill not found" and stop

6. **If skill not found at all**:
   - Report: "Could not find '<skill-slug>' in MCPMarket, GitHub, or known collections."
   - Suggest: "The best way to add a skill is by providing a direct GitHub link, e.g. `/add-skill https://github.com/owner/repo`"
   - Do NOT guess or install unrelated skills

---

### Source Type 2: Skill Name Search

If the argument is a skill name (not a URL):

1. **Search for the skill** using WebSearch:
   ```
   Query: "<skill-name>" claude code skill github
   ```

2. **Also check curated collections** by fetching:
   - `https://github.com/travisvn/awesome-claude-skills` - Look in the README for matching skills

3. **If matches found**, present to user with:
   - Skill name and description
   - GitHub source URL
   - Author/repository
   - **Ask user to confirm** which skill to install, then proceed to Source Type 3

4. **If no matches found**:
   - Report: "Could not find a skill matching '<skill-name>'."
   - Suggest: "The best way to add a skill is by providing a direct GitHub link, e.g. `/add-skill https://github.com/owner/repo`"
   - Do NOT install unrelated skills

---

### Source Type 3: GitHub Repository URL

If the argument matches `https://github.com/<owner>/<repo>` (or you found a GitHub source from steps above):

1. **Parse the repository URL** to extract owner and repo name

2. **Clone to temp directory**:
   ```bash
   rm -rf /tmp/<repo-name>
   git clone --depth 1 <repo-url> /tmp/<repo-name>
   ```

3. **Find the skill folder(s)** - Search in order of preference:
   ```bash
   find /tmp/<repo-name> -name "SKILL.md" -type f
   ```

   Common locations:
   - `.claude/skills/<skill-name>/SKILL.md` - Standard project skills
   - `plugins/<plugin-name>/.claude/skills/<skill-name>/SKILL.md` - Plugin format
   - `skills/<skill-name>/SKILL.md` - Root skills directory

4. **List available skills** if multiple found and let user choose

5. **Copy to project**:
   ```bash
   mkdir -p .claude/skills/
   cp -r /tmp/<repo-name>/<path-to-skill-folder> .claude/skills/
   ```

6. **Cleanup**:
   ```bash
   rm -rf /tmp/<repo-name>
   ```

---

## Post-Installation (All Sources)

1. **Verify installation**:
   ```bash
   ls -la .claude/skills/<skill-name>/
   cat .claude/skills/<skill-name>/SKILL.md | head -50
   ```

2. **Add source reference** to SKILL.md frontmatter if not present:
   - Add `source: <github-url-to-skill>` field in the YAML frontmatter
   - This documents where the skill was installed from

3. **Report to user**:
   - List the files installed
   - Show the skill description from SKILL.md frontmatter
   - Explain when the skill will activate (from the description field)

4. **Ask user for confirmation** before committing:
   - "Does this skill look correct? Would you like me to commit it?"
   - Allow user to review, modify, or remove files first
   - Only proceed to commit after explicit user approval

5. **Commit** (only after user confirms):
   ```bash
   git add .claude/skills/<skill-name>/
   git commit -m "Add <skill-name> Claude skill"
   ```

---

## Skill File Structure

A valid skill contains:
- `SKILL.md` (required) - Main instructions with YAML frontmatter containing `name` and `description`
- Reference docs (optional) - Additional `.md` files
- Scripts (optional) - Helper scripts (`.py`, `.sh`, etc.)
- Config files (optional) - JSON, YAML configurations

## Known Skill Sources

When searching for skills, check these repositories:

| Repository | Description |
|------------|-------------|
| [anthropics/skills](https://github.com/anthropics/skills) | Official Anthropic skills |
| [travisvn/awesome-claude-skills](https://github.com/travisvn/awesome-claude-skills) | Curated skill list with many community skills |
| [raisiqueira/claude-code-plugins](https://github.com/raisiqueira/claude-code-plugins) | Plugin collection with skills |

## Example Usage

```bash
# Install from MCPMarket URL (uses Playwright to fetch page, falls back to WebSearch)
/add-skill https://mcpmarket.com/tools/skills/next-js-cache-components-expert

# Search for a skill by name
/add-skill code-review
/add-skill skill-writer

# Install directly from GitHub
/add-skill https://github.com/anthropics/skills
/add-skill https://github.com/raisiqueira/claude-code-plugins
```

## Notes

- **Playwright MCP**: If available, Playwright is preferred for fetching MCPMarket pages as it can render JavaScript and extract GitHub links directly from the page.
- **Confirmation required**: When installing a "similar" skill (not exact match), user confirmation is always required.
- **No guessing**: If a skill cannot be found, the command will report failure rather than installing an unrelated skill.
