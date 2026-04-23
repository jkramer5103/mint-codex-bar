# mintCodexBar

A native Linux Mint Cinnamon applet that shows Codex usage in the panel and opens a clean stats popup on click.

## What it reads

- Live Codex account and rate-limit data from `codex app-server`
- Local activity data from `~/.codex/sessions`

No web scraping is used.

## Features

- Native Cinnamon panel applet
- Clickable popup with:
  - 5h usage window
  - weekly usage window
  - plan and account
  - credits
  - sessions today / 7 days
  - month-to-date spend estimate and latest token snapshot
- Refresh button
- Short panel label with remaining usage

## Install

Quick install from GitHub:

```bash
curl -fsSL https://raw.githubusercontent.com/jkramer5103/mint-codex-bar/main/quick-install.sh | bash
```

This bootstrapper:

- clones or updates the repo in `/opt/mint-codex-bar`
- uses `sudo` automatically if `/opt` is not writable
- runs `install.sh` after the checkout is ready

Local install from an existing checkout:

```bash
cd ~/Desktop/Programming_Stuff/mintCodexBar
./install.sh
```

The installer:

- symlinks the applet into `~/.local/share/cinnamon/applets`
- adds it to the Cinnamon panel if it is not already enabled
- asks Cinnamon to reload the applet

## Files

- `applet/files/mintcodexbar@jaron/applet.js`: Cinnamon applet UI
- `applet/files/mintcodexbar@jaron/fetch-stats.mjs`: live/local Codex stats collector
- `applet/files/mintcodexbar@jaron/stylesheet.css`: popup styling
- `quick-install.sh`: one-shot GitHub bootstrap installer
- `install.sh`: local installer for Cinnamon

## Manual test

```bash
node applet/files/mintcodexbar@jaron/fetch-stats.mjs
```
