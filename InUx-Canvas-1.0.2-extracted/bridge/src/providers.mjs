import { spawn } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import path from "node:path";

const DEFAULT_CODEX_AUTH_FILE = path.join(
  process.env.CODEX_HOME || path.join(homedir(), ".codex"),
  "auth.json",
);
const DEFAULT_CODEX_RESPONSES_URL = "https://chatgpt.com/backend-api/codex";
const DEFAULT_HERMES_CONFIG_FILE = path.join(homedir(), ".hermes", "config.yaml");
const DEFAULT_HERMES_COMMAND = [path.join(homedir(), ".local", "bin", "hermes")];
const MAX_IMAGE_BYTES = 50 * 1024 * 1024;

function aspectRatio(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (["landscape", "portrait", "square"].includes(normalized)) return normalized;
  const match = normalized.match(/^(\d+(?:\.\d+)?)\s*[:x]\s*(\d+(?:\.\d+)?)$/);
  if (!match) return "square";
  const ratio = Number(match[1]) / Number(match[2]);
  if (ratio > 1.1) return "landscape";
  if (ratio < 0.9) return "portrait";
  return "square";
}

function codexImageSize(value, resolution = "") {
  const normalized = String(value || "").trim().toLowerCase();
  const explicit = normalized.match(/^(\d+)\s*x\s*(\d+)$/);
  if (explicit) {
    const width = Number(explicit[1]);
    const height = Number(explicit[2]);
    const pixels = width * height;
    if (
      width % 16 !== 0 ||
      height % 16 !== 0 ||
      Math.max(width, height) > 3840 ||
      Math.max(width, height) / Math.min(width, height) > 3 ||
      pixels < 655_360 ||
      pixels > 8_294_400
    ) {
      throw new Error("GPT Image 2 尺寸必须为 16 的倍数、边长不超过 3840、比例不超过 3:1，且总像素在 655360–8294400 之间");
    }
    return `${width}x${height}`;
  }

  let ratio = 1;
  if (normalized === "landscape") ratio = 3 / 2;
  else if (normalized === "portrait") ratio = 2 / 3;
  else {
    const match = normalized.match(/^(\d+(?:\.\d+)?)\s*[:x]\s*(\d+(?:\.\d+)?)$/);
    if (match) ratio = Number(match[1]) / Number(match[2]);
  }
  ratio = Math.max(1 / 3, Math.min(3, ratio));
  const tier = String(resolution || "").toLowerCase();
  const longEdge = tier === "4k" ? 3840 : tier === "2k" ? 2048 : ratio === 1 ? 1024 : 1536;
  let width = ratio >= 1 ? longEdge : longEdge * ratio;
  let height = ratio >= 1 ? longEdge / ratio : longEdge;
  const maxPixels = 8_294_400;
  if (width * height > maxPixels) {
    const scale = Math.sqrt(maxPixels / (width * height));
    width *= scale;
    height *= scale;
  }
  width = Math.max(16, Math.round(width / 16) * 16);
  height = Math.max(16, Math.round(height / 16) * 16);
  return `${width}x${height}`;
}

function operationPrompt(payload) {
  const prompt = String(payload.prompt || "").trim();
  if (payload.operation === "variation") {
    return `Create a distinct but close variation of the first input image. Preserve its identity, subject, and visual language while varying composition or details. ${prompt}`.trim();
  }
  if (payload.operation === "outpaint") {
    return `Outpaint the first input image to fill the requested output dimensions. Preserve the original image content and extend the surrounding scene naturally beyond its existing boundaries. ${prompt}`.trim();
  }
  if (payload.operation === "edit") {
    return `Use the first input image as the base canvas. Preserve its exact composition, aspect ratio, dimensions, style, colors, textures, and all details not explicitly requested to change. Add or modify only what the user asks for; do not recreate or reinterpret the scene. ${prompt}`.trim();
  }
  return prompt;
}

function codexImageModel(model, quality) {
  const requested = String(model || "").trim();
  if (/^gpt-image-2-(low|medium|high)$/.test(requested)) return requested;
  const tier = ["low", "medium", "high"].includes(String(quality || "").toLowerCase())
    ? String(quality).toLowerCase()
    : "medium";
  return `gpt-image-2-${tier}`;
}

