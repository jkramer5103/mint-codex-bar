# CLIProxy Bar

A Linux Mint Cinnamon panel applet that shows the quota of every account in your [CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI). It works like CodexBar, but for all your proxied Codex and Claude accounts at once.

- **Panel:** `5h/weekly` remaining, summed across the accounts you count (e.g. `242/266` for four accounts).
- **Popup:** one card per account with session and weekly bars, reset countdowns and plan. OpenAI cards are blue and Anthropic cards are orange.
- **Even-usage marker:** the white line on each bar shows how much would be left if you used the window at a steady pace. Fill left of the line means you're burning faster than the window allows.
- **Account settings:** rearrange cards, hide cards, and choose which accounts count toward the total. Changes apply live.

## Install

```bash
curl -fsSL https://raw.githubusercontent.com/jkramer5103/mint-codex-bar/main/quick-install.sh | bash
```

Or from a checkout: `./install.sh`. Existing installations keep their panel position. Remove with `./uninstall.sh`.

Requires Cinnamon, Node.js 18+ (20+ recommended), Python 3, and PyGObject GTK 3 (`python3-gi`, `gir1.2-gtk-3.0` on Mint).

## Connect

1. Right-click the applet → **Connection settings…**.
2. Enter your CLIProxyAPI server URL (for example `http://127.0.0.1:8317`) and the **management key** (not an inference API key).
3. Save. Accounts are discovered automatically.

The URL may include a reverse-proxy path prefix or end with `/v0/management`. Remote servers must allow remote management; use HTTPS for remote connections. If the management key is rejected, automatic refreshes pause until you save the connection again.

## Usage

- **Left-click:** the overview popup. The bottom row shows the 5h and weekly totals across counted accounts.
- **Right-click → Account settings…:** for each account, **▲/▼** changes its card position, **Card** shows or hides its card in the popup, and **Total** includes or excludes it from the panel and bottom totals. Card and Total are independent. New accounts are shown and counted automatically.
- **Refresh:** every 3 minutes, or **Refresh now** in the popup.
- **`!` in the panel:** a counted account has no data, so the totals are partial.
- **Temporary failures:** if a provider lookup fails (for example, Claude's usage endpoint returns HTTP 429), the account keeps its last known values and says so.

## Quota support

- **Codex:** session, weekly, code review, additional model limits, plan, and credits.
- **Claude:** session, weekly, and model-specific windows.
- **Antigravity:** model quotas when the provider returns `models[].quotaInfo`.
- Other providers are listed with an "unsupported" note.

The collector only calls `/v0/management/auth-files` and `/v0/management/api-call`. Provider tokens never leave CLIProxyAPI; the applet sends CLIProxyAPI's `$TOKEN$` substitution marker. It never sends model requests or uses reset credits. Provider endpoints follow the [CLIProxyAPI management UI](https://github.com/router-for-me/Cli-Proxy-API-Management-Center/tree/main/src/features/quota/providers).

## Files

Settings live in `$XDG_CONFIG_HOME/mintcodexbar/` (default `~/.config/mintcodexbar/`):

- `connection.json`: server URL and management key, owner-only permissions. Don't share it.
- `accounts.json`: card order, hidden cards, and accounts excluded from the total.
- `known-accounts.json`: the account list for the settings window, written by the applet.

Applet source, in `applet/files/mintcodexbar@jaron/`:

- `applet.js`: panel label, popup and menus.
- `fetch-stats.mjs`: CLIProxyAPI collector and quota normalization.
- `panelModel.js`: totals, card order and the even-usage marker, shared with the tests.
- `accounts.py`, `connection.py`: GTK settings windows.
- `stylesheet.css`: popup styling.

## Development

```bash
npm test        # collector and panel model tests
npm run fetch   # print the collector's JSON for your configured server
./reload.sh     # reload the applet in the running Cinnamon session
```
