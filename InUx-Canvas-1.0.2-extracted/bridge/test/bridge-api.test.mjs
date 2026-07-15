import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { createBridgeServer, cropDimensions } from "../src/server.mjs";
import {
  createCommandCodexProvider,
  createDirectCodexProvider,
  createRelayProvider,
} from "../src/providers.mjs";

const PNG_BYTES = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+Xy4uAAAAAElFTkSuQmCC",
  "base64",
);

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const { port } = server.address();
  return `http://127.0.0.1:${port}`;
}

async function waitForTask(baseUrl, taskId) {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    const response = await fetch(`${baseUrl}/api/task/${taskId}`);
    const body = await response.json();
    if (body.data.status !== "pending" && body.data.status !== "running") {
      return body.data;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Task ${taskId} did not finish`);
}

test("generated images are cropped to the requested aspect ratio", () => {
  assert.deepEqual(cropDimensions(1024, 1536, "1:1"), { width: 1024, height: 1024 });
  assert.deepEqual(cropDimensions(1536, 1024, "16:9"), { width: 1536, height: 864 });
  assert.deepEqual(cropDimensions(1024, 1536, "portrait"), null);
});

test("Codex success completes a local image task without calling fallback", async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "beemax-bridge-test-"));
  let fallbackCalls = 0;
  const server = createBridgeServer({
    dataDir,
    publicOrigin: "http://127.0.0.1:9999",
    providers: [
      {
        id: "codex-native",
        async generate() {
          return {
            bytes: PNG_BYTES,
            contentType: "image/png",
            metadata: { model: "gpt-image-2-medium" },
          };
        },
      },
      {
        id: "relay-main",
        async generate() {
          fallbackCalls += 1;
          throw new Error("fallback must not run");
        },
      },
    ],
  });

  try {
    const baseUrl = await listen(server);
    const submitResponse = await fetch(`${baseUrl}/api/image`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        prompt: "一只戴安全帽的蜜蜂",
        model: "gpt-image-2-medium",
        size: "16:9",
        async_mode: true,
        project_id: "project-1",
        node_id: "node-1",
      }),
    });
    const submitted = await submitResponse.json();

    assert.equal(submitResponse.status, 200);
    assert.equal(submitted.success, true);
    assert.match(submitted.task_id, /^beemax_image_/);

    const task = await waitForTask(baseUrl, submitted.task_id);
    assert.equal(task.status, "completed");
    assert.equal(task.canonical_status, "success");
    assert.equal(task.provider_id, "codex-native");
    assert.equal(task.project_id, "project-1");
    assert.equal(task.node_id, "node-1");
    assert.equal(task.server_urls.length, 1);
    assert.match(task.server_urls[0], /^http:\/\/127\.0\.0\.1:9999\/beemax-assets\//);
    assert.equal(task.media_records[0].project_id, "project-1");
    assert.equal(task.media_records[0].node_id, "node-1");
    assert.match(
      task.media_records[0].thumbnail_url,
      /^http:\/\/127\.0\.0\.1:9999\/beemax-assets\//,
    );
    assert.deepEqual(task.route_events.map((event) => event.provider_id), [
      "codex-native",
    ]);
    assert.equal(fallbackCalls, 0);

    const assetResponse = await fetch(
      `${baseUrl}${new URL(task.server_urls[0]).pathname}`,
    );
    assert.equal(assetResponse.status, 200);
    assert.deepEqual(Buffer.from(await assetResponse.arrayBuffer()), PNG_BYTES);
    const thumbnailResponse = await fetch(
      `${baseUrl}${new URL(task.media_records[0].thumbnail_url).pathname}`,
    );
    assert.equal(thumbnailResponse.status, 200);
    assert.deepEqual(
      Buffer.from(await thumbnailResponse.arrayBuffer()).subarray(0, 8),
      PNG_BYTES.subarray(0, 8),
    );

    const metadataPath = path.join(
      dataDir,
      "assets",
      `${submitted.task_id}.json`,
    );
    const metadata = JSON.parse(await readFile(metadataPath, "utf8"));
    assert.equal(metadata.prompt, "一只戴安全帽的蜜蜂");
    assert.equal(metadata.provider_id, "codex-native");

    const privateMetadata = await fetch(
      `${baseUrl}/beemax-assets/${submitted.task_id}.json`,
    );
    assert.equal(privateMetadata.status, 404);
    const missingAsset = await fetch(`${baseUrl}/beemax-assets/missing.png`);
    assert.equal(missingAsset.status, 404);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("Codex failure falls back to relay and records both route attempts", async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "beemax-bridge-test-"));
  let fallbackCalls = 0;
  const server = createBridgeServer({
    dataDir,
    publicOrigin: "http://127.0.0.1:9999",
    providers: [
      {
        id: "codex-native",
        async generate() {
          throw new Error("Codex OAuth expired");
        },
      },
      {
        id: "relay-main",
        async generate() {
          fallbackCalls += 1;
          return {
            bytes: PNG_BYTES,
            contentType: "image/png",
          };
        },
      },
    ],
  });

  try {
    const baseUrl = await listen(server);
    const submitted = await fetch(`${baseUrl}/api/image`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt: "fallback poster", async_mode: true }),
    }).then((response) => response.json());

    const task = await waitForTask(baseUrl, submitted.task_id);
    assert.equal(task.status, "completed");
    assert.equal(task.provider_id, "relay-main");
    assert.equal(fallbackCalls, 1);
    assert.deepEqual(
      task.route_events.map(({ provider_id, status }) => ({ provider_id, status })),
      [
        { provider_id: "codex-native", status: "failed" },
        { provider_id: "relay-main", status: "success" },
      ],
    );
    assert.equal(task.route_events[0].error, "Codex OAuth expired");
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("a running image task can be cancelled through the public task API", async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "beemax-bridge-test-"));
  let providerWasAborted = false;
  const server = createBridgeServer({
    dataDir,
    providers: [
      {
        id: "codex-native",
        async generate(_payload, { signal }) {
          await new Promise((resolve, reject) => {
            signal.addEventListener(
              "abort",
              () => {
                providerWasAborted = true;
                reject(signal.reason);
              },
              { once: true },
            );
          });
        },
      },
    ],
  });

  try {
    const baseUrl = await listen(server);
    const submitted = await fetch(`${baseUrl}/api/image`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt: "cancel me", async_mode: true }),
    }).then((response) => response.json());

    await new Promise((resolve) => setTimeout(resolve, 20));
    const cancelResponse = await fetch(
      `${baseUrl}/api/task/${submitted.task_id}/cancel`,
      { method: "POST" },
    );
    const cancelled = await cancelResponse.json();

    assert.equal(cancelResponse.status, 200);
    assert.equal(cancelled.ok, true);
    assert.equal(cancelled.task.status, "cancelled");
    assert.equal(cancelled.task.canonical_status, "cancelled");
    assert.equal(providerWasAborted, true);

    const task = await fetch(`${baseUrl}/api/task/${submitted.task_id}`).then(
      (response) => response.json(),
    );
    assert.equal(task.data.status, "cancelled");

    const secondCancel = await fetch(
      `${baseUrl}/api/task/${submitted.task_id}/cancel`,
      { method: "POST" },
    ).then((response) => response.json());
    assert.equal(secondCancel.ok, true);
    assert.equal(secondCancel.task.status, "cancelled");
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("Codex command provider uses agent auth without receiving an API key", async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "beemax-bridge-test-"));
  const command = [
    process.execPath,
    "--input-type=module",
    "-e",
    `
      import { readFile, writeFile } from "node:fs/promises";
      const chunks = [];
      for await (const chunk of process.stdin) chunks.push(chunk);
      const input = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      if (Object.hasOwn(input, "api_key")) process.exit(23);
      const image = input.output_path;
      await writeFile(image, Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+Xy4uAAAAAElFTkSuQmCC",
        "base64"
      ));
      process.stdout.write(JSON.stringify({
        success: true,
        image,
        provider: "openai-codex",
        model: input.model,
        aspect_ratio: input.aspect_ratio
      }));
    `,
  ];
  const server = createBridgeServer({
    dataDir,
    publicOrigin: "http://127.0.0.1:9999",
    providers: [createCommandCodexProvider({ command })],
  });

  try {
    const baseUrl = await listen(server);
    const submitted = await fetch(`${baseUrl}/api/image`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        prompt: "agent auth image",
        model: "gpt-image-2",
        quality: "high",
        size: "16:9",
        api_key: "must-not-cross-the-provider-boundary",
      }),
    }).then((response) => response.json());

    const task = await waitForTask(baseUrl, submitted.task_id);
    assert.equal(task.status, "completed");
    assert.equal(task.provider_id, "codex-native");
    assert.equal(task.source_result.model, "gpt-image-2-high");
    assert.equal(task.source_result.aspect_ratio, "landscape");

    const asset = await fetch(`${baseUrl}${new URL(task.server_urls[0]).pathname}`);
    assert.deepEqual(Buffer.from(await asset.arrayBuffer()), PNG_BYTES);

    const persistedTask = await readFile(
      path.join(dataDir, "tasks", `${submitted.task_id}.json`),
      "utf8",
    );
    assert.doesNotMatch(persistedTask, /must-not-cross-the-provider-boundary/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("direct Codex provider only needs Codex CLI auth and the Responses endpoint", async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "beemax-bridge-test-"));
  const authFile = path.join(dataDir, "codex-auth.json");
  const claims = Buffer.from(
    JSON.stringify({
      exp: Math.floor(Date.now() / 1000) + 3600,
      "https://api.openai.com/auth": { chatgpt_account_id: "account-for-test" },
    }),
  ).toString("base64url");
  await writeFile(
    authFile,
    JSON.stringify({ tokens: { access_token: `header.${claims}.signature` } }),
  );

  let responsesOrigin = "";
  const codexApi = createServer(async (request, response) => {
    assert.equal(request.method, "POST");
    assert.equal(request.url, "/responses");
    assert.equal(request.headers.authorization, "Bearer header." + claims + ".signature");
    assert.equal(request.headers.originator, "codex_cli_rs");
    assert.equal(request.headers["chatgpt-account-id"], "account-for-test");
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const payload = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    assert.equal(payload.tools[0].model, "gpt-image-2");
    assert.equal(payload.tools[0].quality, "high");
    assert.equal(payload.tools[0].size, "1536x1024");

    response.writeHead(200, { "content-type": "text/event-stream" });
    response.end(
      `event: response.image_generation_call.completed\n` +
        `data: ${JSON.stringify({
          item: {
            type: "image_generation_call",
            result: PNG_BYTES.toString("base64"),
          },
        })}\n\n`,
    );
  });
  responsesOrigin = await listen(codexApi);
  const server = createBridgeServer({
    dataDir,
    providers: [
      createDirectCodexProvider({
        authFile,
        baseUrl: responsesOrigin,
        timeoutMs: 1_000,
      }),
    ],
  });

  try {
    const baseUrl = await listen(server);
    const submitted = await fetch(`${baseUrl}/api/image`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        prompt: "direct agent auth",
        model: "gpt-image-2",
        quality: "high",
        size: "16:9",
      }),
    }).then((response) => response.json());
    const task = await waitForTask(baseUrl, submitted.task_id);

    assert.equal(task.status, "completed");
    assert.equal(task.provider_id, "codex-native");
    assert.equal(task.source_result.auth_source, "codex-cli");
    const asset = await fetch(`${baseUrl}${new URL(task.server_urls[0], baseUrl).pathname}`);
    assert.deepEqual(Buffer.from(await asset.arrayBuffer()), PNG_BYTES);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await new Promise((resolve) => codexApi.close(resolve));
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("relay fallback uses server-side credentials and localizes its image", async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "beemax-bridge-test-"));
  let upstreamOrigin = "";
  let submittedPayload;
  let queryCalls = 0;
  const upstream = createServer(async (request, response) => {
    const url = new URL(request.url, upstreamOrigin || "http://127.0.0.1");
    if (request.method === "POST" && url.pathname === "/api/image") {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      submittedPayload = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          success: true,
          image_urls: [`${upstreamOrigin}/generated.png`],
        }),
      );
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/task/relay-task-1") {
      queryCalls += 1;
      response.writeHead(500).end();
      return;
    }
    if (request.method === "GET" && url.pathname === "/generated.png") {
      response.writeHead(200, { "content-type": "image/png" });
      response.end(PNG_BYTES);
      return;
    }
    response.writeHead(404).end();
  });
  upstreamOrigin = await listen(upstream);

  const server = createBridgeServer({
    dataDir,
    publicOrigin: "http://127.0.0.1:9999",
    providers: [
      createRelayProvider({
        upstreamUrl: upstreamOrigin,
        apiBaseUrl: "https://relay.example/v1",
        apiKey: "server-side-relay-key",
        pollIntervalMs: 1,
      }),
    ],
  });

  try {
    const baseUrl = await listen(server);
    const submitted = await fetch(`${baseUrl}/api/image`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        prompt: "relay image",
        model: "relay-image-model",
        api_key: "browser-key-must-be-ignored",
        api_base_url: "https://browser.example/v1",
      }),
    }).then((response) => response.json());
    const task = await waitForTask(baseUrl, submitted.task_id);

    assert.equal(task.status, "completed");
    assert.equal(task.provider_id, "relay-main");
    assert.equal(submittedPayload.api_key, "server-side-relay-key");
    assert.equal(submittedPayload.api_base_url, "https://relay.example/v1");
    assert.equal(submittedPayload.async_mode, false);
    assert.equal(queryCalls, 0);
    assert.doesNotMatch(
      await readFile(path.join(dataDir, "tasks", `${submitted.task_id}.json`), "utf8"),
      /server-side-relay-key|browser-key-must-be-ignored/,
    );

    const asset = await fetch(`${baseUrl}${new URL(task.server_urls[0]).pathname}`);
    assert.deepEqual(Buffer.from(await asset.arrayBuffer()), PNG_BYTES);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await new Promise((resolve) => upstream.close(resolve));
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("relay rejects cross-origin image URLs returned by the upstream", async () => {
  const upstream = createServer((request, response) => {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(
      JSON.stringify({ success: true, image_urls: ["http://169.254.169.254/latest/meta-data"] }),
    );
  });
  const upstreamOrigin = await listen(upstream);
  const provider = createRelayProvider({
    upstreamUrl: upstreamOrigin,
    apiBaseUrl: "https://relay.example/v1",
    apiKey: "server-side-key",
  });

  try {
    await assert.rejects(
      provider.generate(
        { prompt: "blocked SSRF" },
        { signal: new AbortController().signal },
      ),
      /必须由原 Canvas 后端代理/,
    );
  } finally {
    await new Promise((resolve) => upstream.close(resolve));
  }
});

test("relay rejects image redirects even when the initial URL is same-origin", async () => {
  let upstreamOrigin = "";
  const upstream = createServer((request, response) => {
    if (request.method === "POST") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ success: true, image_urls: [`${upstreamOrigin}/redirect.png`] }));
      return;
    }
    response.writeHead(302, { location: "http://169.254.169.254/latest/meta-data" });
    response.end();
  });
  upstreamOrigin = await listen(upstream);
  const provider = createRelayProvider({
    upstreamUrl: upstreamOrigin,
    apiBaseUrl: "https://relay.example/v1",
    apiKey: "server-side-key",
  });

  try {
    await assert.rejects(
      provider.generate(
        { prompt: "blocked redirect" },
        { signal: new AbortController().signal },
      ),
      /不允许 HTTP 重定向/,
    );
  } finally {
    await new Promise((resolve) => upstream.close(resolve));
  }
});

test("non-Bridge routes are transparently proxied to the original Canvas backend", async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "beemax-bridge-test-"));
  const upstream = createServer(async (request, response) => {
    if (request.url === "/api/health") {
      response.writeHead(200, { "content-type": "application/json", "x-upstream": "yes" });
      response.end(JSON.stringify({ status: "ok" }));
      return;
    }
    if (request.method === "POST" && request.url === "/api/llm") {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      response.writeHead(200, { "content-type": "application/json" });
      response.end(Buffer.concat(chunks));
      return;
    }
    if (request.method === "GET" && request.url === "/api/task/legacy-task") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          success: true,
          data: { task_id: "legacy-task", status: "completed" },
          source: "legacy-backend",
        }),
      );
      return;
    }
    response.writeHead(404).end();
  });
  const upstreamOrigin = await listen(upstream);
  const server = createBridgeServer({
    dataDir,
    upstreamUrl: upstreamOrigin,
    providers: [{ id: "unused", async generate() {} }],
  });

  try {
    const baseUrl = await listen(server);
    const bridgeHealth = await fetch(`${baseUrl}/api/beemax/health`).then(
      (response) => response.json(),
    );
    assert.deepEqual(bridgeHealth, {
      status: "ok",
      service: "beemax-bridge",
      providers: ["unused"],
    });
    const capabilities = await fetch(`${baseUrl}/api/beemax/capabilities`).then(
      (response) => response.json(),
    );
    assert.equal(capabilities.success, true);
    assert.deepEqual(capabilities.image.generate.route, ["unused"]);
    assert.equal(capabilities.image.generate.async, true);
    assert.equal(capabilities.image.generate.cancel, true);

    const healthResponse = await fetch(`${baseUrl}/api/health`);
    assert.equal(healthResponse.status, 200);
    assert.equal(healthResponse.headers.get("x-upstream"), "yes");
    assert.deepEqual(await healthResponse.json(), { status: "ok" });

    const llmResponse = await fetch(`${baseUrl}/api/llm`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt: "still works" }),
    });
    assert.deepEqual(await llmResponse.json(), { prompt: "still works" });

    const legacyTask = await fetch(`${baseUrl}/api/task/legacy-task`).then(
      (response) => response.json(),
    );
    assert.equal(legacyTask.success, true);
    assert.equal(legacyTask.data.status, "completed");
    assert.equal(legacyTask.source, "legacy-backend");
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await new Promise((resolve) => upstream.close(resolve));
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("legacy runtime settings expose the managed BeeMax Codex image provider", async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "beemax-bridge-test-"));
  let savedSettings;
  const upstream = createServer(async (request, response) => {
    if (request.method === "PUT") {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      savedSettings = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ success: true, settings: savedSettings }));
      return;
    }
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ activeProviderId: "", providers: [] }));
  });
  const upstreamOrigin = await listen(upstream);
  const server = createBridgeServer({
    dataDir,
    upstreamUrl: upstreamOrigin,
    providers: [{ id: "codex-native", async generate() {} }],
  });

  try {
    const baseUrl = await listen(server);
    const settings = await fetch(`${baseUrl}/api/admin/runtime-settings`).then((response) =>
      response.json(),
    );
    assert.deepEqual(
      settings.providers.find((provider) => provider.id === "beemax-codex-agent"),
      {
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
      },
    );

    const updated = await fetch(`${baseUrl}/api/admin/runtime-settings`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        activeProviderId: "relay",
        providers: [settings.providers[0], { id: "relay", name: "Relay" }],
      }),
    }).then((response) => response.json());
    assert.deepEqual(savedSettings.providers, [{ id: "relay", name: "Relay" }]);
    assert.equal(updated.settings.providers[0].id, "beemax-codex-agent");
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await new Promise((resolve) => upstream.close(resolve));
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("completed Bridge tasks remain queryable after the service restarts", async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "beemax-bridge-test-"));
  const firstServer = createBridgeServer({
    dataDir,
    publicOrigin: "http://127.0.0.1:9999",
    providers: [
      {
        id: "codex-native",
        async generate() {
          return { bytes: PNG_BYTES, contentType: "image/png" };
        },
      },
    ],
  });
  let taskId;

  try {
    const firstUrl = await listen(firstServer);
    const submitted = await fetch(`${firstUrl}/api/image`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt: "durable task" }),
    }).then((response) => response.json());
    taskId = submitted.task_id;
    assert.equal((await waitForTask(firstUrl, taskId)).status, "completed");
  } finally {
    await new Promise((resolve) => firstServer.close(resolve));
  }

  const restartedServer = createBridgeServer({
    dataDir,
    publicOrigin: "http://127.0.0.1:9999",
    providers: [{ id: "unused", async generate() {} }],
  });
  try {
    const restartedUrl = await listen(restartedServer);
    const response = await fetch(`${restartedUrl}/api/task/${taskId}`);
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.data.status, "completed");
    assert.equal(body.data.prompt_summary, "durable task");

    const asset = await fetch(
      `${restartedUrl}${new URL(body.data.server_urls[0]).pathname}`,
    );
    assert.deepEqual(Buffer.from(await asset.arrayBuffer()), PNG_BYTES);
  } finally {
    await new Promise((resolve) => restartedServer.close(resolve));
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("Bridge tasks appear in the task center and respect project filters", async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "beemax-bridge-test-"));
  const server = createBridgeServer({
    dataDir,
    providers: [
      {
        id: "codex-native",
        async generate(payload) {
          return { bytes: PNG_BYTES, contentType: "image/png" };
        },
      },
    ],
  });

  try {
    const baseUrl = await listen(server);
    for (const [prompt, projectId, nodeId] of [
      ["project-a-image", "project-a", "node-a"],
      ["project-b-image", "project-b", "node-b"],
    ]) {
      const submitted = await fetch(`${baseUrl}/api/image`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt, project_id: projectId, node_id: nodeId }),
      }).then((response) => response.json());
      await waitForTask(baseUrl, submitted.task_id);
    }

    const response = await fetch(`${baseUrl}/api/tasks?project_id=project-a`);
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.success, true);
    assert.equal(body.total, 1);
    assert.equal(body.completed, 1);
    assert.equal(body.running, 0);
    assert.equal(body.tasks[0].project_id, "project-a");
    assert.equal(body.tasks[0].node_id, "node-a");
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("a timed-out Codex process is terminated before the router uses fallback", async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "beemax-bridge-test-"));
  const command = [
    process.execPath,
    "--input-type=module",
    "-e",
    "process.stdin.resume(); setInterval(() => {}, 1000);",
  ];
  const server = createBridgeServer({
    dataDir,
    providers: [
      createCommandCodexProvider({ command, timeoutMs: 30 }),
      {
        id: "relay-main",
        async generate() {
          return { bytes: PNG_BYTES, contentType: "image/png" };
        },
      },
    ],
  });

  try {
    const baseUrl = await listen(server);
    const submitted = await fetch(`${baseUrl}/api/image`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt: "timeout fallback" }),
    }).then((response) => response.json());
    const task = await waitForTask(baseUrl, submitted.task_id);

    assert.equal(task.status, "completed");
    assert.equal(task.provider_id, "relay-main");
    assert.match(task.route_events[0].error, /超时/);
    assert.deepEqual(
      task.route_events.map(({ provider_id, status }) => ({ provider_id, status })),
      [
        { provider_id: "codex-native", status: "failed" },
        { provider_id: "relay-main", status: "success" },
      ],
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("a failed task can be retried from its persisted non-secret request", async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "beemax-bridge-test-"));
  let calls = 0;
  const server = createBridgeServer({
    dataDir,
    providers: [
      {
        id: "codex-native",
        async generate(payload) {
          calls += 1;
          if (calls === 1) throw new Error("temporary failure");
          assert.equal(payload.prompt, "retry this image");
          assert.equal(payload.quality, "high");
          assert.equal(Object.hasOwn(payload, "api_key"), false);
          return { bytes: PNG_BYTES, contentType: "image/png" };
        },
      },
    ],
  });

  try {
    const baseUrl = await listen(server);
    const original = await fetch(`${baseUrl}/api/image`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        prompt: "retry this image",
        quality: "high",
        project_id: "retry-project",
        node_id: "retry-node",
        api_key: "do-not-persist",
      }),
    }).then((response) => response.json());
    const failedTask = await waitForTask(baseUrl, original.task_id);
    assert.equal(failedTask.status, "failed");
    assert.equal(failedTask.canonical_status, "error");

    const retryResponse = await fetch(
      `${baseUrl}/api/task/${original.task_id}/retry`,
      { method: "POST" },
    );
    const retried = await retryResponse.json();
    assert.equal(retryResponse.status, 200);
    assert.equal(retried.success, true);
    assert.notEqual(retried.task_id, original.task_id);
    assert.equal(retried.retry_of, original.task_id);

    const task = await waitForTask(baseUrl, retried.task_id);
    assert.equal(task.status, "completed");
    assert.equal(task.retry_of, original.task_id);
    assert.equal(task.project_id, "retry-project");
    assert.equal(task.node_id, "retry-node");
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("one image task generates and persists the requested batch quantity", async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "beemax-bridge-test-"));
  let calls = 0;
  const server = createBridgeServer({
    dataDir,
    publicOrigin: "http://127.0.0.1:9999",
    providers: [
      {
        id: "codex-native",
        async generate(payload) {
          calls += 1;
          assert.equal(payload.n, 1);
          return {
            bytes: PNG_BYTES,
            contentType: "image/png",
          };
        },
      },
    ],
  });

  try {
    const baseUrl = await listen(server);
    const submitted = await fetch(`${baseUrl}/api/image`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt: "two images", n: 2 }),
    }).then((response) => response.json());
    const task = await waitForTask(baseUrl, submitted.task_id);

    assert.equal(task.status, "completed");
    assert.equal(calls, 2);
    assert.equal(task.server_urls.length, 2);
    assert.notEqual(task.server_urls[0], task.server_urls[1]);
    assert.deepEqual(
      task.route_events.map(({ item_index, status }) => ({ item_index, status })),
      [
        { item_index: 0, status: "success" },
        { item_index: 1, status: "success" },
      ],
    );
    const contents = await Promise.all(
      task.server_urls.map((url) =>
        fetch(`${baseUrl}${new URL(url).pathname}`).then(async (response) =>
          Buffer.from(await response.arrayBuffer()),
        ),
      ),
    );
    assert.deepEqual(contents, [PNG_BYTES, PNG_BYTES]);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(dataDir, { recursive: true, force: true });
  }
});
