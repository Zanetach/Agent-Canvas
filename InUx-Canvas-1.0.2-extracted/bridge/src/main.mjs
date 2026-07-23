import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  createCommandCodexProvider,
  createDirectCodexProvider,
  createHermesTextProvider,
  createRelayProvider,
} from "./providers.mjs";
import { createBridgeServer } from "./server.mjs";

function integerEnv(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function parseCommand(name) {
  const raw = process.env[name];
  if (!raw) return undefined;
  const command = JSON.parse(raw);
  if (
    !Array.isArray(command) ||
    command.length === 0 ||
    command.some((part) => typeof part !== "string" || !part.trim())
  ) {
    throw new Error(`${name} 必须是非空字符串数组`);
  }
  return command;
}

function jsonObjectEnv(name) {
  const raw = process.env[name];
  if (!raw) return {};
  const value = JSON.parse(raw);
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${name} 必须是 JSON 对象`);
  }
  return value;
}

async function legacyRelaySettings(dataRoot) {
  try {
    const settings = JSON.parse(
      await readFile(path.join(dataRoot, "data", "runtime-settings.json"), "utf8"),
    );
    const enabled = Array.isArray(settings.providers)
      ? settings.providers.filter((provider) => provider?.enabled !== false)
      : [];
    const provider =
      enabled.find((candidate) => candidate.id === settings.activeProviderId) || enabled[0];
    return {
      apiBaseUrl: String(provider?.baseUrl || ""),
      apiKey: String(provider?.apiKey || ""),
    };
  } catch {
    return { apiBaseUrl: "", apiKey: "" };
  }
}

const host = process.env.BEEMAX_BRIDGE_HOST || "127.0.0.1";
const port = integerEnv("BEEMAX_BRIDGE_PORT", 17851);
const standalone = process.env.BEEMAX_STANDALONE === "1";
const upstreamUrl = standalone
  ? ""
  : process.env.BEEMAX_UPSTREAM_URL || "http://127.0.0.1:17852";
const dataRoot = process.env.INUX_DATA_DIR || path.resolve(".data");
const dataDir = process.env.BEEMAX_BRIDGE_DATA_DIR || path.join(dataRoot, "beemax-bridge");
const publicOrigin = process.env.BEEMAX_PUBLIC_ORIGIN || `http://${host}:${port}`;
const frontendDir = process.env.BEEMAX_FRONTEND_DIR || "";

const codexCommand = parseCommand("BEEMAX_CODEX_PROVIDER_COMMAND_JSON");
const hermesCommand = parseCommand("BEEMAX_HERMES_COMMAND_JSON");
const codexTimeoutMs = integerEnv("BEEMAX_CODEX_TIMEOUT_MS", 300_000);
const codexProvider = codexCommand
  ? createCommandCodexProvider({
      command: codexCommand,
      timeoutMs: codexTimeoutMs,
      capabilities: jsonObjectEnv("BEEMAX_CODEX_PROVIDER_CAPABILITIES_JSON"),
    })
  : createDirectCodexProvider({ timeoutMs: codexTimeoutMs });
const providers = [codexProvider];

try {
  providers.push(
    await createHermesTextProvider({
      configFile: process.env.BEEMAX_HERMES_CONFIG_FILE || undefined,
      command: hermesCommand,
      timeoutMs: integerEnv("BEEMAX_HERMES_TIMEOUT_MS", 300_000),
      visionAnalyzer:
        typeof codexProvider.analyzeImages === "function"
          ? codexProvider.analyzeImages.bind(codexProvider)
          : undefined,
    }),
  );
} catch (error) {
  console.warn(`[beemax-bridge] Hermes text provider unavailable: ${error.message}`);
}

const legacy = await legacyRelaySettings(dataRoot);
const relayBaseUrl = process.env.BEEMAX_RELAY_BASE_URL || legacy.apiBaseUrl;
const relayApiKey = process.env.BEEMAX_RELAY_API_KEY || legacy.apiKey;
if (relayBaseUrl && relayApiKey) {
  providers.push(
    createRelayProvider({
      upstreamUrl,
      apiBaseUrl: relayBaseUrl,
      apiKey: relayApiKey,
      timeoutMs: integerEnv("BEEMAX_RELAY_TIMEOUT_MS", 300_000),
    }),
  );
}

const server = createBridgeServer({
  dataDir,
  providers,
  publicOrigin,
  upstreamUrl,
  frontendDir,
});

server.on("error", (error) => {
  console.error(`[beemax-bridge] ${error.message}`);
  process.exitCode = 1;
});

server.listen(port, host, () => {
  console.log(`[beemax-bridge] listening on ${publicOrigin}`);
  if (standalone) console.log(`[beemax-bridge] standalone frontend: ${frontendDir}`);
  console.log(`[beemax-bridge] provider route: ${providers.map((provider) => provider.id).join(" -> ")}`);
});

function shutdown() {
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5_000).unref();
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
