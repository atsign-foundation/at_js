#!/usr/bin/env bash
# For each features/<name>/ directory, prints "missing: <name>: <title>" for every
# Scenario: title that no *.ts file under packages/<name> or tools/<name> carries
# verbatim as a quoted ('...', "..." or `...`) title. Prints nothing when every
# scenario has a proving test.
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
for dir in "$root"/features/*/; do
  name="$(basename "$dir")"
  sources=()
  for base in packages tools; do
    [[ -d "$root/$base/$name" ]] && sources+=("$root/$base/$name")
  done
  while IFS= read -r title; do
    if ((${#sources[@]} == 0)) ||
      ! grep -rqF --include='*.ts' --exclude-dir=node_modules --exclude-dir=dist \
        -e "'$title'" -e "\"$title\"" -e "\`$title\`" "${sources[@]}"; then
      echo "missing: $name: $title"
    fi
  done < <(grep -h '^[[:space:]]*Scenario: ' "$dir"*.feature | sed -E 's/^[[:space:]]*Scenario: //; s/[[:space:]]+$//')
done
