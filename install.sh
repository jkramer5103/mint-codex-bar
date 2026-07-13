#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
UUID="mintcodexbar@jaron"
SRC_DIR="$PROJECT_DIR/applet/files/$UUID"
DST_DIR="$HOME/.local/share/cinnamon/applets/$UUID"

mkdir -p "$HOME/.local/share/cinnamon/applets"
ln -sfn "$SRC_DIR" "$DST_DIR"

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

def parse_entry(entry):
    panel, location, order, applet_uuid, instance = entry.split(":", 4)
    return {
        "panel": panel,
        "location": location,
        "order": int(order),
        "uuid": applet_uuid,
        "instance": instance,
    }

entries = [parse_entry(item) for item in current]
target = next((entry for entry in entries if entry["uuid"] == uuid), None)

if target is None:
    next_instance = max((int(entry["instance"]) for entry in entries), default=0) + 1
    target = {
        "panel": "panel1",
        "location": "right",
        "order": 0,
        "uuid": uuid,
        "instance": str(next_instance),
    }
    entries.append(target)

panel_right = [
    entry for entry in entries
    if entry["panel"] == "panel1" and entry["location"] == "right" and entry["uuid"] != uuid
]
other_entries = [
    entry for entry in entries
    if not (entry["panel"] == "panel1" and entry["location"] == "right")
]

insert_at = next(
    (index + 1 for index, entry in enumerate(panel_right) if entry["uuid"] == "power@cinnamon.org"),
    len(panel_right),
)
panel_right.insert(insert_at, target)

for index, entry in enumerate(panel_right):
    entry["order"] = index

updated = other_entries + panel_right
updated.sort(key=lambda entry: (entry["panel"], entry["location"], entry["order"], int(entry["instance"])))

updated_raw = [
    f'{entry["panel"]}:{entry["location"]}:{entry["order"]}:{entry["uuid"]}:{entry["instance"]}'
    for entry in updated
]

if updated_raw != current:
    subprocess.check_call(
        ["gsettings", "set", "org.cinnamon", "enabled-applets", str(updated_raw)]
    )
PY
fi

if command -v dbus-send >/dev/null 2>&1; then
  dbus-send --session \
    --dest=org.Cinnamon \
    /org/Cinnamon \
    org.Cinnamon.ReloadXlet \
    string:"$UUID" \
    string:"APPLET" >/dev/null 2>&1 || true
fi

printf 'Installed %s\n' "$UUID"
printf 'If it does not appear immediately, remove/add it once in Cinnamon applets settings.\n'
