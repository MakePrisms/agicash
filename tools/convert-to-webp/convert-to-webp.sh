QUALITY=80

usage() {
  echo "Usage: convert-to-webp [-q quality] <file.png> [file2.png ...]"
  echo "Converts PNG files to WebP and removes the originals."
  echo ""
  echo "Options:"
  echo "  -q, --quality <0-100>  WebP quality (default: 80)"
  echo "  -h, --help             Show this help"
}

while [[ $# -gt 0 ]]; do
  case $1 in
    -q|--quality) QUALITY="$2"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) break ;;
  esac
done

if [[ $# -eq 0 ]]; then
  usage >&2
  exit 1
fi

file_size() {
  stat -f%z "$1" 2>/dev/null || stat -c%s "$1" 2>/dev/null
}

converted=0
for file in "$@"; do
  if [[ ! -f "$file" ]]; then
    echo "Skipping (not found): $file" >&2
    continue
  fi

  if [[ "$file" != *.png ]]; then
    echo "Skipping (not PNG): $file" >&2
    continue
  fi

  output="${file%.png}.webp"
  original_size=$(file_size "$file")

  cwebp -quiet -q "$QUALITY" "$file" -o "$output"

  new_size=$(file_size "$output")
  savings=$((100 - (new_size * 100 / original_size)))

  rm "$file"
  echo "$(basename "$file") -> $(basename "$output") (${savings}% smaller)"
  converted=$((converted + 1))
done

echo "Converted $converted file(s)"
