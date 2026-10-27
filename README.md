# CLIProxy Bar

A native Linux Mint Cinnamon panel applet for CLIProxyAPI. Click the panel percentage to see each account’s remaining limits and reset countdowns in a compact account list.

## Connect

1. Run `./install.sh` (existing installations keep their panel placement and applet ID).
2. Right-click **Proxy** in the panel → **Connection settings…**.
3. Enter your CLIProxyAPI server URL (for example `http://127.0.0.1:8317`) and **management token**, then save.

Accounts are discovered automatically and every account is always listed in the popup, colour-coded blue for OpenAI and orange for Anthropic. Refreshes run every 3 minutes; you can also refresh manually. The panel shows `5h/weekly` remaining, summed across counted accounts (e.g. 70% + 50% = `120/…`). Right-click the applet → **Account settings…** to rearrange the cards (▲/▼), hide cards from the popup (**Card**), and choose which accounts count toward the panel and the bottom total (**Total**). The two are independent, and changes apply immediately. Newly added accounts are shown and counted automatically. `!` means a counted account has no data, so the totals are partial. If one account's quota lookup fails temporarily (for example, Claude rate-limits with HTTP 429), its last known values stay visible and are marked as such.

## Quota support

- **Codex:** session, weekly, code review, additional model limits, and reported credits.
- **Claude:** session, weekly, and model-specific utilization windows.
- **Antigravity:** model quotas when the provider returns `models[].quotaInfo`.
- Other auth-file providers remain listed with an explicit unsupported message. API-key account balances and provider-specific quotas beyond these adapters are not implemented.

The collector uses `/v0/management/auth-files` and `/v0/management/api-call`. Provider tokens stay on CLIProxyAPI; the applet sends its token substitution marker. It does not generate model requests or consume reset credits. Source reference: [CLIProxyAPI management UI](https://github.com/router-for-me/Cli-Proxy-API-Management-Center/tree/main/src/features/quota/providers).

The URL can include a reverse-proxy path prefix or end with `/v0/management`. Remote servers must permit management access. Use HTTPS for remote connections. Management authentication failures suspend automatic retries until connection settings are saved again.

Settings are stored at `$XDG_CONFIG_HOME/mintcodexbar/connection.json` (default `~/.config/mintcodexbar/connection.json`) with owner-only file permissions. The management token is stored locally; do not share this file.

Requires Cinnamon, Node.js 18+ (20+ recommended), Python 3, and PyGObject GTK 3 (`python3-gi`, `gir1.2-gtk-3.0` on Mint).

## Development

```bash
npm test
npm run fetch
./reload.sh
```

Tests cover quota normalization, missing data, proxy request contracts, isolated failures, and authentication rejection. A real server connection requires your URL and management token.