function decodeJwtClaims(token) {
  try {
    const encoded = String(token).split(".")[1];
    if (!encoded) return {};
    return JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  } catch {
    return {};
  }
}

async function readCodexAccessToken(authFile) {
  let auth;
  try {
    auth = JSON.parse(await readFile(authFile, "utf8"));
  } catch (error) {
    throw new Error(`无法读取 Codex CLI 登录信息：${error.message}`);
  }
  const accessToken = auth?.tokens?.access_token;
  if (typeof accessToken !== "string" || !accessToken.trim()) {
    throw new Error("Codex CLI 尚未登录，请先运行 codex login");
  }
  const claims = decodeJwtClaims(accessToken);
  if (claims.exp && Date.now() >= Number(claims.exp) * 1000) {
    throw new Error("Codex CLI 登录已过期，请重新运行 codex login");
  }
  return { accessToken: accessToken.trim(), claims };
}

function yamlScalar(value) {
  const source = String(value || "").trim();
  let quote = "";
  let commentAt = -1;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if ((character === '"' || character === "'") && source[index - 1] !== "\\") {
      quote = quote === character ? "" : quote || character;
    } else if (
      character === "#" &&
      !quote &&
      (index === 0 || /\s/.test(source[index - 1]))
    ) {
      commentAt = index;
      break;
    }
  }
  const trimmed = source.slice(0, commentAt < 0 ? undefined : commentAt).trim();
  let scalar = trimmed;
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    scalar = trimmed.slice(1, -1);
  }
  return scalar.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (match, name) =>
    Object.hasOwn(process.env, name) ? process.env[name] : match,
  );
}

function yamlTopLevelBlock(config, name) {
  const lines = String(config || "").split(/\r?\n/);
  const start = lines.findIndex((line) => new RegExp(`^${name}:\\s*(?:#.*)?$`).test(line));
  if (start < 0) return [];
  const block = [];
  for (const line of lines.slice(start + 1)) {
    if (line.trim() && !/^[ \t]/.test(line)) break;
    block.push(line);
  }
  return block;
}

function yamlModelEntries(lines, list) {
  const entries = [];
  let current = {};
  const flush = () => {
    const model = yamlScalar(current.model);
    const provider = yamlScalar(current.provider);
    if (model) entries.push({ model, provider });
    current = {};
  };
  for (const rawLine of lines) {
    let line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    if (list && line.startsWith("-")) {
      flush();
      line = line.slice(1).trim();
    }
    const match = line.match(/^(provider|model):\s*(.+)$/);
    if (match) current[match[1]] = match[2];
  }
  flush();
  return entries;
}

function hermesModelSelections(config) {
  const modelBlock = String(config || "").match(/^model:\s*\n((?:[ \t]+.*(?:\n|$))*)/m)?.[1] || "";
  const primary = {
    model: yamlScalar(modelBlock.match(/^\s+default:\s*(.+)$/m)?.[1]),
    provider: yamlScalar(modelBlock.match(/^\s+provider:\s*(.+)$/m)?.[1]),
  };
  const candidates = [
    primary,
    ...yamlModelEntries(yamlTopLevelBlock(config, "fallback_providers"), true),
    ...yamlModelEntries(yamlTopLevelBlock(config, "fallback_model"), false),
  ];
  const seenModels = new Set();
  return candidates.filter(({ model }) => {
    if (!model || seenModels.has(model)) return false;
    seenModels.add(model);
    return true;
  });
}

async function createHermesImageAttachment(imageUrls) {
  const dataUrls = (Array.isArray(imageUrls) ? imageUrls : []).filter((value) =>
    String(value || "").startsWith("data:image/"),
  );
  if (dataUrls.length > 1) {
    throw new Error("当前 Hermes 原生附件 fallback 只支持 1 张参考图，请启用 Codex 视觉分析");
  }
  const dataUrl = dataUrls[0];
  if (!dataUrl) return null;
  const match = String(dataUrl).match(
    /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/,
  );
  if (!match) throw new Error("Hermes 参考图片必须是 PNG、JPEG 或 WebP Data URL");
  const bytes = Buffer.from(match[2], "base64");
  if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) {
    throw new Error("Hermes 参考图片为空或超过 50 MB 安全限制");
  }
  const extension = match[1] === "image/jpeg" ? "jpg" : match[1].split("/")[1];
  const directory = await mkdtemp(path.join(tmpdir(), "beemax-hermes-image-"));
  const imagePath = path.join(directory, `reference.${extension}`);
  try {
    await writeFile(imagePath, bytes, { mode: 0o600 });
    return { directory, imagePath };
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}

