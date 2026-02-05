#!/usr/bin/env bun
/**
 * Extract sections from Cashu NUT markdown files.
 */

function extractSection(content: string, sectionName: string): string | null {
  const escaped = sectionName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Match section header, capture until next ## or end of string
  const pattern = new RegExp(`^##\\s+${escaped}\\s*$`, 'm');
  const match = pattern.exec(content);
  if (!match) return null;

  const startIdx = match.index + match[0].length;
  const nextSection = content.slice(startIdx).search(/^##\s/m);
  const endIdx = nextSection === -1 ? content.length : startIdx + nextSection;

  return content.slice(startIdx, endIdx).trim();
}

const args = Bun.argv.slice(2);
if (args.length !== 2) {
  console.log('Usage: bun scripts/parse-nut.ts <nut_file> <section_name>');
  process.exit(1);
}

const [filePath, sectionName] = args;
const content = await Bun.file(filePath).text();
const result = extractSection(content, sectionName);
console.log(result ?? 'Section not found');

export {};
