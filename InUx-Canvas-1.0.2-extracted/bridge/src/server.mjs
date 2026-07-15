import { createServer } from "node:http";
import { copyFile, mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { spawn } from "node:child_process";

const ACTIVE_STATUSES = new Set(["pending", "running"]);
const MAX_JSON_BYTES = 2 * 1024 * 1024;
const MANAGED_CODEX_PROVIDER = Object.freeze({
  id: "beemax-codex-agent",
  name: "BeeMax Codex Agent",
  protocol: "beemax",
  enabled: true,
  baseUrl: "",
  apiKey: "",
  textModels: [],
  imageModels: ["gpt-image-2"],
  videoModels: [],
  defaultTextModel: "",
  defaultImageModel: "gpt-image-2",
  defaultVideoModel: "",
});

function withManagedCodexProvider(settings) {
  const current = Array.isArray(settings?.providers) ? settings.providers : [];
  return {
    ...(settings || {}),
    providers: [
      MANAGED_CODEX_PROVIDER,
      ...current.filter((provider) => provider?.id !== MANAGED_CODEX_PROVIDER.id),
    ],
  };
}

function withoutManagedCodexProvider(settings) {
  if (!settings || typeof settings !== "object") return settings;
  return {
    ...settings,
    providers: Array.isArray(settings.providers)
      ? settings.providers.filter((provider) => provider?.id !== MANAGED_CODEX_PROVIDER.id)
      : settings.providers,
  };
}

function sendJson(response, status, body) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(JSON.stringify(body));
}

async function readJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_JSON_BYTES) {
      const error = new Error("请求体不能超过 2 MB");
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  } catch {
    const error = new Error("请求体必须是合法 JSON");
    error.statusCode = 400;
    throw error;
  }
}

function extensionFor(contentType) {
  if (contentType === "image/jpeg") return ".jpg";
  if (contentType === "image/webp") return ".webp";
  return ".png";
}

async function createThumbnail(source, target) {
  const inspected = await runSips(["-g", "pixelWidth", "-g", "pixelHeight", source]);
  const width = Number(inspected.output.match(/pixelWidth:\s*(\d+)/)?.[1]);
  const height = Number(inspected.output.match(/pixelHeight:\s*(\d+)/)?.[1]);
  if (!inspected.ok || !width || !height) throw new Error("无法读取缩略图源图片尺寸");
  if (Math.max(width, height) <= 320) {
    await copyFile(source, target);
    return { width, height };
  }
  const resized = await runSips(["-Z", "320", source, "--out", target]);
  if (!resized.ok) throw new Error("无法生成图片缩略图");
  const scale = 320 / Math.max(width, height);
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

function runSips(args) {
  return new Promise((resolve) => {
    const stdout = [];
    const child = spawn("/usr/bin/sips", args, { stdio: ["ignore", "pipe", "ignore"] });
    const timeout = setTimeout(() => child.kill("SIGKILL"), 10_000);
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.once("error", () => {
      clearTimeout(timeout);
      resolve({ ok: false, output: "" });
    });
    child.once("close", (code) => {
      clearTimeout(timeout);
      resolve({ ok: code === 0, output: Buffer.concat(stdout).toString("utf8") });
    });
  });
}

function requestedRatio(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "square") return 1;
  if (normalized === "landscape") return 3 / 2;
  if (normalized === "portrait") return 2 / 3;
  const match = normalized.match(/^(\d+(?:\.\d+)?)\s*[:x]\s*(\d+(?:\.\d+)?)$/);
  if (!match) return 0;
  const ratio = Number(match[1]) / Number(match[2]);
  return Number.isFinite(ratio) && ratio > 0 ? ratio : 0;
}

export function cropDimensions(width, height, requested) {
  const ratio = requestedRatio(requested);
  if (!ratio || !width || !height || Math.abs(width / height - ratio) < 0.01) return null;
  if (width / height > ratio) return { width: Math.round(height * ratio), height };
  return { width, height: Math.round(width / ratio) };
}