function runHermesText(command, args, { signal, timeoutMs }) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason || new Error("Hermes 文本任务已取消"));
      return;
    }
    const [executable, ...baseArgs] = command;
    const child = spawn(executable, [...baseArgs, ...args], {
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout = [];
    const stderr = [];
    let outputBytes = 0;
    let timedOut = false;
    let forceKill;
    const maxOutputBytes = 2 * 1024 * 1024;
    const terminate = () => {
      child.kill("SIGTERM");
      forceKill ||= setTimeout(() => {
        if (child.exitCode === null) child.kill("SIGKILL");
      }, 2_000);
    };
    const abort = () => terminate();
    const timeout = setTimeout(() => {
      timedOut = true;
      terminate();
    }, timeoutMs);
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
    child.stdout.on("data", (chunk) => {
      outputBytes += chunk.length;
      if (outputBytes > maxOutputBytes) terminate();
      else stdout.push(chunk);
    });
    child.stderr.on("data", (chunk) => {
      outputBytes += chunk.length;
      if (outputBytes > maxOutputBytes) terminate();
      else stderr.push(chunk);
    });
    child.once("error", (error) => {
      clearTimeout(timeout);
      clearTimeout(forceKill);
      signal?.removeEventListener("abort", abort);
      reject(error);
    });
    child.once("close", (code, processSignal) => {
      clearTimeout(timeout);
      clearTimeout(forceKill);
      signal?.removeEventListener("abort", abort);
      if (signal?.aborted) {
        reject(signal.reason || new Error("Hermes 文本任务已取消"));
        return;
      }
      if (outputBytes > maxOutputBytes) {
        reject(new Error("Hermes 文本输出超过 2 MB 限制"));
        return;
      }
      if (timedOut) {
        reject(new Error(`Hermes 文本生成超时（${Math.round(timeoutMs / 1000)} 秒）`));
        return;
      }
      if (code !== 0) {
        const detail = Buffer.concat(stderr).toString("utf8").trim();
        reject(
          new Error(
            `Hermes 文本生成失败 (${code ?? processSignal ?? "unknown"})${detail ? `: ${detail.slice(-800)}` : ""}`,
          ),
        );
        return;
      }
      const text = Buffer.concat(stdout)
        .toString("utf8")
        .replace(/\u001b\[[0-9;]*m/g, "")
        .trim();
      if (!text) {
        reject(new Error("Hermes 未返回文本"));
        return;
      }
      resolve(text);
    });
  });
}

