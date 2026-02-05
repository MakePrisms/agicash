#!/usr/bin/env bun
/**
 * Skill Packager - Creates a distributable .skill file of a skill folder
 *
 * Usage:
 *     bun package-skill.ts <path/to/skill-folder> [output-directory]
 *
 * Example:
 *     bun package-skill.ts skills/public/my-skill
 *     bun package-skill.ts skills/public/my-skill ./dist
 */

import { existsSync, mkdirSync, statSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { validateSkill } from './quick-validate';

/**
 * Create a zip file from skill directory
 * Uses the system zip command for reliability
 */
async function createZipFile(
  skillPath: string,
  outputPath: string,
): Promise<boolean> {
  const parentDir = dirname(skillPath);
  const skillName = basename(skillPath);

  const proc = Bun.spawn(['zip', '-r', outputPath, skillName], {
    cwd: parentDir,
    stdout: 'pipe',
    stderr: 'pipe',
  });

  const exitCode = await proc.exited;

  if (exitCode !== 0) {
    const stderr = await new Response(proc.stderr).text();
    console.log(`❌ Error creating zip: ${stderr}`);
    return false;
  }

  return true;
}

async function packageSkill(
  skillPath: string,
  outputDir?: string,
): Promise<string | null> {
  const resolvedSkillPath = resolve(skillPath);

  // Validate skill folder exists
  if (!existsSync(resolvedSkillPath)) {
    console.log(`❌ Error: Skill folder not found: ${resolvedSkillPath}`);
    return null;
  }

  if (!statSync(resolvedSkillPath).isDirectory()) {
    console.log(`❌ Error: Path is not a directory: ${resolvedSkillPath}`);
    return null;
  }

  // Validate SKILL.md exists
  const skillMd = join(resolvedSkillPath, 'SKILL.md');
  if (!(await Bun.file(skillMd).exists())) {
    console.log(`❌ Error: SKILL.md not found in ${resolvedSkillPath}`);
    return null;
  }

  // Run validation before packaging
  console.log('🔍 Validating skill...');
  const { valid, message } = await validateSkill(resolvedSkillPath);
  if (!valid) {
    console.log(`❌ Validation failed: ${message}`);
    console.log('   Please fix the validation errors before packaging.');
    return null;
  }
  console.log(`✅ ${message}\n`);

  // Determine output location
  const skillName = basename(resolvedSkillPath);
  let outputPath: string;
  if (outputDir) {
    const resolvedOutputDir = resolve(outputDir);
    // Create output directory if it doesn't exist
    if (!existsSync(resolvedOutputDir)) {
      mkdirSync(resolvedOutputDir, { recursive: true });
    }
    outputPath = join(resolvedOutputDir, `${skillName}.skill`);
  } else {
    outputPath = resolve(`${skillName}.skill`);
  }

  // List files being added
  const glob = new Bun.Glob('**/*');
  for await (const relPath of glob.scan({ cwd: resolvedSkillPath, onlyFiles: true })) {
    console.log(`  Added: ${join(skillName, relPath)}`);
  }

  // Create the .skill file (zip format)
  const success = await createZipFile(resolvedSkillPath, outputPath);

  if (success) {
    console.log(`\n✅ Successfully packaged skill to: ${outputPath}`);
    return outputPath;
  } else {
    return null;
  }
}

function printUsage(): void {
  console.log(
    'Usage: bun package-skill.ts <path/to/skill-folder> [output-directory]',
  );
  console.log('\nExample:');
  console.log('  bun package-skill.ts skills/public/my-skill');
  console.log('  bun package-skill.ts skills/public/my-skill ./dist');
}

// CLI entry point
if (import.meta.main) {
  const args = Bun.argv.slice(2);

  if (args.length < 1) {
    printUsage();
    process.exit(1);
  }

  const skillPath = args[0];
  const outputDir = args[1];

  console.log(`📦 Packaging skill: ${skillPath}`);
  if (outputDir) {
    console.log(`   Output directory: ${outputDir}`);
  }
  console.log();

  const result = await packageSkill(skillPath, outputDir);

  if (result) {
    process.exit(0);
  } else {
    process.exit(1);
  }
}
