#!/bin/bash
# Runs biome format on files after Write or Edit
INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty')

# Skip if no file path
if [ -z "$FILE_PATH" ]; then
  exit 0
fi

# Only format files biome handles
case "$FILE_PATH" in
  *.ts|*.tsx|*.js|*.jsx|*.json|*.css) ;;
  *) exit 0 ;;
esac

# Skip node_modules and build artifacts
case "$FILE_PATH" in
  */node_modules/*|*/build/*|*/.react-router/*) exit 0 ;;
esac

# Run biome format on the specific file via package.json script
cd "$CLAUDE_PROJECT_DIR"
bun run format -- "$FILE_PATH" 2>/dev/null

exit 0