export async function createHermesTextProvider({
  configFile = DEFAULT_HERMES_CONFIG_FILE,
  command = DEFAULT_HERMES_COMMAND,
  timeoutMs = 300_000,
  visionAnalyzer,
} = {}) {
  if (
    !Array.isArray(command) ||
    command.length === 0 ||
    command.some((part) => typeof part !== "string" || !part.trim())
  ) {
    throw new Error("Hermes command must be an array of non-empty strings");
  }
  if (path.isAbsolute(command[0])) {
    await access(command[0], fsConstants.X_OK);
  }
  const selections = hermesModelSelections(await readFile(configFile, "utf8"));
  const selection = selections[0];
  if (!selection?.model) throw new Error("Hermes 尚未配置默认文本模型");
  const selectionByModel = new Map(selections.map((candidate) => [candidate.model, candidate]));
  return {
    id: "hermes-agent",
    capabilities: {
      generate: false,
      text: true,
      cancel: true,
    },
    textModels: selections.map((candidate) => candidate.model),
    defaultTextModel: selection.model,
    async generateText(payload, { signal } = {}) {
      const model = String(payload.model || selection.model);
      const requestedSelection = selectionByModel.get(model);
      if (!requestedSelection) throw new Error(`Hermes 未配置文本模型：${model}`);
      const imageUrls = Array.isArray(payload.imageUrls) ? payload.imageUrls : [];
      let visionSummary = "";
      if (imageUrls.length > 0 && typeof visionAnalyzer === "function") {
        try {
          visionSummary = await visionAnalyzer(
            {
              imageUrls,
              prompt: "请完整描述这些参考图片的主体、构图、颜色、文字及彼此关系。",
            },
            { signal },
          );
        } catch (error) {
          if (signal?.aborted) throw error;
          // A Hermes installation with native or auxiliary vision can still handle the image.
        }
      }
      const combinedPrompt = [
        payload.systemPrompt ? `系统指令：\n${payload.systemPrompt}` : "",
        visionSummary ? `参考图片视觉摘要：\n${visionSummary}` : "",
        `用户请求：\n${String(payload.userPrompt || "")}`,
        "直接输出最终文本，不要描述执行过程。",
      ]
        .filter(Boolean)
        .join("\n\n");
      const attachment = visionSummary ? null : await createHermesImageAttachment(imageUrls);
      try {
        const args = attachment
          ? [
              "chat",
              "-q",
              combinedPrompt,
              "--image",
              attachment.imagePath,
              "-Q",
              "-m",
              model,
              "--ignore-rules",
              "--source",
              "beemax-canvas",
              "--max-turns",
              "2",
            ]
          : ["-z", combinedPrompt, "-m", model, "--ignore-rules"];
        if (requestedSelection.provider) args.push("--provider", requestedSelection.provider);
        const text = await runHermesText(command, args, { signal, timeoutMs });
        return { text, model, provider: requestedSelection.provider };
      } finally {
        if (attachment) {
          await rm(attachment.directory, { recursive: true, force: true });
        }
      }
    },
  };
}

function findImageBase64(value) {
  let found = "";
  if (Array.isArray(value)) {
    for (const child of value) found = findImageBase64(child) || found;
    return found;
  }
  if (!value || typeof value !== "object") return "";
  if (value.type === "image_generation_call" && typeof value.result === "string") {
    found = value.result;
  }
  if (typeof value.partial_image_b64 === "string") found = value.partial_image_b64;
  for (const child of Object.values(value)) {
    if (typeof child === "object" && child !== null) {
      found = findImageBase64(child) || found;
    }
  }
  return found;
}

function responseOutputText(value) {
  if (!value || typeof value !== "object") return "";
  if (value.type === "output_text" && typeof value.text === "string") return value.text;
  if (typeof value.output_text === "string") return value.output_text;
  for (const child of Object.values(value)) {
    if (child && typeof child === "object") {
      const found = Array.isArray(child)
        ? child.map(responseOutputText).find(Boolean)
        : responseOutputText(child);
      if (found) return found;
    }
  }
  return "";
}

function codexHeaders(accessToken, claims) {
  const headers = {
    accept: "application/json",
    authorization: `Bearer ${accessToken}`,
    "content-type": "application/json",
    originator: "codex_cli_rs",
    "user-agent": "codex_cli_rs/0.0.0 (BeeMax Canvas)",
  };
  const accountId = claims?.["https://api.openai.com/auth"]?.chatgpt_account_id;
  if (typeof accountId === "string" && accountId) {
    headers["chatgpt-account-id"] = accountId;
  }
  return headers;
}

async function collectCodexImage(response) {
  if (!response.body) throw new Error("Codex Responses API 返回空响应");
  const decoder = new TextDecoder();
  let buffer = "";
  let imageBase64 = "";
  let totalBytes = 0;

  const consumeEvent = (rawEvent) => {
    const data = rawEvent
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n")
      .trim();
    if (!data || data === "[DONE]") return;
    const found = findImageBase64(JSON.parse(data));
    if (found) imageBase64 = found;
  };

  for await (const chunk of response.body) {
    totalBytes += chunk.length;
    if (totalBytes > MAX_IMAGE_BYTES * 2) {
      throw new Error("Codex 图片响应超过 100 MB 安全限制");
    }
    buffer += decoder.decode(chunk, { stream: true });
    let boundary;
    while ((boundary = buffer.search(/\r?\n\r?\n/)) >= 0) {
      const event = buffer.slice(0, boundary);
      const separator = buffer.slice(boundary).match(/^\r?\n\r?\n/)[0];
      buffer = buffer.slice(boundary + separator.length);
      if (event.trim()) consumeEvent(event);
    }
  }
  buffer += decoder.decode();
  if (buffer.trim()) consumeEvent(buffer);
  if (!imageBase64) throw new Error("Codex 响应中没有 image_generation_call 结果");
  const bytes = Buffer.from(imageBase64, "base64");
  if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) {
    throw new Error("Codex 图片为空或超过 50 MB 安全限制");
  }
  return bytes;
}

