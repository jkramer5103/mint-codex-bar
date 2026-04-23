#!/usr/bin/env node

import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { spawn } from "node:child_process";

const CODEX_HOME = process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
const SESSIONS_DIR = path.join(CODEX_HOME, "sessions");
const MODEL_PRICING = {
  "gpt-5.4": {
    inputPerMillion: 2.5,
    cachedInputPerMillion: 0.25,
    outputPerMillion: 15,
  },
  "gpt-5.4-mini": {
    inputPerMillion: 0.75,
    cachedInputPerMillion: 0.075,
    outputPerMillion: 4.5,
  },
  "gpt-5.4-nano": {
    inputPerMillion: 0.2,
    cachedInputPerMillion: 0.02,
    outputPerMillion: 1.25,
  },
};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function safeJsonParse(line) {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

function isoFromEpochSeconds(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }
  return new Date(value * 1000).toISOString();
}

async function queryCodexAppServer() {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "codex",
      ["-s", "read-only", "-a", "never", "app-server"],
      {
        stdio: ["pipe", "pipe", "pipe"],
        env: process.env,
      }
    );

    const pending = new Map();
    let nextId = 1;
    let stdoutBuffer = "";
    let stderrBuffer = "";
    let settled = false;

    const settle = (fn, value) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      try {
        child.kill("SIGTERM");
      } catch {}
      fn(value);
    };

    const timeout = setTimeout(() => {
      settle(reject, new Error("Timed out while talking to codex app-server"));
    }, 7000);

    const request = (method, params) => {
      const id = nextId++;
      child.stdin.write(`${JSON.stringify({ method, id, params })}\n`);
      return new Promise((resolveRequest, rejectRequest) => {
        pending.set(id, { resolve: resolveRequest, reject: rejectRequest });
      });
    };

    const handleLine = (line) => {
      if (!line.trim()) {
        return;
      }

      const message = safeJsonParse(line);
      if (!message) {
        return;
      }

      if (typeof message.id !== "undefined" && pending.has(message.id)) {
        const pendingRequest = pending.get(message.id);
        pending.delete(message.id);

        if (message.error) {
          pendingRequest.reject(
            new Error(message.error.message || "Unknown app-server error")
          );
          return;
        }

        pendingRequest.resolve(message.result);
      }
    };

    child.stdout.on("data", (chunk) => {
      stdoutBuffer += chunk.toString();
      let newlineIndex = stdoutBuffer.indexOf("\n");
      while (newlineIndex !== -1) {
        const line = stdoutBuffer.slice(0, newlineIndex);
        stdoutBuffer = stdoutBuffer.slice(newlineIndex + 1);
        handleLine(line);
        newlineIndex = stdoutBuffer.indexOf("\n");
      }
    });

    child.stderr.on("data", (chunk) => {
      stderrBuffer += chunk.toString();
    });

    child.on("error", (error) => {
      settle(reject, error);
    });

    child.on("exit", (code) => {
      if (!settled && pending.size > 0) {
        settle(
          reject,
          new Error(
            `codex app-server exited early (${code ?? "unknown"}): ${stderrBuffer.trim()}`
          )
        );
      }
    });

    (async () => {
      try {
        await request("initialize", {
          clientInfo: {
            name: "mintCodexBar",
            title: "Mint Codex Bar",
            version: "0.1.0",
          },
          capabilities: null,
        });

        child.stdin.write(`${JSON.stringify({ method: "initialized" })}\n`);

        const [account, rateLimits] = await Promise.all([
          request("account/read", { refreshToken: false }),
          request("account/rateLimits/read", null),
        ]);

        settle(resolve, { account, rateLimits, stderr: stderrBuffer.trim() });
      } catch (error) {
        settle(reject, error);
      }
    })();
  });
}

function midnightUtcKey(date) {
  return new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
    .toISOString()
    .slice(0, 10);
}

function buildRecentDateSet(days) {
  const set = new Set();
  const now = new Date();
  for (let i = 0; i < days; i += 1) {
    const day = new Date(now);
    day.setDate(now.getDate() - i);
    set.add(midnightUtcKey(day));
  }
  return set;
}

function currentMonthKey(date) {
  const year = date.getFullYear().toString().padStart(4, "0");
  const month = (date.getMonth() + 1).toString().padStart(2, "0");
  return `${year}-${month}`;
}

