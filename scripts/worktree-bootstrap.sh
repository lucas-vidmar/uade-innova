#!/usr/bin/env bash
# =============================================================================
# worktree-bootstrap.sh — make a fresh git worktree self-contained for agents
#
# A `git worktree add` checkout only contains TRACKED files. The BMad method
# lives outside git, so a fresh worktree misses everything agents need:
#   - _bmad/           (BMad framework: resolve_customization.py, sprint_plan.py, …)
#   - _bmad-output/    (epics.md, story files, sprint-status.yaml, …)
#   - .opencode/       (opencode config/agents/commands)
#   - .agents/skills/bmad-*  (the BMad skills are untracked; only azure-* are tracked)
#
# This script symlinks those shared, gitignored artifacts from the MAIN checkout
# into the current worktree so every parallel agent has the full BMad method.
# Symlinks (not copies) keep a single source of truth and stay in sync.
#
# Usage:
#   git worktree add -b story/<branch> ../<wt> origin/main
#   cd ../<wt>
#   bash scripts/worktree-bootstrap.sh
#
# Idempotent: safe to re-run. Never touches tracked files.
# =============================================================================
set -euo pipefail

# --- locate the main checkout -------------------------------------------------
# The main worktree is the first entry of `git worktree list --porcelain`.
MAIN="$(git worktree list --porcelain | awk '/^worktree /{print $2; exit}')"
if [[ -z "$MAIN" || ! -d "$MAIN" ]]; then
  echo "ERROR: could not locate the main checkout (git worktree list failed)" >&2
  exit 1
fi
MAIN="$(cd "$MAIN" && pwd)"
CUR="$(pwd)"

if [[ "$MAIN" == "$CUR" ]]; then
  echo "This IS the main checkout ($MAIN). Nothing to bootstrap."
  echo "Run this script inside a worktree created with 'git worktree add'."
  exit 0
fi

echo "Main checkout : $MAIN"
echo "Worktree      : $CUR"

# --- local exclude (gitignore's trailing-slash dir patterns don't match symlinks) --
# Write the symlinked top-level paths into .git/info/exclude so `git status`
# stays clean in the worktree. Local-only, never committed.
COMMON_GIT_DIR="$(git rev-parse --git-common-dir)"
EXCLUDE_FILE="${COMMON_GIT_DIR}/info/exclude"

exclude_add() {
  local pattern="$1"
  if ! grep -qxF "$pattern" "$EXCLUDE_FILE" 2>/dev/null; then
    printf '%s\n' "$pattern" >> "$EXCLUDE_FILE"
  fi
}

# --- shared dirs to symlink (whole-directory, fully untracked) ----------------
SHARED_DIRS=(_bmad _bmad-output .opencode)

linked=0
for dir in "${SHARED_DIRS[@]}"; do
  if [[ ! -e "$MAIN/$dir" ]]; then
    echo "  skip  $dir  (missing in main checkout)"
    continue
  fi
  if [[ -L "$CUR/$dir" ]]; then
    echo "  ok    $dir  (already a symlink -> $(readlink "$CUR/$dir"))"
    continue
  fi
  if [[ -e "$CUR/$dir" ]]; then
    echo "  WARN  $dir  exists in worktree and is NOT a symlink; leaving it alone"
    continue
  fi
  ln -s "$MAIN/$dir" "$CUR/$dir"
  echo "  link  $dir -> $MAIN/$dir"
  linked=$((linked + 1))
done

# Also ensure the top-level shared dirs are excluded locally (covers both
# symlinked and pre-existing cases).
for dir in "${SHARED_DIRS[@]}"; do
  exclude_add "$dir"
done
exclude_add ".agents/skills/bmad-*"

# --- untracked BMad skills (per-directory; azure-* skills are already tracked) -
# A fresh worktree has only the tracked skill dirs (azure-*). Symlink the
# untracked bmad-* (and any other) skill dirs so the BMad workflows resolve.
SKILL_DIR=".agents/skills"
mkdir -p "$CUR/$SKILL_DIR"

tracked="$(git -C "$MAIN" ls-files "$SKILL_DIR" | sed "s|^$SKILL_DIR/||" | cut -d/ -f1 | sort -u)"
for main_skill in "$MAIN/$SKILL_DIR"/*/; do
  name="$(basename "$main_skill")"
  if printf '%s\n' "$tracked" | grep -qx "$name"; then
    continue  # already present in the worktree checkout
  fi
  if [[ -L "$CUR/$SKILL_DIR/$name" ]]; then
    continue  # already linked
  fi
  if [[ -e "$CUR/$SKILL_DIR/$name" ]]; then
    echo "  WARN  skill '$name' exists untracked in worktree; leaving it alone"
    continue
  fi
  ln -s "$MAIN/$SKILL_DIR/$name" "$CUR/$SKILL_DIR/$name"
  echo "  link  $SKILL_DIR/$name -> $MAIN/$SKILL_DIR/$name"
  linked=$((linked + 1))
done

# --- verification --------------------------------------------------------------
echo
echo "Linked $linked shared paths."
echo "Verification (paths that must now resolve):"
for p in _bmad/scripts/resolve_customization.py \
         _bmad-output/planning-artifacts/epics.md \
         _bmad-output/implementation-artifacts/sprint-status.yaml \
         .agents/skills/bmad-build/SKILL.md \
         .opencode/opencode.json; do
  if [[ -e "$CUR/$p" ]]; then
    echo "  OK   $p"
  else
    echo "  MISS $p"
  fi
done