async function collectCodexText(response) {
  if (!response.body) throw new Error("Codex 视觉分析返回空响应");
  const decoder = new TextDecoder();
  let buffer = "";
  let output = "";
  let totalBytes = 0;

  const consumeEvent = (rawEvent) => {
    const data = rawEvent
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n")
      .trim();
    if (!data || data === "[DONE]") return;
    const event = JSON.parse(data);
    if (event.type === "response.output_text.delta" && typeof event.delta === "string") {
      output += event.delta;
      return;
    }
    if (!output) output = responseOutputText(event);
  };

  for await (const chunk of response.body) {
    totalBytes += chunk.length;
    if (totalBytes > 2 * 1024 * 1024) {
      throw new Error("Codex 视觉摘要超过 2 MB 安全限制");
    }
    buffer += decoder.decode(chunk, { stream: true });
    let boundary;
    while ((boundary = buffer.search(/\r?\n\r?\n/)) >= 0) {
      const event = buffer.slice(0, boundary);
      const separator = buffer.slice(boundary).match(/^\r?\n\r?\n/)[0];
      buffer = buffer.slice(boundary + separator.length);
      if (event.trim()) consumeEvent(event);
    }
  }
  buffer += decoder.decode();
  if (buffer.trim()) consumeEvent(buffer);
  if (!output.trim()) throw new Error("Codex 视觉分析未返回文本摘要");
  return output.trim();
}

