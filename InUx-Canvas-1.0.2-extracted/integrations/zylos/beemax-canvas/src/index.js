import fs from 'node:fs';
import path from 'node:path';

import { loadConfig } from './lib/config.js';

const TERMINAL_STATUSES = new Set([
  'completed',
  'success',
  'failed',
  'error',
  'cancelled',
  'canceled',
  'save_failed',
]);
const SUCCESS_STATUSES = new Set(['completed', 'success']);
const MAX_LOCAL_IMAGE_BYTES = 50 * 1024 * 1024;
const CANVAS_ASSET_PATH = /^\/(?:uploads|beemax-assets)\//;
const IMAGE_CONTENT_TYPES = new Map([
  ['.gif', 'image/gif'],
  ['.jpeg', 'image/jpeg'],
  ['.jpg', 'image/jpeg'],
  ['.png', 'image/png'],
  ['.webp', 'image/webp'],
]);

function timeoutSignal(seconds) {
  const milliseconds = Math.max(1, Math.ceil((Number(seconds) || 0.001) * 1000));
  return AbortSignal.timeout(milliseconds);
}

function firstAsset(payload) {
  if (payload?.asset && typeof payload.asset === 'object') return payload.asset;
  for (const key of ['assets', 'localized_assets', 'results']) {
    const value = payload?.[key]?.[0];
    if (typeof value === 'string') return { url: value };
    if (value && typeof value === 'object') return value;
  }
  for (const key of ['urls', 'localized_urls']) {
    if (payload?.[key]?.[0]) return { url: payload[key][0] };
  }
  return null;
}

function taskData(payload) {
  return payload?.data && typeof payload.data === 'object' ? payload.data : payload;
}

function taskUrls(task) {
  for (const key of ['server_urls', 'image_urls', 'source_urls']) {
    if (Array.isArray(task?.[key]) && task[key].length > 0) return task[key];
  }
  return [];
}

export class BeeMaxCanvasClient {
  constructor(options = {}) {
    const config = loadConfig(options);
    this.baseUrl = config.baseUrl;
    this.timeoutSeconds = config.timeoutSeconds;
    this.fetch = options.fetch || globalThis.fetch;
  }

  async request(method, pathname, { json, body, headers, timeoutSeconds } = {}) {
    const response = await this.fetch(new URL(pathname, `${this.baseUrl}/`), {
      method,
      headers: {
        accept: 'application/json',
        ...(json === undefined ? {} : { 'content-type': 'application/json' }),
        ...headers,
      },
      body: json === undefined ? body : JSON.stringify(json),
      signal: timeoutSignal(timeoutSeconds || this.timeoutSeconds),
    });
    const text = await response.text();
    let payload;
    try {
      payload = text ? JSON.parse(text) : {};
    } catch {
      throw new Error(`BeeMax Canvas returned non-JSON data (HTTP ${response.status})`);
    }
    if (!response.ok || payload?.success === false) {
      throw new Error(payload?.error || payload?.detail || `BeeMax Canvas HTTP ${response.status}`);
    }
    return payload;
  }

  async status() {
    const [health, capabilities] = await Promise.all([
      this.request('GET', '/api/beemax/health'),
      this.request('GET', '/api/beemax/capabilities'),
    ]);
    return { success: true, canvas_url: this.baseUrl, health, capabilities };
  }

  async importImage(source) {
    const value = String(source || '').trim();
    if (!value) throw new Error('Image source is required');
    if (value.startsWith('data:image/') || CANVAS_ASSET_PATH.test(value)) {
      return { success: true, source: value, asset: { url: value }, imported: false };
    }
    if (/^https?:\/\//i.test(value)) {
      const payload = await this.request('POST', '/api/assets/localize', {
        json: { urls: [value] },
      });
      const asset = firstAsset(payload);
      if (!asset?.url) throw new Error('BeeMax Canvas did not return an imported image asset');
      return { success: true, source: value, asset, imported: true, response: payload };
    }

    const inputPath = path.resolve(value);
    const stat = fs.statSync(inputPath, { throwIfNoEntry: false });
    if (!stat?.isFile()) {
      throw new Error(`Image file does not exist: ${inputPath}`);
    }
    if (stat.size > MAX_LOCAL_IMAGE_BYTES) {
      throw new Error(`Image file exceeds the 50 MB limit: ${inputPath}`);
    }
    const contentType = IMAGE_CONTENT_TYPES.get(path.extname(inputPath).toLowerCase());
    if (!contentType) {
      throw new Error('Unsupported image file type; use JPEG, PNG, WebP, or GIF');
    }
    const form = new FormData();
    form.append(
      'file',
      new Blob([fs.readFileSync(inputPath)], { type: contentType }),
      path.basename(inputPath),
    );
    const payload = await this.request('POST', '/api/uploads/images', { body: form });
    const asset = firstAsset(payload);
    if (!asset?.url) throw new Error('BeeMax Canvas did not return an uploaded image asset');
    return { success: true, source: inputPath, asset, imported: true, response: payload };
  }

