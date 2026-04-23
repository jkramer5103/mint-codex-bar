#!/usr/bin/env bash
set -euo pipefail

UUID="mintcodexbar@jaron"

if ! command -v gdbus >/dev/null 2>&1; then
  printf 'gdbus is required to reload %s\n' "$UUID" >&2
  exit 1
fi

gdbus call --session \
  --dest org.Cinnamon \
  --object-path /org/Cinnamon \
  --method org.Cinnamon.ReloadXlet \
  "$UUID" \
  "APPLET" >/dev/null

sleep 1

gdbus call --session \
  --dest org.Cinnamon \
  --object-path /org/Cinnamon \
  --method org.Cinnamon.Eval \
  "(() => {
    let definition = imports.ui.appletManager.definitions.find(d => d.uuid === \"$UUID\");
    if (!definition || !definition.applet || typeof definition.applet._refresh !== \"function\") {
      return \"applet not found\";
    }
    definition.applet._refresh();
    return \"refreshed\";
  })()" >/dev/null

printf 'Reloaded and refreshed %s\n' "$UUID"
