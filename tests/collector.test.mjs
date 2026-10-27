import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collect, normalize, windowData } from '../applet/files/mintcodexbar@jaron/fetch-stats.mjs';
test('unknown quota is not shown as full; zero and clamping are preserved', () => {
  assert.equal(windowData('x', null), null);
  assert.equal(windowData('x', 100).remaining, 0);
  assert.equal(windowData('x', -5).remaining, 100);
});
test('Codex supports weekly-only and additional model windows', () => {
  const result = normalize('codex', { rate_limit: { primary_window: { used_percent: 42, limit_window_seconds: 604800, reset_at: 1800000000 } }, additional_rate_limits: [{ limit_name: 'Model', rate_limit: { primary_window: { used_percent: 100 } } }] });
  assert.equal(result.windows[0].label, 'Weekly');
  assert.equal(result.windows[0].remaining, 58);
  assert.equal(result.windows[1].remaining, 0);
});
test('Claude includes model-specific windows without inventing missing ones', () => {
  const result = normalize('claude', { five_hour: { utilization: 5 }, seven_day: null, seven_day_sonnet: { utilization: 40 } });
  assert.deepEqual(result.windows.map(x => x.remaining), [95, 60]);
});
test('management discovery isolates failures and keeps provider tokens on proxy', async () => {
  const calls = [];
  const mock = async (url, options) => {
    calls.push({url, options});
    if (url.endsWith('auth-files')) return { ok: true, json: async () => ({ files: [{ provider: 'codex', auth_index: 'a', email: 'one' }, { provider: 'claude', auth_index: 'b' }, { provider: 'qwen' }, { provider: 'codex', disabled: true }] }) };
    const req = JSON.parse(options.body);
    return { ok: true, json: async () => req.authIndex === 'a' ? ({ status_code: 200, body: JSON.stringify({ rate_limit: { primary_window: { used_percent: 10 } } }) }) : ({ status_code: 429, body: 'private provider error' }) };
  };
  const data = await collect({ url: 'http://localhost:8317/v0/management/', managementKey: 'test-secret' }, mock);
  assert.equal(data.accounts[0].windows[0].remaining, 90);
  assert.match(data.accounts[1].error, /429/);
  assert.match(data.accounts[2].error, /not supported/);
  assert.equal(calls.length, 3);
  assert.equal(JSON.parse(calls[1].options.body).header.Authorization, 'Bearer $TOKEN$');
  assert.ok(!JSON.stringify(data).includes('test-secret'));
});
test('management authentication failure stops before provider calls', async () => {
  let calls = 0;
  await assert.rejects(collect({ url: 'https://example.test', managementKey: 'secret' }, async () => { calls++; return { ok: false, status: 401 }; }), /key rejected/);
  assert.equal(calls, 1);
});
test('window length is reported for the even usage marker', () => {
  assert.equal(normalize('claude', { five_hour: { utilization: 10, resets_at: '2026-01-01T00:00:00Z' } }).windows[0].windowSeconds, 18000);
  assert.equal(normalize('codex', { rate_limit: { secondary_window: { used_percent: 1, limit_window_seconds: 604800 } } }).windows[0].windowSeconds, 604800);
});