export function createDirectCodexProvider({
  authFile = DEFAULT_CODEX_AUTH_FILE,
  baseUrl = DEFAULT_CODEX_RESPONSES_URL,
  timeoutMs = 300_000,
} = {}) {
  const endpoint = `${baseUrl.replace(/\/$/, "")}/responses`;
  return {
    id: "codex-native",
    capabilities: {
      generate: true,
      edit: true,
      mask: true,
      outpaint: true,
      variation: true,
      references: 10,
      cancel: true,
      progress: false,
    },
    async analyzeImages({ imageUrls, prompt }, { signal } = {}) {
      const { accessToken, claims } = await readCodexAccessToken(authFile);
      const attempt = new AbortController();
      const abortFromTask = () =>
        attempt.abort(signal?.reason || new Error("Codex 视觉分析已取消"));
      if (signal?.aborted) abortFromTask();
      signal?.addEventListener("abort", abortFromTask, { once: true });
      const timeout = setTimeout(
        () => attempt.abort(new Error(`Codex 视觉分析超时（${Math.round(timeoutMs / 1000)} 秒）`)),
        timeoutMs,
      );
      try {
        const response = await fetch(endpoint, {
          method: "POST",
          headers: { ...codexHeaders(accessToken, claims), accept: "text/event-stream" },
          body: JSON.stringify({
            model: process.env.BEEMAX_CODEX_VISION_MODEL || "gpt-5.4",
            instructions:
              "准确分析参考图片，只描述图片中实际可见的信息，不要执行工具或询问补充信息。",
            input: [
              {
                role: "user",
                content: [
                  {
                    type: "input_text",
                    text: String(prompt || "请描述参考图片的主体、构图、颜色、文字和关键细节。"),
                  },
                  ...(Array.isArray(imageUrls)
                    ? imageUrls.map((imageUrl) => ({
                        type: "input_image",
                        image_url: String(imageUrl),
                      }))
                    : []),
                ],
              },
            ],
            stream: true,
            store: false,
          }),
          signal: attempt.signal,
        });
        if (!response.ok) {
          const raw = await response.text();
          let body = {};
          try {
            body = JSON.parse(raw || "{}");
          } catch {
            // Preserve the stable HTTP error below when the endpoint returns plain text.
          }
          throw new Error(
            body?.error?.message || body?.detail || `Codex 视觉分析失败 (HTTP ${response.status})`,
          );
        }
        return await collectCodexText(response);
      } finally {
        clearTimeout(timeout);
        signal?.removeEventListener("abort", abortFromTask);
      }
    },
    async generate(payload, { signal }) {
      const { accessToken, claims } = await readCodexAccessToken(authFile);
      const attempt = new AbortController();
      const abortFromTask = () =>
        attempt.abort(signal.reason || new Error("Codex 图片任务已取消"));
      if (signal?.aborted) abortFromTask();
      signal?.addEventListener("abort", abortFromTask, { once: true });
      const timeout = setTimeout(
        () => attempt.abort(new Error(`Codex 图片生成超时（${Math.round(timeoutMs / 1000)} 秒）`)),
        timeoutMs,
      );
      const aspect = aspectRatio(payload.size || payload.aspect_ratio);
      const model = codexImageModel(payload.model, payload.quality);
      const quality = model.slice("gpt-image-2-".length);
      const headers = { ...codexHeaders(accessToken, claims), accept: "text/event-stream" };
      try {
        const content = [
          { type: "input_text", text: operationPrompt(payload) },
          ...(Array.isArray(payload.input_images)
            ? payload.input_images.map((reference) => ({
                type: "input_image",
                image_url: String(reference.url || reference.image_url || reference),
              }))
            : []),
        ];
        const imageTool = {
          type: "image_generation",
          model: "gpt-image-2",
          size: ["edit", "mask", "variation"].includes(payload.operation)
            ? "auto"
            : codexImageSize(payload.size || payload.aspect_ratio, payload.resolution),
          quality,
          output_format: "png",
          background: "opaque",
          partial_images: 1,
        };
        if (payload.mask_image) {
          imageTool.input_image_mask = {
            image_url: String(
              payload.mask_image.url || payload.mask_image.image_url || payload.mask_image,
            ),
          };
        }
        const response = await fetch(endpoint, {
          method: "POST",
          headers,
          signal: attempt.signal,
          body: JSON.stringify({
            model: "gpt-5.4",
            store: false,
            instructions:
              "You are an assistant that must fulfill image generation requests by using the image_generation tool when provided.",
            input: [
              {
                type: "message",
                role: "user",
                content,
              },
            ],
            tools: [
              imageTool,
            ],
            tool_choice: {
              type: "allowed_tools",
              mode: "required",
              tools: [{ type: "image_generation" }],
            },
            stream: true,
          }),
        });
        if (!response.ok) {
          const detail = (await response.text()).slice(0, 500);
          throw new Error(`Codex Responses API 返回 HTTP ${response.status}${detail ? `: ${detail}` : ""}`);
        }
        return {
          bytes: await collectCodexImage(response),
          contentType: "image/png",
          metadata: {
            provider: "openai-codex",
            model,
            aspect_ratio: aspect,
            operation: payload.operation || "generate",
            auth_source: "codex-cli",
          },
        };
      } finally {
        clearTimeout(timeout);
        signal?.removeEventListener("abort", abortFromTask);
      }
    },
  };
}

function runCommand(command, input, { signal, env }) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason || new Error("Codex 图片任务已取消"));
      return;
    }
    const [executable, ...args] = command;
    const child = spawn(executable, args, {
      env: { ...process.env, ...env },
      stdio: ["pipe", "pipe", "pipe"],
    });
    const stdout = [];
    const stderr = [];
    let outputBytes = 0;
    const maxOutputBytes = 2 * 1024 * 1024;

    const abort = () => child.kill("SIGTERM");
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
    child.stdout.on("data", (chunk) => {
      outputBytes += chunk.length;
      if (outputBytes > maxOutputBytes) {
        child.kill("SIGTERM");
        return;
      }
      stdout.push(chunk);
    });
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.once("error", reject);
    child.once("close", (code, processSignal) => {
      signal?.removeEventListener("abort", abort);
      if (signal?.aborted) {
        reject(signal.reason || new Error("Codex 图片任务已取消"));
        return;
      }
      if (outputBytes > maxOutputBytes) {
        reject(new Error("Codex Provider 输出超过 2 MB 限制"));
        return;
      }
      if (code !== 0) {
        const detail = Buffer.concat(stderr).toString("utf8").trim();
        reject(
          new Error(
            `Codex Provider 退出异常 (${code ?? processSignal ?? "unknown"})${detail ? `: ${detail.slice(-800)}` : ""}`,
          ),
        );
        return;
      }
      resolve(Buffer.concat(stdout).toString("utf8"));
    });
    child.stdin.end(`${JSON.stringify(input)}\n`);
  });
}

