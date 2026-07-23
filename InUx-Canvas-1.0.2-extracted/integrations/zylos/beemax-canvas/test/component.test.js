import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import test from 'node:test';

import { BeeMaxCanvasClient, registerAgentCapabilities } from '../src/index.js';

const execFileAsync = promisify(execFile);
const componentRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function listen(handler) {
  const server = createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  return {
    server,
    origin: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

async function bodyJson(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function sendJson(response, payload, status = 200) {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify(payload));
}

test('Zylos can discover BeeMax Canvas health and image capabilities through the CLI', async () => {
  const api = await listen((request, response) => {
    if (request.url === '/api/beemax/health') {
      sendJson(response, { status: 'ok', service: 'beemax-bridge' });
      return;
    }
    if (request.url === '/api/beemax/capabilities') {
      sendJson(response, { success: true, image: { generate: { async: true } } });
      return;
    }
    response.writeHead(404).end();
  });

  try {
    const { stdout } = await execFileAsync(
      process.execPath,
      [
        path.join(componentRoot, 'scripts/beemax.js'),
        'status',
        '--base-url',
        api.origin,
      ],
      { timeout: 5_000 },
    );
    const result = JSON.parse(stdout);
    assert.equal(result.success, true);
    assert.equal(result.canvas_url, api.origin);
    assert.equal(result.health.service, 'beemax-bridge');
    assert.equal(result.capabilities.image.generate.async, true);
  } finally {
    await api.close();
  }
});

test('Zylos registers its Agent models without forwarding credentials', async () => {
  let registered;
  const api = await listen(async (request, response) => {
    if (request.method === 'POST' && request.url === '/api/beemax/agent-plugins/register') {
      registered = await bodyJson(request);
      sendJson(response, { success: true, plugin: registered }, 201);
      return;
    }
    response.writeHead(404).end();
  });

  try {
    const result = await registerAgentCapabilities({
      baseUrl: api.origin,
      endpoint: 'http://127.0.0.1:19999',
      models: {
        text: ['zylos-text'],
        image: ['zylos-image'],
        video: ['zylos-video'],
      },
      apiKey: 'must-not-cross-plugin-boundary',
    });
    assert.equal(result.success, true);
    assert.equal(registered.id, 'zylos-agent');
    assert.equal(Object.hasOwn(registered, 'apiKey'), false);
    assert.equal(Object.hasOwn(registered, 'api_key'), false);
  } finally {
    await api.close();
  }
});

test('Zylos imports a remote reference, submits an edit, and returns Canvas asset URLs', async () => {
  let submitted;
  const api = await listen(async (request, response) => {
    if (request.method === 'POST' && request.url === '/api/assets/localize') {
      assert.deepEqual(await bodyJson(request), { urls: ['https://images.example/source.png'] });
      sendJson(response, {
        success: true,
        assets: [{ id: 'asset-source', url: '/uploads/source.png' }],
      });
      return;
    }
    if (request.method === 'POST' && request.url === '/api/image') {
      submitted = await bodyJson(request);
      sendJson(response, { success: true, task_id: 'task-edit-1' });
      return;
    }
    if (request.method === 'GET' && request.url === '/api/task/task-edit-1') {
      sendJson(response, {
        success: true,
        data: {
          task_id: 'task-edit-1',
          status: 'completed',
          server_urls: ['/uploads/result.png'],
        },
      });
      return;
    }
    response.writeHead(404).end();
  });

  try {
    const client = new BeeMaxCanvasClient({ baseUrl: api.origin, timeoutSeconds: 5 });
    const result = await client.submit('edit', {
      prompt: 'Keep the product and change the background to blue.',
      inputs: ['https://images.example/source.png'],
      projectId: 'project-a',
    });

    assert.equal(result.success, true);
    assert.deepEqual(result.image_urls, ['/uploads/result.png']);
    assert.equal(submitted.operation, 'edit');
    assert.equal(submitted.project_id, 'project-a');
    assert.deepEqual(submitted.input_images, [
      { asset_id: 'asset-source', url: '/uploads/source.png' },
    ]);
  } finally {
    await api.close();
  }
});

test('Zylos uploads an absolute local image path instead of treating it as a Canvas URL', async () => {
  let uploaded = false;
  let uploadedImageContentType = false;
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'beemax-zylos-image-'));
  const imagePath = path.join(temporary, 'reference.png');
  await writeFile(imagePath, Buffer.from('fake-png-for-upload-contract'));
  const api = await listen(async (request, response) => {
    if (request.method === 'POST' && request.url === '/api/uploads/images') {
      uploaded = request.headers['content-type']?.startsWith('multipart/form-data;') || false;
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      uploadedImageContentType = Buffer.concat(chunks)
        .toString('latin1')
        .includes('Content-Type: image/png');
      sendJson(response, {
        success: true,
        asset: { id: 'asset-local', url: '/uploads/reference.png' },
      });
      return;
    }
    response.writeHead(404).end();
  });

  try {
    const client = new BeeMaxCanvasClient({ baseUrl: api.origin, timeoutSeconds: 5 });
    const result = await client.importImage(imagePath);
    assert.equal(uploaded, true);
    assert.equal(uploadedImageContentType, true);
    assert.equal(result.imported, true);
    assert.equal(result.asset.id, 'asset-local');
  } finally {
    await api.close();
    await rm(temporary, { recursive: true, force: true });
  }
});

