#!/usr/bin/env bun
/**
 * Quick validation script for skills - minimal version
 */

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

const ALLOWED_PROPERTIES = new Set([
  'name',
  'description',
  'license',
  'allowed-tools',
  'metadata',
  'source',
]);

/**
 * Parse simple YAML frontmatter without external dependencies.
 * Handles basic key: value pairs and multiline strings.
 */
function parseSimpleYaml(yamlText: string): Record<string, string> {
  const result: Record<string, string> = {};
  const lines = yamlText.split('\n');

  let currentKey: string | null = null;
  let currentValue: string[] = [];

  for (const line of lines) {
    // Check if this is a new key: value line
    const keyMatch = line.match(/^([a-z-]+):\s*(.*)$/);
    if (keyMatch) {
      // Save previous key if exists
      if (currentKey !== null) {
        result[currentKey] = currentValue.join('\n').trim();
      }
      currentKey = keyMatch[1];
      currentValue = keyMatch[2] ? [keyMatch[2]] : [];
    } else if (currentKey !== null && line.startsWith('  ')) {
      // Continuation of multiline value
      currentValue.push(line.slice(2));
    } else if (currentKey !== null && line.trim() === '') {
      // Empty line in multiline value
      currentValue.push('');
    }
  }

  // Save last key
  if (currentKey !== null) {
    result[currentKey] = currentValue.join('\n').trim();
  }

  return result;
}

export function validateSkill(skillPath: string): {
  valid: boolean;
  message: string;
} {
  const skillMdPath = join(skillPath, 'SKILL.md');

  // Check SKILL.md exists
  if (!existsSync(skillMdPath)) {
    return { valid: false, message: 'SKILL.md not found' };
  }

  // Read and validate frontmatter
  const content = readFileSync(skillMdPath, 'utf-8');
  if (!content.startsWith('---')) {
    return { valid: false, message: 'No YAML frontmatter found' };
  }

  // Extract frontmatter
  const match = content.match(/^---\n(.*?)\n---/s);
  if (!match) {
    return { valid: false, message: 'Invalid frontmatter format' };
  }

  const frontmatterText = match[1];

  // Parse YAML frontmatter using simple parser
  const frontmatter = parseSimpleYaml(frontmatterText);

  // Check for unexpected properties
  const unexpectedKeys = Object.keys(frontmatter).filter(
    (key) => !ALLOWED_PROPERTIES.has(key),
  );
  if (unexpectedKeys.length > 0) {
    return {
      valid: false,
      message: `Unexpected key(s) in SKILL.md frontmatter: ${unexpectedKeys.sort().join(', ')}. Allowed properties are: ${[...ALLOWED_PROPERTIES].sort().join(', ')}`,
    };
  }

  // Check required fields
  if (!('name' in frontmatter)) {
    return { valid: false, message: "Missing 'name' in frontmatter" };
  }
  if (!('description' in frontmatter)) {
    return { valid: false, message: "Missing 'description' in frontmatter" };
  }

  // Extract and validate name
  const name = frontmatter.name;
  if (typeof name !== 'string') {
    return {
      valid: false,
      message: `Name must be a string, got ${typeof name}`,
    };
  }
  const trimmedName = name.trim();
  if (trimmedName) {
    // Check naming convention (hyphen-case: lowercase with hyphens)
    if (!/^[a-z0-9-]+$/.test(trimmedName)) {
      return {
        valid: false,
        message: `Name '${trimmedName}' should be hyphen-case (lowercase letters, digits, and hyphens only)`,
      };
    }
    if (
      trimmedName.startsWith('-') ||
      trimmedName.endsWith('-') ||
      trimmedName.includes('--')
    ) {
      return {
        valid: false,
        message: `Name '${trimmedName}' cannot start/end with hyphen or contain consecutive hyphens`,
      };
    }
    // Check name length (max 64 characters per spec)
    if (trimmedName.length > 64) {
      return {
        valid: false,
        message: `Name is too long (${trimmedName.length} characters). Maximum is 64 characters.`,
      };
    }
  }

  // Extract and validate description
  const description = frontmatter.description;
  if (typeof description !== 'string') {
    return {
      valid: false,
      message: `Description must be a string, got ${typeof description}`,
    };
  }
  const trimmedDescription = description.trim();
  if (trimmedDescription) {
    // Check for angle brackets
    if (trimmedDescription.includes('<') || trimmedDescription.includes('>')) {
      return {
        valid: false,
        message: 'Description cannot contain angle brackets (< or >)',
      };
    }
    // Check description length (max 1024 characters per spec)
    if (trimmedDescription.length > 1024) {
      return {
        valid: false,
        message: `Description is too long (${trimmedDescription.length} characters). Maximum is 1024 characters.`,
      };
    }
  }

  return { valid: true, message: 'Skill is valid!' };
}

// CLI entry point
if (import.meta.main) {
  const args = process.argv.slice(2);
  if (args.length !== 1) {
    console.log('Usage: bun quick-validate.ts <skill_directory>');
    process.exit(1);
  }

  const { valid, message } = validateSkill(args[0]);
  console.log(message);
  process.exit(valid ? 0 : 1);
}
