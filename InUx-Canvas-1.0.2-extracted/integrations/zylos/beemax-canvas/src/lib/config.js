import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const DEFAULT_URL = 'http://127.0.0.1:17851';
const DEFAULT_TIMEOUT_SECONDS = 300;

function configPath() {
  const zylosHome =
    process.env.ZYLOS_DIR || process.env.ZYLOS_HOME || path.join(os.homedir(), 'zylos');
  const dataDir = process.env.ZYLOS_DATA_DIR || path.join(zylosHome, 'components/beemax-canvas');
  return path.join(dataDir, 'config.json');
}

function readStoredConfig() {
  try {
    return JSON.parse(fs.readFileSync(configPath(), 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return {};
    throw new Error(`Failed to read BeeMax Canvas config: ${error.message}`);
  }
}

function normalizedUrl(value) {
  const raw = String(value || DEFAULT_URL).trim().replace(/\/+$/, '');
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(`BeeMax Canvas URL must include http:// or https://: ${raw}`);
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error(`Unsupported BeeMax Canvas URL protocol: ${parsed.protocol}`);
  }
  return parsed.toString().replace(/\/$/, '');
}

export function loadConfig(overrides = {}) {
  const stored = readStoredConfig();
  const timeout = Number(
    overrides.timeoutSeconds ??
      process.env.BEEMAX_CANVAS_TIMEOUT_SECONDS ??
      stored.timeout_seconds ??
      DEFAULT_TIMEOUT_SECONDS,
  );
  return {
    baseUrl: normalizedUrl(
      overrides.baseUrl ?? process.env.BEEMAX_CANVAS_URL ?? stored.base_url ?? DEFAULT_URL,
    ),
    timeoutSeconds: Number.isFinite(timeout) && timeout > 0 ? timeout : DEFAULT_TIMEOUT_SECONDS,
  };
}
