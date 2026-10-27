#!/usr/bin/env node
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { realpathSync } from 'node:fs';

export const configPath = path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'mintcodexbar', 'connection.json');
export function windowData(label, used, reset, seconds) {
  if (used === null || used === undefined || !Number.isFinite(Number(used))) return null;
  const date = typeof reset === 'number' ? new Date(reset * 1000) : new Date(reset || NaN);
  return { label, remaining: Math.max(0, Math.min(100, 100 - Number(used))), resetsAt: Number.isNaN(date.getTime()) ? null : date.toISOString(), windowSeconds: Number.isFinite(seconds) && seconds > 0 ? seconds : null };
}
export function normalize(provider, data) {
  const windows = [];
  const add = (...args) => { const w = windowData(...args); if (w) windows.push(w); };
  if (provider === 'codex') {
    const limits = [['', data.rate_limit], ['Code review · ', data.code_review_rate_limit], ...(data.additional_rate_limits || []).map(x => [(x.limit_name || x.metered_feature || 'Additional') + ' · ', x.rate_limit])];
    for (const [prefix, limit] of limits) {
      for (const key of ['primary_window', 'secondary_window']) {
        const w = limit?.[key];
        if (!w) continue;
        const seconds = w.limit_window_seconds;
        const label = seconds === 604800 ? 'Weekly' : seconds === 18000 ? 'Session · 5h' : seconds ? `${Math.round(seconds / 3600)}h window` : key === 'primary_window' ? 'Session' : 'Weekly';
        add(prefix + label, w.used_percent, w.reset_at ?? (Number.isFinite(w.reset_after_seconds) ? Math.floor(Date.now() / 1000) + w.reset_after_seconds : null), seconds);
      }
    }
  } else if (provider === 'claude') {
    for (const [key, value] of Object.entries(data)) {
      if (value && typeof value === 'object' && 'utilization' in value) {
        const label = key === 'five_hour' ? 'Session · 5h' : key === 'seven_day' ? 'Weekly' : key.replaceAll('_', ' ');
        add(label, value.utilization, value.resets_at, key.startsWith('five_hour') ? 18000 : key.startsWith('seven_day') ? 604800 : null);
      }
    }
  } else if (provider === 'antigravity') {
    for (const [id, model] of Object.entries(data.models || {})) {
      const q = model.quotaInfo;
      if (q && q.remainingFraction !== undefined) add(model.displayName || id, (1 - Number(q.remainingFraction)) * 100, q.resetTime);
    }
  }
  return { windows, plan: data.plan_type || null, credits: data.credits?.unlimited ? 'Unlimited' : data.credits?.balance ?? null };
}
export async function collect(config, fetcher = fetch) {
  if (!config?.url || !config?.managementKey) throw new Error('Connect to CLIProxyAPI using Connection settings.');
  const url = new URL(config.url);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('Use an HTTP(S) server URL without credentials, query, or fragment.');
  const base = url.href.replace(/\/$/, '').replace(/\/v0\/management$/, '');
  async function request(route, body) {
    let response;
    try {
      response = await fetcher(base + '/v0/management/' + route, { method: body ? 'POST' : 'GET', headers: { Authorization: `Bearer ${config.managementKey}`, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(12000), redirect: 'error' });
    } catch { throw new Error('Cannot reach CLIProxyAPI. Check the server URL and connection.'); }
    if (!response.ok) throw new Error(response.status === 401 || response.status === 403 ? 'Management key rejected. Check Connection settings and remote-management access.' : `Management API: HTTP ${response.status}`);
    return response.json();
  }
  const listing = await request('auth-files');
  if (!Array.isArray(listing.files)) throw new Error('Unexpected account list from CLIProxyAPI.');
  const accounts = [];
  // Bound concurrency to avoid overwhelming the proxy or provider.
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(3, listing.files.length) }, async () => {
    while (cursor < listing.files.length) {
      const index = cursor++;
      const file = listing.files[index];
      const provider = String(file.provider || file.type || 'unknown').toLowerCase();
      const account = { id: provider + ':' + (file.id || file.name || file.auth_index || file.authIndex || file.email), provider, name: file.email || file.label || file.name || 'Account', disabled: !!file.disabled, windows: [], error: null };
      accounts[index] = account;
      if (account.disabled) { account.error = 'Disabled in CLIProxyAPI'; continue; }
      const endpoints = { codex: 'https://chatgpt.com/backend-api/wham/usage', claude: 'https://api.anthropic.com/api/oauth/usage', antigravity: 'https://cloudcode-pa.googleapis.com/v1internal:fetchAvailableModels' };
      if (!endpoints[provider]) { account.error = 'Quota lookup not supported for this provider'; continue; }
      const authIndex = file.auth_index ?? file.authIndex;
      if (authIndex === undefined || authIndex === null || authIndex === '') { account.error = 'Missing account auth index'; continue; }
      try {
        const header = { Authorization: 'Bearer $TOKEN$', 'Content-Type': 'application/json' };
        if (provider === 'claude') { header['anthropic-beta'] = 'oauth-2025-04-20'; header['User-Agent'] = 'claude-cli/2.1.280 (external, cli)'; }
        if (provider === 'codex') {
          const id = file.id_token?.chatgpt_account_id || file.chatgpt_account_id || file.account_id;
          if (id) header['Chatgpt-Account-Id'] = String(id);
        }
        const result = await request('api-call', { authIndex: String(authIndex), method: provider === 'antigravity' ? 'POST' : 'GET', url: endpoints[provider], header, ...(provider === 'antigravity' ? { data: JSON.stringify({ project: file.project_id || file.metadata?.project_id }) } : {}) });
        if (result.status_code < 200 || result.status_code >= 300 || !result.status_code) throw new Error(`Provider quota: HTTP ${result.status_code || 'unknown'}`);
        const payload = typeof result.body === 'string' ? JSON.parse(result.body) : result.body;
        Object.assign(account, normalize(provider, payload || {}));
        if (!account.windows.length) account.error = 'No quota windows reported';
      } catch (error) { account.error = error instanceof SyntaxError ? 'Invalid quota response' : error.message; }
    }
  }));
  return { updatedAt: new Date().toISOString(), server: url.host, accounts };
}
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  try {
    let config;
    try { config = JSON.parse(await fs.readFile(configPath, 'utf8')); }
    catch (e) { throw new Error(e.code === 'ENOENT' ? 'Connect to CLIProxyAPI using Connection settings.' : 'Cannot read connection settings. Open Connection settings to repair them.'); }
    console.log(JSON.stringify(await collect(config)));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
