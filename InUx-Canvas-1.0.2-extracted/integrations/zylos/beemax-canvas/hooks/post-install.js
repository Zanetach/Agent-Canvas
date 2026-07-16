#!/usr/bin/env node

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

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
