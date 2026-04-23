#!/usr/bin/env bash
set -euo pipefail

REPO_URL="https://github.com/jkramer5103/mint-codex-bar.git"
INSTALL_DIR="/opt/mint-codex-bar"

if ! command -v git >/dev/null 2>&1; then
  printf 'git is required for quick install.\n' >&2
  exit 1
fi

if ! command -v bash >/dev/null 2>&1; then
  printf 'bash is required for quick install.\n' >&2
  exit 1
fi

if [ -d "$INSTALL_DIR/.git" ]; then
  printf 'Updating existing checkout in %s\n' "$INSTALL_DIR"
  if [ -w "$INSTALL_DIR" ]; then
    git -C "$INSTALL_DIR" fetch --depth=1 origin main
    git -C "$INSTALL_DIR" reset --hard origin/main
  else
    sudo git -C "$INSTALL_DIR" fetch --depth=1 origin main
    sudo git -C "$INSTALL_DIR" reset --hard origin/main
  fi
else
  printf 'Cloning into %s\n' "$INSTALL_DIR"
  if [ -e "$INSTALL_DIR" ]; then
    printf '%s exists but is not a git checkout. Remove it and rerun.\n' "$INSTALL_DIR" >&2
    exit 1
  fi

  parent_dir="$(dirname "$INSTALL_DIR")"
  if [ -w "$parent_dir" ]; then
    git clone --depth=1 "$REPO_URL" "$INSTALL_DIR"
  else
    sudo mkdir -p "$parent_dir"
    sudo git clone --depth=1 "$REPO_URL" "$INSTALL_DIR"
  fi
fi

printf 'Running installer\n'
bash "$INSTALL_DIR/install.sh"
