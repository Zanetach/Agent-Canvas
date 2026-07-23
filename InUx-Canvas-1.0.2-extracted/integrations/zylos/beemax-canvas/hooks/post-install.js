#!/usr/bin/env node

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { discoverAgentCapabilities, registerAgentCapabilities } from '../src/index.js';

const zylosHome =
  process.env.ZYLOS_DIR || process.env.ZYLOS_HOME || path.join(os.homedir(), 'zylos');
const dataDir = process.env.ZYLOS_DATA_DIR || path.join(zylosHome, 'components/beemax-canvas');
const configPath = path.join(dataDir, 'config.json');

fs.mkdirSync(dataDir, { recursive: true });
if (!fs.existsSync(configPath)) {
  fs.writeFileSync(
    configPath,
    `${JSON.stringify({ base_url: 'http://127.0.0.1:17851', timeout_seconds: 300 }, null, 2)}\n`,
    { mode: 0o600 },
  );
  console.log(`[beemax-canvas] Created ${configPath}`);
} else {
  console.log(`[beemax-canvas] Preserved existing ${configPath}`);
}

const gateway = String(process.env.BEEMAX_AGENT_GATEWAY_URL || '').trim();
const rawModels = String(process.env.BEEMAX_AGENT_MODELS_JSON || '').trim();
if (gateway) {
  try {
    if (rawModels) {
      await registerAgentCapabilities({
        id: process.env.BEEMAX_AGENT_INSTANCE_ID || 'zylos-agent',
        endpoint: gateway,
        models: JSON.parse(rawModels),
        timeoutSeconds: 2,
      });
    } else {
      await discoverAgentCapabilities({ endpoint: gateway, timeoutSeconds: 2 });
    }
    console.log('[beemax-canvas] Registered Zylos model capabilities with Canvas');
  } catch (error) {
    console.warn(`[beemax-canvas] Canvas registration deferred: ${error.message}`);
  }
}