test('Zylos declares MIME types for every supported local image format', async () => {
  const expected = new Map([
    ['sample.jpg', 'image/jpeg'],
    ['sample.png', 'image/png'],
    ['sample.webp', 'image/webp'],
    ['sample.gif', 'image/gif'],
  ]);
  const received = new Map();
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'beemax-zylos-mime-'));
  for (const filename of expected.keys()) {
    await writeFile(path.join(temporary, filename), Buffer.from(`fake-${filename}`));
  }
  const api = await listen(async (request, response) => {
    if (request.method === 'POST' && request.url === '/api/uploads/images') {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const multipart = Buffer.concat(chunks).toString('latin1');
      const filename = multipart.match(/filename="([^"]+)"/)?.[1];
      const contentType = multipart.match(/Content-Type: (image\/[^\r\n]+)/)?.[1];
      if (filename) received.set(filename, contentType);
      sendJson(response, {
        success: true,
        asset: { id: `asset-${filename}`, url: `/uploads/${filename}` },
      });
      return;
    }
    response.writeHead(404).end();
  });

  try {
    const client = new BeeMaxCanvasClient({ baseUrl: api.origin, timeoutSeconds: 5 });
    for (const filename of expected.keys()) {
      await client.importImage(path.join(temporary, filename));
    }
    assert.deepEqual(received, expected);
  } finally {
    await api.close();
    await rm(temporary, { recursive: true, force: true });
  }
});

test('Zylos mask requests import both source and mask before submission', async () => {
  let submitted;
  let nextAsset = 0;
  const api = await listen(async (request, response) => {
    if (request.method === 'POST' && request.url === '/api/assets/localize') {
      const input = await bodyJson(request);
      nextAsset += 1;
      sendJson(response, {
        success: true,
        assets: [{ id: `asset-${nextAsset}`, url: `/uploads/${path.basename(input.urls[0])}` }],
      });
      return;
    }
    if (request.method === 'POST' && request.url === '/api/image') {
      submitted = await bodyJson(request);
      sendJson(response, { success: true, task_id: 'task-mask-1' });
      return;
    }
    if (request.method === 'GET' && request.url === '/api/task/task-mask-1') {
      sendJson(response, {
        success: true,
        data: { status: 'completed', server_urls: ['/uploads/masked.png'] },
      });
      return;
    }
    response.writeHead(404).end();
  });

  try {
    const client = new BeeMaxCanvasClient({ baseUrl: api.origin, timeoutSeconds: 5 });
    await client.submit('mask', {
      prompt: 'Replace the transparent region.',
      inputs: ['https://images.example/source.png'],
      mask: 'https://images.example/mask.png',
    });
    assert.equal(submitted.operation, 'mask');
    assert.equal(submitted.input_images[0].asset_id, 'asset-1');
    assert.equal(submitted.mask_image.asset_id, 'asset-2');
  } finally {
    await api.close();
  }
});
