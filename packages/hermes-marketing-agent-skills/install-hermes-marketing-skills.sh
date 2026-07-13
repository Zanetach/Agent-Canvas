#!/usr/bin/env bash
set -euo pipefail

bundle_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
skills_dir="$bundle_dir/skills"
target_dir="$HOME/.hermes/skills/marketing"
backup_root="$HOME/.hermes/backups"
dry_run=false

usage() {
  cat <<'EOF'
Usage: ./install-hermes-marketing-skills.sh [--dry-run] [--target PATH] [--backup-dir PATH]

Installs the bundled marketing Skills into ~/.hermes/skills/marketing by default.
Existing same-name Skills are moved to ~/.hermes/backups/ before replacement.
EOF
}

while (($# > 0)); do
  case "$1" in
    --dry-run)
      dry_run=true
      ;;
    --target)
      shift
      target_dir="${1:?--target requires a directory}"
      ;;
    --backup-dir)
      shift
      backup_root="${1:?--backup-dir requires a directory}"
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      printf 'Unknown option: %s\n' "$1" >&2
      usage >&2
      exit 1
      ;;
  esac
  shift
done

skills=(
  news-aggregator-skill
  product-marketing
  customer-research
  competitor-profiling
  marketing-plan
  content-strategy
  copywriting
  social
  baoyu-cover-image
  baoyu-xhs-images
  baoyu-post-to-wechat
  cro
  revops
  analytics
  ab-testing
)

for skill in "${skills[@]}"; do
  if [[ ! -f "$skills_dir/$skill/SKILL.md" ]]; then
    printf 'Invalid bundle: skills/%s/SKILL.md is missing\n' "$skill" >&2
    exit 1
  fi
done

if "$dry_run"; then
  printf 'Dry run: would install %d Skills into %s\n' "${#skills[@]}" "$target_dir"
  printf '%s\n' "${skills[@]}"
  exit 0
fi

mkdir -p "$target_dir"
backup_dir="$backup_root/marketing-agent-$(date +%Y%m%d-%H%M%S)"
created_backup=false

for skill in "${skills[@]}"; do
  source_dir="$skills_dir/$skill"
  destination_dir="$target_dir/$skill"

  if [[ -e "$destination_dir" ]]; then
    if ! "$created_backup"; then
      mkdir -p "$backup_dir"
      created_backup=true
    fi
    mv "$destination_dir" "$backup_dir/$skill"
  fi

  cp -R "$source_dir" "$destination_dir"
  printf 'Installed: %s\n' "$skill"
done

if "$created_backup"; then
  printf 'Previous Skills backed up to: %s\n' "$backup_dir"
fi

printf 'Installed %d marketing Skills into: %s\n' "${#skills[@]}" "$target_dir"