function parseProviderOutput(output) {
  const lines = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    try {
      return JSON.parse(lines[index]);
    } catch {
      // Provider dependencies may emit informational lines before the result.
    }
  }
  throw new Error("Codex Provider 未返回合法 JSON");
}

export function createCommandCodexProvider({
  command,
  env = {},
  timeoutMs = 300_000,
  capabilities = {},
} = {}) {
  if (!Array.isArray(command) || command.length === 0) {
    throw new Error("command Codex provider requires a command array");
  }

  return {
    id: "codex-native",
    capabilities: {
      generate: true,
      edit: false,
      mask: false,
      outpaint: false,
      variation: false,
      references: 0,
      cancel: true,
      progress: false,
      ...capabilities,
    },
    async analyzeImages({ imageUrls, prompt }, { signal } = {}) {
      const input = {
        operation: "analyze",
        prompt: String(prompt || ""),
        input_images: Array.isArray(imageUrls) ? imageUrls : [],
      };
      const attempt = new AbortController();
      const abortFromTask = () =>
        attempt.abort(signal?.reason || new Error("Codex 视觉分析已取消"));
      if (signal?.aborted) abortFromTask();
      signal?.addEventListener("abort", abortFromTask, { once: true });
      const timeout = setTimeout(
        () => attempt.abort(new Error(`Codex 视觉分析超时（${Math.round(timeoutMs / 1000)} 秒）`)),
        timeoutMs,
      );
      try {
        const output = await runCommand(command, input, {
          signal: attempt.signal,
          env,
        });
        const result = parseProviderOutput(output);
        if (!result.success) throw new Error(result.error || "Codex 视觉分析失败");
        const text = String(result.text || result.response || "").trim();
        if (!text) throw new Error("Codex Provider 成功响应缺少视觉摘要文本");
        return text;
      } finally {
        clearTimeout(timeout);
        signal?.removeEventListener("abort", abortFromTask);
      }
    },
    async generate(payload, { signal, task }) {
      const input = {
        operation: String(payload.operation || "generate"),
        prompt: String(payload.prompt || ""),
        model: codexImageModel(payload.model, payload.quality),
        aspect_ratio: aspectRatio(payload.size || payload.aspect_ratio),
        quality: String(payload.quality || ""),
        input_images: Array.isArray(payload.input_images) ? payload.input_images : [],
        mask_image: payload.mask_image || null,
        output_path: path.join(tmpdir(), `${task.task_id}.png`),
      };
      const attempt = new AbortController();
      const abortFromTask = () =>
        attempt.abort(signal.reason || new Error("Codex 图片任务已取消"));
      if (signal?.aborted) abortFromTask();
      signal?.addEventListener("abort", abortFromTask, { once: true });
      const timeout = setTimeout(
        () => attempt.abort(new Error(`Codex 图片生成超时（${Math.round(timeoutMs / 1000)} 秒）`)),
        timeoutMs,
      );
      let output;
      try {
        output = await runCommand(command, input, {
          signal: attempt.signal,
          env,
        });
      } finally {
        clearTimeout(timeout);
        signal?.removeEventListener("abort", abortFromTask);
      }
      const result = parseProviderOutput(output);
      if (!result.success) {
        throw new Error(result.error || "Codex 图片生成失败");
      }
      if (!result.image) {
        throw new Error("Codex Provider 成功响应缺少图片路径");
      }
      return {
        bytes: await readFile(result.image),
        contentType: result.content_type || "image/png",
        metadata: {
          provider: result.provider || "openai-codex",
          model: result.model || input.model,
          aspect_ratio: result.aspect_ratio || input.aspect_ratio,
          ...result.extra,
        },
      };
    },
  };
}

