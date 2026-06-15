#!/usr/bin/env bash
# scripts/release.sh — tag-based release for the monorepo.
#
# Usage:
#   ./scripts/release.sh <package> <version>
#   e.g. ./scripts/release.sh soly 0.2.1
#
# This script:
#   1. Updates packages/<package>/package.json version
#   2. Updates root CHANGELOG.md (manual — you still write the notes)
#   3. Commits the change
#   4. Creates a tag like "soly-v0.2.1"
#   5. Pushes to origin (triggers the release workflow)
#
# The release.yml workflow reads the tag name, verifies the package version
# matches, and runs your npm-publisher agent.

set -euo pipefail

if [ $# -ne 2 ]; then
  echo "Usage: $0 <package> <version>"
  echo "  e.g. $0 soly 0.2.1"
  exit 1
fi

PKG="$1"
VER="$2"
PKG_DIR="packages/${PKG}"

if [ ! -d "$PKG_DIR" ]; then
  echo "Error: $PKG_DIR not found"
  exit 1
fi

# Update version in packages/<pkg>/package.json
echo "→ Bumping $PKG_DIR/package.json to $VER"
node -e "
  const fs = require('fs');
  const path = '$PKG_DIR/package.json';
  const pkg = JSON.parse(fs.readFileSync(path, 'utf-8'));
  pkg.version = '$VER';
  fs.writeFileSync(path, JSON.stringify(pkg, null, 2) + '\n');
"

# Commit + tag
git add "${PKG_DIR}/package.json"
git -c user.name="release-bot" -c user.email="bot@local" commit -m "release: ${PKG} v${VER}"
git tag "${PKG}-v${VER}"

echo ""
echo "✓ Tagged ${PKG}-v${VER}"
echo "  Run \`git push origin main && git push origin ${PKG}-v${VER}\` to publish"
echo "  (or: \`git push origin --follow-tags\` to push both at once)"
