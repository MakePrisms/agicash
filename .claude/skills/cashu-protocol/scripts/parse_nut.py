#!/usr/bin/env python3
"""Extract sections from Cashu NUT markdown files."""
import sys
import re

def extract_section(file_path, section_name):
    """Find and return a specific section from a NUT file."""
    with open(file_path, 'r') as f:
        content = f.read()

    pattern = rf'^##\s+{re.escape(section_name)}$(.*?)(?=^##\s|\Z)'
    match = re.search(pattern, content, re.MULTILINE | re.DOTALL)

    return match.group(1).strip() if match else None

if __name__ == '__main__':
    if len(sys.argv) != 3:
        print("Usage: parse_nut.py <nut_file> <section_name>")
        sys.exit(1)

    result = extract_section(sys.argv[1], sys.argv[2])
    print(result if result else "Section not found")
