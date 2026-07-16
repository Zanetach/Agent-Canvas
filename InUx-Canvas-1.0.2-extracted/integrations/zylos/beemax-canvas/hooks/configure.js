#!/usr/bin/env node

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const zylosHome =
  process.env.ZYLOS_DIR || process.env.ZYLOS_HOME || path.join(os.homedir(), 'zylos');
const dataDir = process.env.ZYLOS_DATA_DIR || path.join(zylosHome, 'components/beemax-canvas');
const configPath = path.join(dataDir, 'config.json');

let raw = '';
process.stdin.setEncoding('utf8');
for await (const chunk of process.stdin) raw += chunk;

try {
  const input = raw.trim() ? JSON.parse(raw) : {};
  if (!input || Array.isArray(input) || typeof input !== 'object') {
    throw new Error('Configure input must be a JSON object');
  }
  if (input.BEEMAX_CANVAS_URL) {
    const url = new URL(String(input.BEEMAX_CANVAS_URL));
    if (!['http:', 'https:'].includes(url.protocol)) {
      throw new Error('BEEMAX_CANVAS_URL must use http:// or https://');
    }
  }
  if (input.BEEMAX_CANVAS_TIMEOUT_SECONDS !== undefined) {
    const timeout = Number(input.BEEMAX_CANVAS_TIMEOUT_SECONDS);
    if (!Number.isFinite(timeout) || timeout <= 0) {
      throw new Error('BEEMAX_CANVAS_TIMEOUT_SECONDS must be a positive number');
    }
  }
  let current = {};
  try {
    current = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const next = {
    ...current,
    ...(input.BEEMAX_CANVAS_URL ? { base_url: input.BEEMAX_CANVAS_URL } : {}),
    ...(input.BEEMAX_CANVAS_TIMEOUT_SECONDS
      ? { timeout_seconds: Number(input.BEEMAX_CANVAS_TIMEOUT_SECONDS) }
      : {}),
  };
  fs.mkdirSync(dataDir, { recursive: true });
  const temporary = `${configPath}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporary, configPath);
  console.log(`[beemax-canvas] Wrote ${configPath}`);
} catch (error) {
  console.error(`[beemax-canvas] Configuration failed: ${error.message}`);
  process.exitCode = 1;
}