async function normalizeImageAspect(file, requested) {
  const inspected = await runSips(["-g", "pixelWidth", "-g", "pixelHeight", file]);
  if (!inspected.ok) throw new Error("无法读取生成图片尺寸");
  const width = Number(inspected.output.match(/pixelWidth:\s*(\d+)/)?.[1]);
  const height = Number(inspected.output.match(/pixelHeight:\s*(\d+)/)?.[1]);
  if (!width || !height) throw new Error("生成图片缺少有效尺寸");
  const crop = cropDimensions(width, height, requested);
  if (!crop) return { width, height };
  const cropped = await runSips([
    "--cropToHeightWidth",
    String(crop.height),
    String(crop.width),
    file,
  ]);
  if (!cropped.ok) throw new Error(`无法将生成图片裁切为 ${requested}`);
  return crop;
}

function createTask(payload) {
  const taskId = `beemax_image_${Date.now()}_${randomUUID().slice(0, 8)}`;
  return {
    task_id: taskId,
    status: "pending",
    canonical_status: "pending",
    type: "image",
    created_at: Math.floor(Date.now() / 1000),
    updated_at: Math.floor(Date.now() / 1000),
    cancelled_at: null,
    result: null,
    node_id: String(payload.node_id || ""),
    project_id: String(payload.project_id || ""),
    run_id: String(payload.run_id || ""),
    parent_id: String(payload.parent_id || ""),
    batch_id: String(payload.batch_id || ""),
    prompt_summary: String(payload.prompt || "").slice(0, 160),
    provider_id: "",
    provider_protocol: "beemax",
    upstream_task_id: "",
    submission_status: "accepted",
    source_result: null,
    source_urls: [],
    server_urls: [],
    image_urls: [],
    media_records: [],
    persistence_status: "pending",
    save_error: "",
    error: null,
    route_events: [],
    generation: {
      prompt: String(payload.prompt || ""),
      model: String(payload.model || ""),
      size: String(payload.size || payload.aspect_ratio || ""),
      resolution: String(payload.resolution || ""),
      quality: String(payload.quality || ""),
      n: Math.max(1, Math.min(4, Math.floor(Number(payload.n) || 1))),
    },
  };
}

