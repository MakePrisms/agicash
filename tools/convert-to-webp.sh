#!/usr/bin/env bash

# Converts PNG files to WebP format
# Usage: convert-to-webp <file.png> [file2.png ...]
# Or:    convert-to-webp --dir <directory>

set -e

QUALITY=80

show_help() {
  echo "Convert PNG images to WebP format"
  echo ""
  echo "Usage:"
  echo "  convert-to-webp <file.png> [file2.png ...]  Convert specific files"
  echo "  convert-to-webp --dir <directory>           Convert all PNGs in directory"
  echo ""
  echo "Options:"
  echo "  -q, --quality <0-100>  WebP quality (default: 80)"
  echo "  -h, --help             Show this help"
  echo ""
  echo "Examples:"
  echo "  convert-to-webp image.png"
  echo "  convert-to-webp --dir app/assets/gift-cards"
  echo "  convert-to-webp -q 85 --dir app/assets/gift-cards"
}

# Check if cwebp is available
if ! command -v cwebp &>/dev/null; then
  echo "❌ cwebp not found. Install it with: brew install webp"
  exit 1
fi

# Parse arguments
FILES=()
DIR=""

while [[ $# -gt 0 ]]; do
  case $1 in
    -h|--help)
      show_help
      exit 0
      ;;
    -q|--quality)
      QUALITY="$2"
      shift 2
      ;;
    --dir)
      DIR="$2"
      shift 2
      ;;
    *)
      FILES+=("$1")
      shift
      ;;
  esac
done

# If --dir was provided, find all PNGs in that directory
if [ -n "$DIR" ]; then
  if [ ! -d "$DIR" ]; then
    echo "❌ Directory not found: $DIR"
    exit 1
  fi
  for file in "$DIR"/*.png; do
    [ -f "$file" ] && FILES+=("$file")
  done
fi

if [ ${#FILES[@]} -eq 0 ]; then
  echo "❌ No PNG files specified"
  echo ""
  show_help
  exit 1
fi

CONVERTED=0
for file in "${FILES[@]}"; do
  if [ ! -f "$file" ]; then
    echo "⚠️  Skipping (not found): $file"
    continue
  fi

  if [[ "$file" != *.png ]]; then
    echo "⚠️  Skipping (not a PNG): $file"
    continue
  fi

  output="${file%.png}.webp"
  echo "🔄 Converting: $file → $output"

  # Get original size before conversion
  original_size=$(stat -f%z "$file" 2>/dev/null || stat -c%s "$file" 2>/dev/null)

  cwebp -q "$QUALITY" "$file" -o "$output" 2>/dev/null

  # Show size comparison
  new_size=$(stat -f%z "$output" 2>/dev/null || stat -c%s "$output" 2>/dev/null)
  savings=$((100 - (new_size * 100 / original_size)))

  # Delete the original PNG
  rm "$file"

  echo "   ✅ Done (${savings}% smaller, PNG deleted)"

  CONVERTED=$((CONVERTED + 1))
done

echo ""
echo "🎉 Converted $CONVERTED file(s) to WebP"
