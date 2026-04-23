#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
UUID="mintcodexbar@jaron"
DST_DIR="$HOME/.local/share/cinnamon/applets/$UUID"

if command -v gsettings >/dev/null 2>&1; then
  python3 - <<'PY'
import ast
import subprocess

uuid = "mintcodexbar@jaron"

current_raw = subprocess.check_output(
    ["gsettings", "get", "org.cinnamon", "enabled-applets"],
    text=True,
).strip()

current = ast.literal_eval(current_raw)
updated = [entry for entry in current if f":{uuid}:" not in entry]

if updated != current:
    subprocess.check_call(
        ["gsettings", "set", "org.cinnamon", "enabled-applets", str(updated)]
    )
PY
fi

rm -f "$DST_DIR"

if command -v dbus-send >/dev/null 2>&1; then
  dbus-send --session \
    --dest=org.Cinnamon \
    /org/Cinnamon \
    org.Cinnamon.ReloadXlet \
    string:"$UUID" \
    string:"Applet" >/dev/null 2>&1 || true
fi

printf 'Uninstalled %s\n' "$UUID"