async function jsonResponse(response, context) {
  const text = await response.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error(`${context}返回了非 JSON 响应 (HTTP ${response.status})`);
  }
  if (!response.ok) {
    throw new Error(body.error || `${context}失败 (HTTP ${response.status})`);
  }
  return body;
}

function firstImageUrl(task) {
  const candidates = [
    ...(Array.isArray(task.server_urls) ? task.server_urls : []),
    ...(Array.isArray(task.image_urls) ? task.image_urls : []),
    ...(Array.isArray(task.source_urls) ? task.source_urls : []),
    ...(Array.isArray(task.result?.image_urls) ? task.result.image_urls : []),
    task.result?.url,
    task.image_url,
  ];
  return candidates.find((value) => typeof value === "string" && value.trim()) || "";
}

export function createRelayProvider({
  upstreamUrl,
  apiBaseUrl = process.env.BEEMAX_RELAY_BASE_URL || "",
  apiKey = process.env.BEEMAX_RELAY_API_KEY || "",
  timeoutMs = 300_000,
} = {}) {
  if (!upstreamUrl) throw new Error("relay upstreamUrl is required");
  const upstream = upstreamUrl.replace(/\/$/, "");

  return {
    id: "relay-main",
    capabilities: {
      generate: true,
      edit: false,
      mask: false,
      references: 0,
      cancel: true,
      progress: false,
    },
    async generate(payload, { signal }) {
      if (!apiBaseUrl) throw new Error("中转站 Base URL 未配置");
      if (!apiKey) throw new Error("中转站 API Key 未配置");
      const attempt = new AbortController();
      const abortFromTask = () =>
        attempt.abort(signal.reason || new Error("中转站图片任务已取消"));
      if (signal?.aborted) abortFromTask();
      signal?.addEventListener("abort", abortFromTask, { once: true });
      const timeout = setTimeout(
        () => attempt.abort(new Error(`中转站图片任务超时（${Math.round(timeoutMs / 1000)} 秒）`)),
        timeoutMs,
      );
      try {
        const submitted = await jsonResponse(
          await fetch(`${upstream}/api/image`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            signal: attempt.signal,
            body: JSON.stringify({
              ...payload,
              api_base_url: apiBaseUrl,
              api_key: apiKey,
              async_mode: false,
              n: 1,
            }),
          }),
          "中转站图片生成",
        );
        if (!submitted.success) {
          throw new Error(submitted.error || "中转站图片生成失败");
        }
        const result = submitted.data && typeof submitted.data === "object"
          ? submitted.data
          : submitted;
        const imageUrl = firstImageUrl(result);
        if (!imageUrl) {
          throw new Error("中转站同步响应缺少图片 URL");
        }
        const resolved = new URL(imageUrl, `${upstream}/`);
        if (!["http:", "https:"].includes(resolved.protocol)) {
          throw new Error("中转站图片 URL 协议不受支持");
        }
        if (resolved.origin !== new URL(upstream).origin) {
          throw new Error("中转站图片 URL 必须由原 Canvas 后端代理");
        }
        const resolvedUrl = resolved.toString();
        const imageResponse = await fetch(resolvedUrl, {
          signal: attempt.signal,
          redirect: "manual",
        });
        if (imageResponse.status >= 300 && imageResponse.status < 400) {
          throw new Error("中转站图片下载不允许 HTTP 重定向");
        }
        if (!imageResponse.ok) {
          throw new Error(`下载中转站图片失败 (HTTP ${imageResponse.status})`);
        }
        const bytes = Buffer.from(await imageResponse.arrayBuffer());
        if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) {
          throw new Error("中转站图片为空或超过 50 MB 安全限制");
        }
        return {
          bytes,
          contentType: imageResponse.headers.get("content-type") || "image/png",
          metadata: {
            provider: "relay-main",
            model: payload.model || "",
            upstream_task_id: submitted.task_id || "",
            upstream_status: String(result.status || "completed"),
          },
        };
      } finally {
        clearTimeout(timeout);
        signal?.removeEventListener("abort", abortFromTask);
      }
    },
  };
}

export { aspectRatio };