export function createBridgeServer({
  dataDir,
  providers,
  publicOrigin = "",
  upstreamUrl = "",
}) {
  if (!dataDir) throw new Error("dataDir is required");
  if (!Array.isArray(providers) || providers.length === 0) {
    throw new Error("at least one image provider is required");
  }

  const tasks = new Map();
  const controllers = new Map();
  const runningTasks = new Map();
  const assetsDir = path.join(dataDir, "assets");
  const tasksDir = path.join(dataDir, "tasks");
  const upstream = upstreamUrl.replace(/\/$/, "");
  let loadPromise;

  async function ensureTasksLoaded() {
    if (!loadPromise) {
      loadPromise = (async () => {
        await mkdir(tasksDir, { recursive: true });
        const entries = await readdir(tasksDir, { withFileTypes: true });
        await Promise.all(
          entries
            .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
            .map(async (entry) => {
              try {
                const task = JSON.parse(
                  await readFile(path.join(tasksDir, entry.name), "utf8"),
                );
                if (!task?.task_id) return;
                if (ACTIVE_STATUSES.has(task.status)) {
                  task.status = "failed";
                  task.canonical_status = "error";
                  task.error = { message: "Bridge 重启时任务仍在运行，请重试" };
                  task.updated_at = Math.floor(Date.now() / 1000);
                  task.persistence_status = "interrupted";
                  await writeFile(
                    path.join(tasksDir, entry.name),
                    `${JSON.stringify(task, null, 2)}\n`,
                    "utf8",
                  );
                }
                tasks.set(task.task_id, task);
              } catch {
                // Ignore incomplete files; atomic writes keep this exceptional.
              }
            }),
        );
      })();
    }
    await loadPromise;
  }

  async function proxyRequest(request, response) {
    if (!upstream) {
      sendJson(response, 404, { success: false, error: "Not found" });
      return;
    }
    const headers = new Headers();
    for (const [name, value] of Object.entries(request.headers)) {
      if (value !== undefined && !["host", "connection", "content-length"].includes(name)) {
        headers.set(name, Array.isArray(value) ? value.join(", ") : value);
      }
    }
    const hasBody = !["GET", "HEAD"].includes(request.method || "GET");
    const upstreamResponse = await fetch(`${upstream}${request.url || "/"}`, {
      method: request.method,
      headers,
      body: hasBody ? Readable.toWeb(request) : undefined,
      duplex: hasBody ? "half" : undefined,
      redirect: "manual",
    });
    const responseHeaders = {};
    for (const [name, value] of upstreamResponse.headers) {
      if (!["connection", "transfer-encoding", "content-length", "content-encoding"].includes(name)) {
        responseHeaders[name] = value;
      }
    }
    response.writeHead(upstreamResponse.status, responseHeaders);
    if (!upstreamResponse.body || request.method === "HEAD") {
      response.end();
      return;
    }
    try {
      await pipeline(Readable.fromWeb(upstreamResponse.body), response);
    } catch (error) {
      if (!response.destroyed) response.destroy(error);
    }
  }

  async function proxyRuntimeSettings(request, response) {
    if (!upstream) {
      sendJson(response, 404, { success: false, error: "原 Canvas 后端未配置" });
      return;
    }
    const method = request.method || "GET";
    let body;
    if (!["GET", "HEAD"].includes(method)) {
      body = JSON.stringify(withoutManagedCodexProvider(await readJson(request)));
    }
    const upstreamResponse = await fetch(`${upstream}${request.url}`, {
      method,
      headers: body ? { "content-type": "application/json" } : undefined,
      body,
    });
    const text = await upstreamResponse.text();
    let payload;
    try {
      payload = JSON.parse(text || "{}");
    } catch {
      sendJson(response, upstreamResponse.status, {
        success: false,
        error: "原 Canvas 运行配置返回了非 JSON 响应",
      });
      return;
    }
    if (payload?.settings && typeof payload.settings === "object") {
      payload.settings = withManagedCodexProvider(payload.settings);
    } else {
      payload = withManagedCodexProvider(payload);
    }
    sendJson(response, upstreamResponse.status, payload);
  }

  async function persistTask(task) {
    await mkdir(tasksDir, { recursive: true });
    const target = path.join(tasksDir, `${task.task_id}.json`);
    const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`;
    await writeFile(temporary, `${JSON.stringify(task, null, 2)}\n`, "utf8");
    await rename(temporary, target);
  }

  async function updateTask(task, changes) {
    Object.assign(task, changes, { updated_at: Math.floor(Date.now() / 1000) });
    await persistTask(task);
  }

  async function registerCanvasAsset(task, assetUrl) {
    if (!upstream || (!task.project_id && !task.node_id)) return null;
    const response = await fetch(`${upstream}/api/assets/localize`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ urls: [assetUrl] }),
    });
    const body = await response.json().catch(() => ({}));
    const asset = body?.mapping?.[assetUrl] || body?.assets?.[0];
    if (!response.ok || !body.success || !asset?.url || !asset?.id) {
      throw new Error(body.error || body.detail || "生成图片无法登记到 Canvas 资产库");
    }
    return asset;
  }

  function launchTask(task, payload) {
    const controller = new AbortController();
    controllers.set(task.task_id, controller);
    const running = runTask(task, payload, controller)
      .catch(async (error) => {
        try {
          await updateTask(task, {
            status: "failed",
            canonical_status: "error",
            error: { message: error instanceof Error ? error.message : String(error) },
          });
        } catch (persistError) {
          console.error(
            `[beemax-bridge] 无法持久化任务 ${task.task_id} 的失败状态: ${persistError instanceof Error ? persistError.message : String(persistError)}`,
          );
        }
      })
      .finally(() => {
        controllers.delete(task.task_id);
        runningTasks.delete(task.task_id);
      });
    runningTasks.set(task.task_id, running);
  }

  async function saveResult(task, payload, provider, generated, itemIndex, itemCount) {
    const bytes = Buffer.isBuffer(generated.bytes)
      ? generated.bytes
      : Buffer.from(generated.bytes);
    const contentType = generated.contentType || "image/png";
    const itemSuffix = itemCount > 1 ? `_${itemIndex + 1}` : "";
    const extension = extensionFor(contentType);
    const filename = `${task.task_id}${itemSuffix}${extension}`;
    const thumbnailFilename = `${task.task_id}${itemSuffix}_thumb${extension}`;
    await mkdir(assetsDir, { recursive: true });
    const assetFile = path.join(assetsDir, filename);
    await writeFile(assetFile, bytes);
    const dimensions = await normalizeImageAspect(
      assetFile,
      payload.size || payload.aspect_ratio,
    );
    const thumbnailDimensions = await createThumbnail(
      assetFile,
      path.join(assetsDir, thumbnailFilename),
    );

    const origin = publicOrigin.replace(/\/$/, "");
    const assetPath = `/beemax-assets/${encodeURIComponent(filename)}`;
    const bridgeAssetUrl = `${origin}${assetPath}`;
    const thumbnailPath = `/beemax-assets/${encodeURIComponent(thumbnailFilename)}`;
    const thumbnailUrl = `${origin}${thumbnailPath}`;
    const canvasAsset = await registerCanvasAsset(task, bridgeAssetUrl);
    const assetUrl = canvasAsset ? `${origin}${canvasAsset.url}` : bridgeAssetUrl;
    const metadata = {
      task_id: task.task_id,
      item_index: itemIndex,
      prompt: payload.prompt,
      provider_id: provider.id,
      model: generated.metadata?.model || payload.model || "",
      size: payload.size || payload.aspect_ratio || "",
      resolution: payload.resolution || "",
      quality: payload.quality || "",
      project_id: task.project_id,
      node_id: task.node_id,
      created_at: task.created_at,
      thumbnail_url: thumbnailUrl,
      asset_id: canvasAsset?.id || "",
      bridge_asset_url: bridgeAssetUrl,
      width: dimensions.width,
      height: dimensions.height,
      thumbnail_width: thumbnailDimensions.width,
      thumbnail_height: thumbnailDimensions.height,
      ...generated.metadata,
    };
    await writeFile(
      path.join(assetsDir, `${task.task_id}${itemSuffix}.json`),
      `${JSON.stringify(metadata, null, 2)}\n`,
      "utf8",
    );
    return {
      assetUrl,
      assetPath,
      thumbnailUrl,
      thumbnailPath,
      contentType,
      filename,
      assetId: canvasAsset?.id || "",
      bridgeAssetUrl,
      metadata,
    };
  }

  async function runTask(task, payload, controller) {
    await updateTask(task, { status: "running", canonical_status: "running" });
    if (controller.signal.aborted) return;
    const itemCount = task.generation.n;
    const outputs = [];
    const itemErrors = [];

    for (let itemIndex = 0; itemIndex < itemCount; itemIndex += 1) {
        let output = null;
        let lastError = "";
        for (const provider of providers) {
          const event = {
            item_index: itemIndex,
            provider_id: provider.id,
            started_at: new Date().toISOString(),
            status: "running",
          };
          task.route_events.push(event);
          await persistTask(task);
          try {
            const generated = await provider.generate(
              { ...payload, n: 1 },
              { signal: controller.signal, task },
            );
            if (controller.signal.aborted) return;
            const saved = await saveResult(
              task,
              payload,
              provider,
              generated,
              itemIndex,
              itemCount,
            );
            if (controller.signal.aborted) return;
            event.status = "success";
            event.finished_at = new Date().toISOString();
            output = { saved, provider, metadata: generated.metadata || null };
            outputs.push(output);
            await updateTask(task, {
              completed_items: outputs.length,
              server_urls: outputs.map((item) => item.saved.assetUrl),
              image_urls: outputs.map((item) => item.saved.assetUrl),
            });
            break;
          } catch (error) {
            lastError = error instanceof Error ? error.message : String(error);
            event.status = controller.signal.aborted ? "cancelled" : "failed";
            event.finished_at = new Date().toISOString();
            event.error = lastError;
            await persistTask(task);
            if (controller.signal.aborted) return;
          }
        }
        if (!output) itemErrors.push({ item_index: itemIndex, error: lastError });
      }

      if (outputs.length === 0) {
        const lastEvent = task.route_events.at(-1);
        await updateTask(task, {
          status: "failed",
          canonical_status: "error",
          error: { message: lastEvent?.error || "所有图片 Provider 均生成失败" },
          persistence_status: "failed",
        });
        return;
      }

      const providerIds = [...new Set(outputs.map((item) => item.provider.id))];
      const imageUrls = outputs.map((item) => item.saved.assetUrl);
      await updateTask(task, {
        status: "completed",
        canonical_status: "success",
        provider_id: providerIds.length === 1 ? providerIds[0] : "mixed",
        result: { image_urls: imageUrls },
        server_urls: imageUrls,
        image_urls: imageUrls,
        media_records: outputs.map((item) => ({
          type: "image",
          url: item.saved.assetUrl,
          path: item.saved.assetPath,
          thumbnail_url: item.saved.thumbnailUrl,
          thumbnail_path: item.saved.thumbnailPath,
          content_type: item.saved.contentType,
          asset_id: item.saved.assetId,
          bridge_asset_url: item.saved.bridgeAssetUrl,
          project_id: task.project_id,
          node_id: task.node_id,
        })),
        persistence_status: itemErrors.length ? "partial" : "completed",
        warning: itemErrors.length ? `${itemErrors.length} 张图片生成失败` : "",
        source_result:
          itemCount === 1
            ? outputs[0].metadata
            : { outputs: outputs.map((item) => item.metadata), errors: itemErrors },
      });
  }

  const server = createServer(async (request, response) => {
    try {
      await ensureTasksLoaded();
      const url = new URL(request.url || "/", "http://127.0.0.1");

      if (request.method === "GET" && url.pathname === "/api/beemax/health") {
        sendJson(response, 200, {
          status: "ok",
          service: "beemax-bridge",
          providers: providers.map((provider) => provider.id),
        });
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/beemax/capabilities") {
        sendJson(response, 200, {
          success: true,
          image: {
            generate: {
              async: true,
              cancel: true,
              retry: true,
              route: providers.map((provider) => provider.id),
              providers: providers.map((provider) => ({
                id: provider.id,
                capabilities: provider.capabilities || { generate: true },
              })),
            },
          },
        });
        return;
      }

      if (
        ["GET", "PUT"].includes(request.method || "GET") &&
        url.pathname === "/api/admin/runtime-settings"
      ) {
        await proxyRuntimeSettings(request, response);
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/image") {
        const payload = await readJson(request);
        if (!String(payload.prompt || "").trim()) {
          sendJson(response, 422, { success: false, error: "prompt 不能为空" });
          return;
        }
        const task = createTask(payload);
        tasks.set(task.task_id, task);
        await persistTask(task);
        sendJson(response, 200, { success: true, task_id: task.task_id });
        launchTask(task, payload);
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/tasks") {
        const filters = {
          project_id: url.searchParams.get("project_id") || "",
          node_id: url.searchParams.get("node_id") || "",
          run_id: url.searchParams.get("run_id") || "",
        };
        const bridgeTasks = [...tasks.values()].filter((task) =>
          Object.entries(filters).every(
            ([field, value]) => !value || String(task[field] || "") === value,
          ),
        );
        let upstreamTasks = [];
        if (upstream) {
          try {
            const upstreamResponse = await fetch(`${upstream}/api/tasks${url.search}`);
            if (upstreamResponse.ok) {
              const upstreamBody = await upstreamResponse.json();
              upstreamTasks = Array.isArray(upstreamBody.tasks) ? upstreamBody.tasks : [];
            }
          } catch {
            // The Bridge task center remains usable while the legacy backend recovers.
          }
        }
        const seen = new Set();
        const combined = [...bridgeTasks, ...upstreamTasks]
          .filter((task) => {
            if (!task?.task_id || seen.has(task.task_id)) return false;
            seen.add(task.task_id);
            return true;
          })
          .sort((left, right) => Number(right.created_at || 0) - Number(left.created_at || 0));
        const count = (...statuses) =>
          combined.filter((task) => statuses.includes(String(task.status || "").toLowerCase())).length;
        sendJson(response, 200, {
          success: true,
          total: combined.length,
          running: count("pending", "running", "processing", "queued"),
          completed: count("completed", "saving"),
          failed: count("failed", "error"),
          query_failed: count("query_failed"),
          save_failed: count("save_failed"),
          cancelled: count("cancelled", "canceled"),
          tasks: combined,
        });
        return;
      }

      const taskMatch = url.pathname.match(/^\/api\/task\/([^/]+)$/);
      if (request.method === "GET" && taskMatch) {
        const task = tasks.get(decodeURIComponent(taskMatch[1]));
        if (!task) {
          if (upstream) {
            await proxyRequest(request, response);
            return;
          }
          sendJson(response, 404, { success: false, error: "任务不存在" });
          return;
        }
        sendJson(response, 200, { success: true, data: task, source: "beemax_bridge" });
        return;
      }

      const cancelMatch = url.pathname.match(/^\/api\/task\/([^/]+)\/cancel$/);
      if (request.method === "POST" && cancelMatch) {
        const taskId = decodeURIComponent(cancelMatch[1]);
        const task = tasks.get(taskId);
        if (!task) {
          if (upstream) {
            await proxyRequest(request, response);
            return;
          }
          sendJson(response, 404, { ok: false, error: "任务不存在" });
          return;
        }
        if (task.status === "cancelled") {
          sendJson(response, 200, { ok: true, task });
          return;
        }
        if (!ACTIVE_STATUSES.has(task.status)) {
          sendJson(response, 409, {
            ok: false,
            error: `状态为 ${task.status} 的任务不能取消`,
            task,
          });
          return;
        }
        await updateTask(task, {
          status: "cancelled",
          canonical_status: "cancelled",
          cancelled_at: Math.floor(Date.now() / 1000),
          persistence_status: "cancelled",
        });
        controllers.get(taskId)?.abort(new Error("任务已取消"));
        await runningTasks.get(taskId);
        sendJson(response, 200, { ok: true, task });
        return;
      }

      const retryMatch = url.pathname.match(/^\/api\/task\/([^/]+)\/retry$/);
      if (request.method === "POST" && retryMatch) {
        const originalTaskId = decodeURIComponent(retryMatch[1]);
        const original = tasks.get(originalTaskId);
        if (!original) {
          sendJson(response, 404, { success: false, error: "任务不存在" });
          return;
        }
        if (ACTIVE_STATUSES.has(original.status)) {
          sendJson(response, 409, { success: false, error: "运行中的任务不能重试" });
          return;
        }
        const payload = {
          ...original.generation,
          async_mode: true,
          node_id: original.node_id,
          project_id: original.project_id,
          run_id: original.run_id,
          parent_id: original.parent_id,
          batch_id: original.batch_id,
        };
        const retried = createTask(payload);
        retried.retry_of = originalTaskId;
        tasks.set(retried.task_id, retried);
        await persistTask(retried);
        sendJson(response, 200, {
          success: true,
          task_id: retried.task_id,
          retry_of: originalTaskId,
        });
        launchTask(retried, payload);
        return;
      }

      const assetMatch = url.pathname.match(/^\/beemax-assets\/([^/]+)$/);
      if (request.method === "GET" && assetMatch) {
        const filename = path.basename(decodeURIComponent(assetMatch[1]));
        if (!/\.(png|jpe?g|webp)$/i.test(filename)) {
          sendJson(response, 404, { success: false, error: "图片资产不存在" });
          return;
        }
        let bytes;
        try {
          bytes = await readFile(path.join(assetsDir, filename));
        } catch (error) {
          if (error?.code !== "ENOENT") throw error;
          sendJson(response, 404, { success: false, error: "图片资产不存在" });
          return;
        }
        response.writeHead(200, {
          "content-type": filename.endsWith(".jpg")
            ? "image/jpeg"
            : filename.endsWith(".webp")
              ? "image/webp"
              : "image/png",
          "cache-control": "public, max-age=31536000, immutable",
        });
        response.end(bytes);
        return;
      }

      await proxyRequest(request, response);
    } catch (error) {
      sendJson(response, error.statusCode || 500, {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  const closeServer = server.close.bind(server);
  server.close = (callback) => {
    for (const controller of controllers.values()) {
      controller.abort(new Error("BeeMax Bridge 正在关闭"));
    }
    return closeServer(() => {
      void Promise.allSettled([...runningTasks.values()]).then(() => callback?.());
    });
  };
  return server;
}

export { ACTIVE_STATUSES };