  async prepareImage(source) {
    const imported = await this.importImage(source);
    return {
      ...(imported.asset.id ? { asset_id: imported.asset.id } : {}),
      url: imported.asset.url,
    };
  }

  async submit(operation, options = {}) {
    const prompt = String(options.prompt || '').trim();
    if (!prompt) throw new Error('Prompt is required');
    if (operation === 'mask' && !options.mask) {
      throw new Error('mask requires an alpha PNG mask image');
    }
    const requestedInputs = options.inputs || [];
    if (requestedInputs.length > 10) throw new Error('At most 10 input images are supported');
    const inputs = [];
    for (const source of requestedInputs) inputs.push(await this.prepareImage(source));
    if (operation !== 'generate' && inputs.length === 0) {
      throw new Error(`${operation} requires at least one input image`);
    }
    const count = Number(options.count || 1);
    if (!Number.isInteger(count) || count < 1 || count > 4) {
      throw new Error('Image count must be an integer from 1 to 4');
    }

    const payload = {
      operation,
      prompt,
      model: options.model || undefined,
      aspect_ratio: options.aspectRatio || undefined,
      resolution: options.resolution || undefined,
      quality: options.quality || undefined,
      n: count,
      input_images: inputs,
      project_id: options.projectId || undefined,
      node_id: options.nodeId || undefined,
      parent_asset_id: options.parentAssetId || undefined,
    };
    if (options.mask) payload.mask_image = await this.prepareImage(options.mask);
    const submitted = await this.request('POST', '/api/image', { json: payload });
    const taskId = submitted.task_id || submitted.data?.task_id;
    if (!taskId) throw new Error('BeeMax Canvas did not return a task ID');
    if (options.wait === false) return { success: true, task_id: taskId, submitted };
    return this.waitForTask(taskId, { timeoutSeconds: options.timeoutSeconds });
  }

  async waitForTask(taskId, { timeoutSeconds, intervalMs = 500 } = {}) {
    const timeout = Number(timeoutSeconds || this.timeoutSeconds);
    const deadline = Date.now() + timeout * 1000;
    while (Date.now() < deadline) {
      const remainingSeconds = Math.max(0.001, (deadline - Date.now()) / 1000);
      const response = await this.task(taskId, { timeoutSeconds: remainingSeconds });
      const task = taskData(response);
      const status = String(task.status || task.canonical_status || '').toLowerCase();
      if (TERMINAL_STATUSES.has(status)) {
        if (!SUCCESS_STATUSES.has(status)) {
          throw new Error(task.error?.message || task.error || `BeeMax task ${status}`);
        }
        return {
          success: true,
          task_id: taskId,
          status,
          image_urls: taskUrls(task),
          task,
        };
      }
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
    throw new Error(`BeeMax task timed out after ${timeout} seconds: ${taskId}`);
  }

  task(taskId, { timeoutSeconds } = {}) {
    const id = String(taskId || '').trim();
    if (!id) throw new Error('Task ID is required');
    return this.request('GET', `/api/task/${encodeURIComponent(id)}`, { timeoutSeconds });
  }

  cancel(taskId) {
    const id = String(taskId || '').trim();
    if (!id) throw new Error('Task ID is required');
    return this.request('POST', `/api/task/${encodeURIComponent(id)}/cancel`, { json: {} });
  }

  retry(taskId) {
    const id = String(taskId || '').trim();
    if (!id) throw new Error('Task ID is required');
    return this.request('POST', `/api/task/${encodeURIComponent(id)}/retry`, { json: {} });
  }
}

export async function runOperation(operation, options = {}) {
  const client = new BeeMaxCanvasClient(options);
  return client.submit(operation, options);
}

export async function registerAgentCapabilities(options = {}) {
  const client = new BeeMaxCanvasClient(options);
  const models = options.models || {};
  return client.request('POST', '/api/beemax/agent-plugins/register', {
    json: {
      id: String(options.id || 'zylos-agent').trim(),
      agent: 'Zylos Agent',
      endpoint: String(options.endpoint || '').trim(),
      models: Object.fromEntries(
        ['text', 'image', 'video'].map((type) => [
          type,
          Array.isArray(models[type])
            ? models[type].map((model) => String(model).trim()).filter(Boolean)
            : [],
        ]),
      ),
      capabilities: options.capabilities || {},
    },
  });
}