async function listSessionFiles() {
  try {
    const years = await fsp.readdir(SESSIONS_DIR, { withFileTypes: true });
    const files = [];

    for (const yearDir of years) {
      if (!yearDir.isDirectory()) {
        continue;
      }
      const yearPath = path.join(SESSIONS_DIR, yearDir.name);
      const months = await fsp.readdir(yearPath, { withFileTypes: true });
      for (const monthDir of months) {
        if (!monthDir.isDirectory()) {
          continue;
        }
        const monthPath = path.join(yearPath, monthDir.name);
        const days = await fsp.readdir(monthPath, { withFileTypes: true });
        for (const dayDir of days) {
          if (!dayDir.isDirectory()) {
            continue;
          }
          const dayPath = path.join(monthPath, dayDir.name);
          const dayFiles = await fsp.readdir(dayPath, { withFileTypes: true });
          for (const entry of dayFiles) {
            if (entry.isFile() && entry.name.endsWith(".jsonl")) {
              files.push(path.join(dayPath, entry.name));
            }
          }
        }
      }
    }

    return files.sort();
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

async function readSessionMeta(filePath) {
  const stream = fs.createReadStream(filePath, { encoding: "utf8" });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

  try {
    for await (const line of rl) {
      const entry = safeJsonParse(line);
      if (entry && entry.type === "session_meta" && entry.payload) {
        return entry.payload;
      }
    }
  } finally {
    rl.close();
    stream.destroy();
  }

  return null;
}

async function readLatestTokenUsage(filePath) {
  const content = await fsp.readFile(filePath, "utf8");
  const lines = content.split("\n");
  let latest = null;

  for (const line of lines) {
    const entry = safeJsonParse(line);
    if (
      entry &&
      entry.type === "event_msg" &&
      entry.payload &&
      entry.payload.type === "token_count"
    ) {
      latest = entry.payload.info || null;
    }
  }

  if (!latest || !latest.total_token_usage) {
    return null;
  }

  return {
    totalTokens: latest.total_token_usage.total_tokens ?? null,
    inputTokens: latest.total_token_usage.input_tokens ?? null,
    cachedInputTokens: latest.total_token_usage.cached_input_tokens ?? null,
    outputTokens: latest.total_token_usage.output_tokens ?? null,
    lastTurnTokens: latest.last_token_usage
      ? latest.last_token_usage.total_tokens ?? null
      : null,
  };
}

async function readLatestSessionModel(filePath) {
  const content = await fsp.readFile(filePath, "utf8");
  const lines = content.split("\n");
  let latestModel = null;

  for (const line of lines) {
    const entry = safeJsonParse(line);
    if (
      entry &&
      entry.type === "turn_context" &&
      entry.payload &&
      typeof entry.payload.model === "string"
    ) {
      latestModel = entry.payload.model;
    }
  }

  return latestModel;
}

function estimateApiCost(model, tokenUsage) {
  if (!model || !tokenUsage) {
    return null;
  }

  const rates = MODEL_PRICING[model];
  if (!rates) {
    return null;
  }

  const inputTokens = Number(tokenUsage.inputTokens ?? 0);
  const cachedInputTokens = Number(tokenUsage.cachedInputTokens ?? 0);
  const outputTokens = Number(tokenUsage.outputTokens ?? 0);
  const nonCachedInputTokens = Math.max(0, inputTokens - cachedInputTokens);
  const totalCost =
    (nonCachedInputTokens / 1_000_000) * rates.inputPerMillion +
    (cachedInputTokens / 1_000_000) * rates.cachedInputPerMillion +
    (outputTokens / 1_000_000) * rates.outputPerMillion;

  return {
    model,
    inputPerMillion: rates.inputPerMillion,
    cachedInputPerMillion: rates.cachedInputPerMillion,
    outputPerMillion: rates.outputPerMillion,
    totalUsd: totalCost,
  };
}

async function collectLocalSessionStats() {
  const files = await listSessionFiles();
  const todayKey = midnightUtcKey(new Date());
  const recent7 = buildRecentDateSet(7);
  const monthKey = currentMonthKey(new Date());

  let sessionsToday = 0;
  let sessionsLast7Days = 0;
  let sessionsThisMonth = 0;
  let latestSession = null;
  const monthFiles = [];

  for (const filePath of files) {
    const relative = path.relative(SESSIONS_DIR, filePath);
    const parts = relative.split(path.sep);
    const dateKey = `${parts[0]}-${parts[1]}-${parts[2]}`;
    const fileMonthKey = `${parts[0]}-${parts[1]}`;

    if (dateKey === todayKey) {
      sessionsToday += 1;
    }
    if (recent7.has(dateKey)) {
      sessionsLast7Days += 1;
    }
    if (fileMonthKey === monthKey) {
      sessionsThisMonth += 1;
      monthFiles.push(filePath);
    }

    if (!latestSession || filePath > latestSession.filePath) {
      latestSession = { filePath, dateKey };
    }
  }

  if (!latestSession) {
    return {
      totalSessions: 0,
      sessionsToday: 0,
      sessionsLast7Days: 0,
      sessionsThisMonth: 0,
      monthSpend: null,
      latestSession: null,
    };
  }

  const [meta, tokenUsage, model] = await Promise.all([
    readSessionMeta(latestSession.filePath),
    readLatestTokenUsage(latestSession.filePath),
    readLatestSessionModel(latestSession.filePath),
  ]);

  const monthEstimates = await Promise.all(
    monthFiles.map(async (filePath) => {
      const [sessionModel, sessionTokenUsage] = await Promise.all([
        readLatestSessionModel(filePath),
        readLatestTokenUsage(filePath),
      ]);
      return estimateApiCost(sessionModel, sessionTokenUsage);
    })
  );

  const monthSpendTotal = monthEstimates.reduce((sum, estimate) => {
    return sum + (estimate ? estimate.totalUsd : 0);
  }, 0);

  return {
    totalSessions: files.length,
    sessionsToday,
    sessionsLast7Days,
    sessionsThisMonth,
    monthSpend: {
      monthKey,
      totalUsd: monthSpendTotal,
      estimatedSessions: monthEstimates.filter(Boolean).length,
    },
    latestSession: {
      filePath: latestSession.filePath,
      startedAt: meta ? meta.timestamp || null : null,
      cwd: meta ? meta.cwd || null : null,
      projectName: meta && meta.cwd ? path.basename(meta.cwd) : null,
      cliVersion: meta ? meta.cli_version || null : null,
      model,
      source: meta ? meta.source || null : null,
      tokenUsage,
      estimatedCost: estimateApiCost(model, tokenUsage),
    },
  };
}

function normalizeRateLimitWindow(window) {
  if (!window) {
    return null;
  }

  const usedPercent = Number(window.usedPercent ?? 0);
  return {
    usedPercent,
    remainingPercent: Math.max(0, 100 - usedPercent),
    windowMinutes: window.windowDurationMins ?? null,
    resetsAt: isoFromEpochSeconds(window.resetsAt ?? null),
  };
}

async function main() {
  const [live, local] = await Promise.all([
    queryCodexAppServer(),
    collectLocalSessionStats(),
  ]);

  const account = live.account || {};
  const snapshot =
    (live.rateLimits &&
      live.rateLimits.rateLimitsByLimitId &&
      (live.rateLimits.rateLimitsByLimitId.codex || null)) ||
    (live.rateLimits ? live.rateLimits.rateLimits : null);

  const output = {
    source: "codex-app-server + local-session-scan",
    updatedAt: new Date().toISOString(),
    account: {
      email: account.account ? account.account.email || null : null,
      planType: account.account ? account.account.planType || null : null,
      requiresOpenaiAuth: account.requiresOpenaiAuth ?? null,
    },
    rateLimits: snapshot
      ? {
          limitId: snapshot.limitId ?? null,
          limitName: snapshot.limitName ?? null,
          planType: snapshot.planType ?? null,
          primary: normalizeRateLimitWindow(snapshot.primary),
          secondary: normalizeRateLimitWindow(snapshot.secondary),
          credits: snapshot.credits
            ? {
                hasCredits: snapshot.credits.hasCredits ?? false,
                unlimited: snapshot.credits.unlimited ?? false,
                balance: snapshot.credits.balance ?? null,
              }
            : null,
        }
      : null,
    local,
  };

  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
}

main().catch(async (error) => {
  await sleep(10);
  process.stderr.write(`${error.message}\n`);
  process.exit(1);
});
