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
  createHermesTextProvider,
  createRelayProvider,
} from "../src/providers.mjs";

const PNG_BYTES = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+Xy4uAAAAAElFTkSuQmCC",
  "base64",
);
const RGB_PNG_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGNgYGAAAAAEAAH2FzhVAAAAAElFTkSuQmCC";
const WIDE_ALPHA_PNG_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAAC0lEQVR4nGNggAIAAAkAAftSuKkAAAAASUVORK5CYII=";
const MASK_COMPOSITE_SOURCE = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAADklEQVR4nGP4z8DwHwQBEPgD/U6VwW8AAAAASUVORK5CYII=",
  "base64",
);
const MASK_COMPOSITE_GENERATED_16_BIT = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAIAAAABEAYAAACksqPJAAAAD0lEQVR4nGNgAIL/QACjATPdB/lvQcuBAAAAAElFTkSuQmCC",
  "base64",
);
const MASK_COMPOSITE_MASK = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAADElEQVR4nGNggID/AAEIAQBNGY85AAAAAElFTkSuQmCC",
  "base64",
);
const MASK_COMPOSITE_EXPECTED = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAAD0lEQVR4nGNgYPj/nwEIAQ76A/2ILbfFAAAAAElFTkSuQmCC",
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

test("capabilities publish the complete image operation contract", async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "beemax-bridge-test-"));
  const server = createBridgeServer({
    dataDir,
    providers: [
      {
        id: "codex-native",
        capabilities: {
          generate: true,
          edit: true,
          mask: true,
          outpaint: true,
          variation: true,
          references: 10,
          cancel: true,
        },
        async generate() {
          return { bytes: PNG_BYTES, contentType: "image/png" };
        },
      },
    ],
  });

  try {
    const baseUrl = await listen(server);
    const capabilities = await fetch(`${baseUrl}/api/beemax/capabilities`).then(
      (response) => response.json(),
    );
    assert.deepEqual(capabilities.image.operations, [
      "generate",
      "edit",
      "mask",
      "outpaint",
      "variation",
    ]);
    assert.equal(capabilities.image.inputs.local_file, true);
    assert.equal(capabilities.image.inputs.canvas_asset, true);
    assert.equal(capabilities.image.inputs.url, true);
    assert.equal(capabilities.image.inputs.data_url, true);
    assert.equal(capabilities.image.max_reference_images, 10);
    assert.equal(capabilities.prompt_presets.structured_content, true);
    assert.equal(capabilities.prompt_presets.list_endpoint, "/api/prompt-styles");
    assert.equal(
      capabilities.prompt_presets.render_endpoint,
      "/api/beemax/prompt-presets/render",
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("built-in poster presets appear in the style picker and render structured content", async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "beemax-poster-presets-test-"));
  const upstream = createServer((request, response) => {
    if (request.url === "/api/prompt-styles") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({
        styles: [
          {
            id: "upstream-existing-style",
            name: "原有官方风格",
            category: "其他",
            prompt: "保留原有风格。",
          },
        ],
      }));
      return;
    }
    response.writeHead(404).end();
  });
  const upstreamUrl = await listen(upstream);
  const server = createBridgeServer({
    dataDir,
    upstreamUrl,
    providers: [
      {
        id: "unused-image-provider",
        capabilities: { generate: true },
        async generate() {
          return { bytes: PNG_BYTES, contentType: "image/png" };
        },
      },
    ],
  });

  try {
    const baseUrl = await listen(server);
    const stylesResponse = await fetch(`${baseUrl}/api/prompt-styles`);
    const stylesBody = await stylesResponse.json();
    assert.equal(stylesResponse.status, 200);
    assert.deepEqual(
      stylesBody.styles.slice(0, 3).map((style) => style.id),
      [
        "beemax-poster-emerald-data",
        "beemax-poster-ivory-legal",
        "beemax-poster-navy-admissions",
      ],
    );
    assert.equal(stylesBody.styles[3].id, "upstream-existing-style");
    assert.ok(
      stylesBody.styles.slice(0, 3).every(
        (style) => style.category === "BeeMax 商业海报",
      ),
    );
    assert.match(
      stylesBody.styles.find((style) => style.id === "beemax-poster-ivory-legal").prompt,
      /温暖象牙白纸张背景.*深海军蓝.*香槟金/s,
    );
    assert.match(
      stylesBody.styles.find((style) => style.id === "beemax-poster-navy-admissions").prompt,
      /深海军蓝渐变背景.*少量高饱和红色只用于关键截止日期/s,
    );

    const renderResponse = await fetch(`${baseUrl}/api/beemax/prompt-presets/render`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        style_id: "beemax-poster-emerald-data",
        content: {
          主题: "年度业务数据",
          品牌名称: "示例集团",
          主标题: "2026 年度增长报告",
          副标题: "稳健经营，长期增长",
          核心数据: "312.9 亿元，同比增长 39%",
          信息模块一: "规模｜全年新造业务保费",
          信息模块二: "增长｜核心市场持续增长",
          信息模块三: "排名｜区域市场第 2 位",
          CTA: "查看完整报告",
          合规文字: "数据仅供信息展示，不构成投资建议。",
        },
      }),
    });
    const rendered = await renderResponse.json();

    assert.equal(renderResponse.status, 200);
    assert.equal(rendered.style_id, "beemax-poster-emerald-data");
    assert.equal(rendered.aspect_ratio, "3:4");
    assert.match(rendered.prompt, /【固定风格 STYLE LOCK】/);
    assert.match(rendered.prompt, /翡翠绿和青绿色单色体系/);
    assert.match(rendered.prompt, /品牌名称：示例集团/);
    assert.match(rendered.prompt, /核心数字或日期：312\.9 亿元，同比增长 39%/);
    assert.doesNotMatch(rendered.prompt, /\{\{/);

    const briefResponse = await fetch(`${baseUrl}/api/beemax/prompt-presets/render`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        style_id: "beemax-poster-emerald-data",
        brief: "为宏利示例制作保险年度业绩海报，核心数据312.9亿元，同比增长39%。",
      }),
    });
    const briefRendered = await briefResponse.json();
    assert.equal(briefResponse.status, 200);
    assert.match(briefRendered.prompt, /用户原始需求：为宏利示例制作保险年度业绩海报/);
    assert.match(briefRendered.prompt, /未明确提供的信息必须省略/);

    const incompleteResponse = await fetch(
      `${baseUrl}/api/beemax/prompt-presets/render`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          style_id: "beemax-poster-emerald-data",
          content: { 主题: "年度业务数据" },
        }),
      },
    );
    const incomplete = await incompleteResponse.json();
    assert.equal(incompleteResponse.status, 422);
    assert.match(incomplete.error, /缺少 CONTENT 字段/);

    const placeholderResponse = await fetch(
      `${baseUrl}/api/beemax/prompt-presets/render`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          style_id: "beemax-poster-emerald-data",
          content: {
            主题: "年度业务数据",
            品牌名称: "{{品牌名称}}",
            主标题: "2026 年度增长报告",
            副标题: "稳健经营，长期增长",
            核心数据: "312.9 亿元，同比增长 39%",
            信息模块一: "规模｜全年新造业务保费",
            信息模块二: "增长｜核心市场持续增长",
            信息模块三: "排名｜区域市场第 2 位",
            CTA: "查看完整报告",
            合规文字: "数据仅供信息展示，不构成投资建议。",
          },
        }),
      },
    );
    const placeholder = await placeholderResponse.json();
    assert.equal(placeholderResponse.status, 422);
    assert.match(placeholder.error, /仍包含占位符/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await new Promise((resolve) => upstream.close(resolve));
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("edit requests preserve operation, source provenance, and parent relationship", async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "beemax-bridge-test-"));
  let providerPayload;
  const source = `data:image/png;base64,${PNG_BYTES.toString("base64")}`;
  const server = createBridgeServer({
    dataDir,
    providers: [
      {
        id: "codex-native",
        capabilities: { generate: true, edit: true, references: 10 },
        async generate(payload) {
          providerPayload = payload;
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
      body: JSON.stringify({
        operation: "edit",
        prompt: "turn the bee blue",
        input_images: [
          { url: source, asset_id: "asset-source-1", node_id: "node-source-1" },
        ],
        parent_asset_id: "asset-source-1",
      }),
    }).then((response) => response.json());
    const task = await waitForTask(baseUrl, submitted.task_id);

    assert.equal(providerPayload.operation, "edit");
    assert.equal(providerPayload.input_images.length, 1);
    assert.equal(providerPayload.input_images[0].url, source);
    assert.equal(task.generation.operation, "edit");
    assert.equal(task.source_assets[0].asset_id, "asset-source-1");
    assert.equal(task.source_assets[0].node_id, "node-source-1");
    assert.equal(task.parent_asset_id, "asset-source-1");
    assert.equal(task.media_records[0].operation, "edit");
    assert.equal(task.media_records[0].parent_asset_id, "asset-source-1");
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("unsupported operations fail before a task is created", async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "beemax-bridge-test-"));
  const server = createBridgeServer({
    dataDir,
    providers: [
      {
        id: "generate-only",
        capabilities: { generate: true, edit: false, mask: false, references: 0 },
        async generate() {
          throw new Error("must not run");
        },
      },
    ],
  });

  try {
    const baseUrl = await listen(server);
    const response = await fetch(`${baseUrl}/api/image`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        operation: "mask",
        prompt: "replace the marked area",
        input_images: [`data:image/png;base64,${PNG_BYTES.toString("base64")}`],
        mask_image: `data:image/png;base64,${PNG_BYTES.toString("base64")}`,
      }),
    });
    const body = await response.json();
    assert.equal(response.status, 422);
    assert.equal(body.success, false);
    assert.match(body.error, /没有 Provider 支持 mask/);
    assert.equal(body.required_capability.operation, "mask");
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("reference generation skips providers without reference input capability", async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "beemax-bridge-test-"));
  const routeCalls = [];
  const server = createBridgeServer({
    dataDir,
    providers: [
      {
        id: "generate-only",
        capabilities: { generate: true, references: 0 },
        async generate() {
          routeCalls.push("generate-only");
          throw new Error("must not run");
        },
      },
      {
        id: "codex-native",
        capabilities: { generate: true, references: 10 },
        async generate() {
          routeCalls.push("codex-native");
          return { bytes: PNG_BYTES, contentType: "image/png" };
        },
      },
    ],
  });

  try {
    const baseUrl = await listen(server);
    const source = `data:image/png;base64,${PNG_BYTES.toString("base64")}`;
    const submitted = await fetch(`${baseUrl}/api/image`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        operation: "generate",
        prompt: "generate from this reference",
        input_images: [source],
      }),
    }).then((response) => response.json());
    const task = await waitForTask(baseUrl, submitted.task_id);

    assert.equal(task.canonical_status, "success");
    assert.deepEqual(routeCalls, ["codex-native"]);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("image requests reject more than ten reference images", async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "beemax-bridge-test-"));
  const server = createBridgeServer({
    dataDir,
    providers: [
      {
        id: "unused",
        async generate() {
          throw new Error("must not run");
        },
      },
    ],
  });

  try {
    const baseUrl = await listen(server);
    const source = `data:image/png;base64,${PNG_BYTES.toString("base64")}`;
    const response = await fetch(`${baseUrl}/api/image`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        operation: "edit",
        prompt: "combine these references",
        input_images: Array.from({ length: 11 }, () => source),
      }),
    });
    const body = await response.json();

    assert.equal(response.status, 422);
    assert.equal(body.success, false);
    assert.match(body.error, /参考图最多 10 张/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("Canvas image assets over fifty megabytes are rejected before download", async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "beemax-bridge-test-"));
  let providerCalls = 0;
  const upstream = createServer((_request, response) => {
    response.writeHead(200, {
      "content-type": "image/png",
      "content-length": String(50 * 1024 * 1024 + 1),
    });
    response.end();
  });
  const upstreamUrl = await listen(upstream);
  const server = createBridgeServer({
    dataDir,
    upstreamUrl,
    providers: [
      {
        id: "codex-native",
        capabilities: { generate: true, edit: true, references: 10 },
        async generate() {
          providerCalls += 1;
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
      body: JSON.stringify({
        operation: "edit",
        prompt: "edit an oversized source",
        input_images: ["/uploads/oversized.png"],
      }),
    }).then((response) => response.json());
    const task = await waitForTask(baseUrl, submitted.task_id);

    assert.equal(task.canonical_status, "error");
    assert.match(task.error.message, /超过 50 MB/);
    assert.equal(providerCalls, 0);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await new Promise((resolve) => upstream.close(resolve));
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("mask requests require an alpha PNG matching the source dimensions", async () => {
  const source = RGB_PNG_DATA_URL;
  for (const [mask, expectedError] of [
    [RGB_PNG_DATA_URL, /alpha 通道/],
    [WIDE_ALPHA_PNG_DATA_URL, /尺寸必须一致/],
  ]) {
    const dataDir = await mkdtemp(path.join(tmpdir(), "beemax-bridge-test-"));
    let providerCalls = 0;
    const server = createBridgeServer({
      dataDir,
      providers: [
        {
          id: "codex-native",
          capabilities: { generate: true, mask: true, references: 10 },
          async generate() {
            providerCalls += 1;
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
        body: JSON.stringify({
          operation: "mask",
          prompt: "replace only the masked area",
          input_images: [source],
          mask_image: mask,
        }),
      }).then((response) => response.json());
      const task = await waitForTask(baseUrl, submitted.task_id);

      assert.equal(task.canonical_status, "error");
      assert.match(task.error.message, expectedError);
      assert.equal(providerCalls, 0);
    } finally {
      await new Promise((resolve) => server.close(resolve));
      await rm(dataDir, { recursive: true, force: true });
    }
  }
});

test("mask results preserve every source pixel outside the transparent mask", async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "beemax-mask-composite-test-"));
  const server = createBridgeServer({
    dataDir,
    publicOrigin: "http://127.0.0.1:9999",
    providers: [
      {
        id: "codex-native",
        capabilities: { generate: true, mask: true, references: 10 },
        async generate() {
          return { bytes: MASK_COMPOSITE_GENERATED_16_BIT, contentType: "image/png" };
        },
      },
    ],
  });

  try {
    const baseUrl = await listen(server);
    const submitted = await fetch(`${baseUrl}/api/image`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        operation: "mask",
        prompt: "replace only the transparent pixel",
        input_images: [
          `data:image/png;base64,${MASK_COMPOSITE_SOURCE.toString("base64")}`,
        ],
        mask_image: `data:image/png;base64,${MASK_COMPOSITE_MASK.toString("base64")}`,
      }),
    }).then((response) => response.json());
    const task = await waitForTask(baseUrl, submitted.task_id);
    const assetPath = new URL(task.server_urls[0]).pathname;
    const result = Buffer.from(await fetch(`${baseUrl}${assetPath}`).then((response) => response.arrayBuffer()));

    assert.deepEqual(result, MASK_COMPOSITE_EXPECTED);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("mask requests reject uncontrolled remote source and mask URLs", async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "beemax-bridge-test-"));
  const server = createBridgeServer({
    dataDir,
    providers: [
      {
        id: "codex-native",
        capabilities: { generate: true, mask: true, references: 10 },
        async generate() {
          throw new Error("must not run");
        },
      },
    ],
  });

  try {
    const baseUrl = await listen(server);
    const response = await fetch(`${baseUrl}/api/image`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        operation: "mask",
        prompt: "edit the masked area",
        input_images: ["https://example.com/source.png"],
        mask_image: "https://example.com/mask.png",
      }),
    });
    const body = await response.json();

    assert.equal(response.status, 422);
    assert.match(body.error, /必须先上传为 Canvas 资产/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("mask requests accept absolute URLs from the configured Canvas backend", async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "beemax-bridge-test-"));
  const upstream = createServer((_request, response) => {
    response.writeHead(200, {
      "content-type": "image/png",
      "content-length": String(MASK_COMPOSITE_MASK.length),
    });
    response.end(MASK_COMPOSITE_MASK);
  });
  const upstreamUrl = await listen(upstream);
  let providerCalls = 0;
  const server = createBridgeServer({
    dataDir,
    upstreamUrl,
    providers: [
      {
        id: "codex-native",
        capabilities: { generate: true, mask: true, references: 10 },
        async generate() {
          providerCalls += 1;
          return { bytes: MASK_COMPOSITE_MASK, contentType: "image/png" };
        },
      },
    ],
  });

  try {
    const baseUrl = await listen(server);
    const response = await fetch(`${baseUrl}/api/image`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        operation: "mask",
        prompt: "edit the masked area",
        input_images: [`${upstreamUrl}/uploads/source.png`],
        mask_image: `${upstreamUrl}/uploads/mask.png`,
      }),
    });
    const submitted = await response.json();

    assert.equal(response.status, 200);
    const task = await waitForTask(baseUrl, submitted.task_id);
    assert.equal(task.canonical_status, "success");
    assert.equal(providerCalls, 1);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await new Promise((resolve) => upstream.close(resolve));
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("direct Codex provider sends reference images and mask to the Responses tool", async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "beemax-provider-test-"));
  const authFile = path.join(dataDir, "codex-auth.json");
  const claims = Buffer.from(
    JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 }),
  ).toString("base64url");
  await writeFile(
    authFile,
    JSON.stringify({ tokens: { access_token: `header.${claims}.signature` } }),
  );
  const source = `data:image/png;base64,${PNG_BYTES.toString("base64")}`;
  let received;
  const codexApi = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    received = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    response.writeHead(200, { "content-type": "text/event-stream" });
    response.end(
      `data: ${JSON.stringify({ item: { type: "image_generation_call", result: PNG_BYTES.toString("base64") } })}\n\n`,
    );
  });
  const origin = await listen(codexApi);
  const provider = createDirectCodexProvider({ authFile, baseUrl: origin, timeoutMs: 1_000 });

  try {
    const generated = await provider.generate(
      {
        operation: "mask",
        prompt: "replace the marked area with blue circuitry",
        input_images: [{ url: source }, { url: source }],
        mask_image: { url: source },
        quality: "high",
        size: "1:1",
      },
      { signal: new AbortController().signal },
    );
    assert.deepEqual(generated.bytes, PNG_BYTES);
    assert.equal(provider.capabilities.edit, true);
    assert.equal(provider.capabilities.mask, true);
    assert.equal(provider.capabilities.outpaint, true);
    assert.equal(provider.capabilities.variation, true);
    assert.equal(provider.capabilities.references, 10);
    assert.deepEqual(
      received.input[0].content.map((item) => item.type),
      ["input_text", "input_image", "input_image"],
    );
    assert.equal(received.input[0].content[1].image_url, source);
    assert.equal(received.tools[0].input_image_mask.image_url, source);
    assert.equal(received.tools[0].size, "auto");

    await provider.generate(
      {
        operation: "edit",
        prompt: "add a small cat inside the existing scene",
        input_images: [{ url: source }],
        size: "3:4",
      },
      { signal: new AbortController().signal },
    );
    assert.equal(received.tools[0].size, "auto");
    assert.match(
      received.input[0].content[0].text,
      /Use the first input image as the base canvas.*exact composition.*dimensions/s,
    );

    await provider.generate(
      {
        operation: "outpaint",
        prompt: "continue the blue circuit background",
        input_images: [{ url: source }],
        resolution: "4k",
        size: "16:9",
      },
      { signal: new AbortController().signal },
    );
    assert.equal(received.tools[0].size, "3840x2160");
    assert.match(received.input[0].content[0].text, /^Outpaint the first input image/);

    await provider.generate(
      {
        operation: "variation",
        prompt: "try a more minimal composition",
        input_images: [{ url: source }],
        size: "1:1",
      },
      { signal: new AbortController().signal },
    );
    assert.equal(received.tools[0].size, "auto");
    assert.match(received.input[0].content[0].text, /^Create a distinct but close variation/);
  } finally {
    await new Promise((resolve) => codexApi.close(resolve));
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("Canvas asset URLs are converted to private data URLs before provider dispatch", async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "beemax-bridge-test-"));
  let upstreamOrigin = "";
  const upstream = createServer((request, response) => {
    if (request.url === "/uploads/images/source.png") {
      response.writeHead(200, { "content-type": "image/png" });
      response.end(PNG_BYTES);
      return;
    }
    response.writeHead(404).end();
  });
  upstreamOrigin = await listen(upstream);
  let providerPayload;
  const server = createBridgeServer({
    dataDir,
    upstreamUrl: upstreamOrigin,
    providers: [
      {
        id: "codex-native",
        capabilities: { generate: true, edit: true, references: 10 },
        async generate(payload) {
          providerPayload = payload;
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
      body: JSON.stringify({
        operation: "edit",
        prompt: "make the logo blue",
        input_images: ["/uploads/images/source.png"],
      }),
    }).then((response) => response.json());
    const task = await waitForTask(baseUrl, submitted.task_id);

    assert.equal(task.status, "completed");
    assert.equal(
      providerPayload.input_images[0].url,
      `data:image/png;base64,${PNG_BYTES.toString("base64")}`,
    );
    assert.equal(task.source_assets[0].url, "/uploads/images/source.png");
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await new Promise((resolve) => upstream.close(resolve));
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("legacy Canvas annotation payload is promoted to a native mask operation", async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "beemax-bridge-test-"));
  const source = `data:image/png;base64,${MASK_COMPOSITE_MASK.toString("base64")}`;
  let providerPayload;
  const server = createBridgeServer({
    dataDir,
    providers: [
      {
        id: "codex-native",
        capabilities: { generate: true, edit: true, mask: true, references: 10 },
        async generate(payload) {
          providerPayload = payload;
          return { bytes: MASK_COMPOSITE_MASK, contentType: "image/png" };
        },
      },
    ],
  });

  try {
    const baseUrl = await listen(server);
    const submitted = await fetch(`${baseUrl}/api/image`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        prompt: "请基于参考图进行局部编辑。遮罩规则：白色区域是需要修改的区域，黑色区域必须保持原图不变。",
        image_urls: [source, source],
      }),
    }).then((response) => response.json());
    const task = await waitForTask(baseUrl, submitted.task_id);

    assert.equal(task.status, "completed");
    assert.equal(task.generation.operation, "mask");
    assert.equal(providerPayload.input_images.length, 1);
    assert.equal(providerPayload.mask_image.url, source);
    assert.match(task.mask_asset.url, /\[redacted\]$/);
    assert.deepEqual(task.media_records[0].mask_asset, task.mask_asset);
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
      if (input.operation === "analyze") {
        process.stdout.write(JSON.stringify({ success: true, text: "一张测试参考图" }));
        process.exit(0);
      }
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
  const provider = createCommandCodexProvider({ command });
  assert.equal(provider.capabilities.generate, true);
  assert.equal(provider.capabilities.edit, false);
  assert.equal(provider.capabilities.references, 0);
  assert.equal(
    await provider.analyzeImages({
      imageUrls: [`data:image/png;base64,${PNG_BYTES.toString("base64")}`],
      prompt: "描述图片",
    }),
    "一张测试参考图",
  );
  const server = createBridgeServer({
    dataDir,
    publicOrigin: "http://127.0.0.1:9999",
    providers: [provider],
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
    assert.equal(payload.tools[0].size, "1536x864");

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

test("direct Codex provider analyzes reference images through the Responses endpoint", async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "beemax-codex-vision-test-"));
  const authFile = path.join(dataDir, "auth.json");
  const claims = Buffer.from(
    JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: "vision-account" } }),
  ).toString("base64url");
  await writeFile(
    authFile,
    JSON.stringify({ tokens: { access_token: `header.${claims}.signature` } }),
  );
  let receivedPayload;
  const codexApi = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    receivedPayload = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    response.writeHead(200, { "content-type": "text/event-stream" });
    response.end(
      `event: response.output_text.delta\n` +
        `data: ${JSON.stringify({
          type: "response.output_text.delta",
          delta: "图片中是一只虎斑猫。",
        })}\n\n`,
    );
  });
  const baseUrl = await listen(codexApi);

  try {
    const provider = createDirectCodexProvider({ authFile, baseUrl, timeoutMs: 1_000 });
    const imageUrl = `data:image/png;base64,${PNG_BYTES.toString("base64")}`;
    const text = await provider.analyzeImages({
      imageUrls: [imageUrl],
      prompt: "描述参考图",
    });
    assert.equal(text, "图片中是一只虎斑猫。");
    assert.equal(receivedPayload.model, "gpt-5.4");
    assert.equal(receivedPayload.stream, true);
    assert.deepEqual(receivedPayload.input[0].content, [
      { type: "input_text", text: "描述参考图" },
      { type: "input_image", image_url: imageUrl },
    ]);
  } finally {
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
    if (request.url === "/") {
      response.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "public, max-age=31536000",
      });
      response.end("<!doctype html><title>Canvas</title>");
      return;
    }
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
    const frontendResponse = await fetch(`${baseUrl}/`);
    assert.equal(frontendResponse.headers.get("cache-control"), "no-store");
    assert.match(await frontendResponse.text(), /<title>Canvas<\/title>/);
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
    assert.equal(settings.activeProviderId, "beemax-codex-agent");
    assert.deepEqual(
      settings.providers.find((provider) => provider.id === "beemax-codex-agent"),
      {
        id: "beemax-codex-agent",
        name: "BeeMax Hermes + Codex Agent",
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

test("managed BeeMax Codex provider exposes and serves text generation", async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "beemax-bridge-test-"));
  let receivedTextPayload;
  const upstream = createServer((request, response) => {
    if (request.url === "/uploads/reference.png") {
      response.writeHead(200, {
        "content-type": "image/png",
        "content-length": PNG_BYTES.length,
      });
      response.end(PNG_BYTES);
      return;
    }
    if (request.url === "/api/admin/runtime-settings") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ providers: [] }));
      return;
    }
    response.writeHead(404).end();
  });
  const upstreamUrl = await listen(upstream);
  const server = createBridgeServer({
    dataDir,
    upstreamUrl,
    providers: [
      {
        id: "codex-native",
        capabilities: { generate: true, text: true },
        textModels: ["glm-test-text"],
        async generate() {
          return { bytes: PNG_BYTES, contentType: "image/png" };
        },
        async generateText(payload) {
          receivedTextPayload = payload;
          return { text: "这是一段由 Codex 生成的文本。", model: "gpt-5.4" };
        },
      },
    ],
  });

  try {
    const baseUrl = await listen(server);
    const settings = await fetch(`${baseUrl}/api/admin/runtime-settings`).then(
      (response) => response.json(),
    );
    const managed = settings.providers.find(
      (provider) => provider.id === "beemax-codex-agent",
    );
    assert.deepEqual(managed.textModels, ["glm-test-text"]);
    assert.equal(managed.defaultTextModel, "glm-test-text");

    const response = await fetch(`${baseUrl}/api/llm`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        provider_id: "beemax-codex-agent",
        model_name: "glm-test-text",
        system_prompt: "你是专业文案助手。",
        user_prompt: "写一句科技品牌标语。",
        temperature: 0.7,
        max_tokens: 256,
        image_urls: ["/uploads/reference.png"],
        api_key: "must-not-cross-provider-boundary",
      }),
    });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.response, "这是一段由 Codex 生成的文本。");
    assert.deepEqual(receivedTextPayload, {
      model: "glm-test-text",
      systemPrompt: "你是专业文案助手。",
      userPrompt: "写一句科技品牌标语。",
      temperature: 0.7,
      maxTokens: 256,
      imageUrls: [`data:image/png;base64,${PNG_BYTES.toString("base64")}`],
    });

    const protocolOnlyResponse = await fetch(`${baseUrl}/api/llm`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        api_protocol: "beemax",
        model_name: "glm-test-text",
        user_prompt: "兼容未携带 provider_id 的智能拆分请求。",
      }),
    });
    const protocolOnlyBody = await protocolOnlyResponse.json();

    assert.equal(protocolOnlyResponse.status, 200);
    assert.equal(protocolOnlyBody.response, "这是一段由 Codex 生成的文本。");
    assert.equal(receivedTextPayload.userPrompt, "兼容未携带 provider_id 的智能拆分请求。");

    const unsupported = await fetch(`${baseUrl}/api/llm`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        provider_id: "beemax-codex-agent",
        model_name: "unknown-text-model",
        user_prompt: "不能路由到其他模型",
      }),
    });
    assert.equal(unsupported.status, 422);
    assert.match((await unsupported.json()).error, /没有文本 Provider 支持模型/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await new Promise((resolve) => upstream.close(resolve));
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("Hermes text provider discovers the configured model without exposing credentials", async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "beemax-hermes-test-"));
  const configFile = path.join(dataDir, "config.yaml");
  await writeFile(
    configFile,
    [
      "model:",
      "  default: glm-test-2026",
      "  provider: custom:test-provider",
      "  api_key: must-never-leave-hermes",
      "providers:",
      "  custom:test-provider:",
      "    base_url: https://example.invalid/v1",
    ].join("\n"),
  );
  const command = [
    process.execPath,
    "-e",
    "process.stdout.write('Hermes generated text')",
    "--",
  ];

  try {
    const provider = await createHermesTextProvider({ configFile, command });
    assert.equal(provider.id, "hermes-agent");
    assert.deepEqual(provider.textModels, ["glm-test-2026"]);
    assert.equal(provider.defaultTextModel, "glm-test-2026");
    assert.doesNotMatch(JSON.stringify(provider), /must-never-leave-hermes/);

    const result = await provider.generateText(
      {
        model: "glm-test-2026",
        systemPrompt: "You are a copywriter.",
        userPrompt: "Write a slogan.",
      },
      { signal: new AbortController().signal },
    );
    assert.deepEqual(result, {
      text: "Hermes generated text",
      model: "glm-test-2026",
      provider: "custom:test-provider",
    });
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("Hermes text provider falls back to a native CLI attachment when Codex vision fails", async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "beemax-hermes-vision-test-"));
  const configFile = path.join(dataDir, "config.yaml");
  await writeFile(
    configFile,
    "model:\n  default: vision-test-model\n  provider: custom:vision-test\n",
    "utf8",
  );
  const command = [
    process.execPath,
    "-e",
    [
      "const fs = require('node:fs');",
      "const args = process.argv.slice(1);",
      "const imageIndex = args.indexOf('--image');",
      "const imagePath = imageIndex >= 0 ? args[imageIndex + 1] : '';",
      "process.stdout.write(JSON.stringify({",
      "  chat: args[0] === 'chat',",
      "  quiet: args.includes('-Q'),",
      "  hasImage: Boolean(imagePath) && fs.existsSync(imagePath),",
      "  imageBytes: imagePath && fs.existsSync(imagePath) ? fs.readFileSync(imagePath).length : 0",
      "}));",
    ].join(""),
    "--",
  ];

  try {
    const provider = await createHermesTextProvider({
      configFile,
      command,
      async visionAnalyzer() {
        throw new Error("Codex vision unavailable");
      },
    });
    const result = await provider.generateText({
      model: "vision-test-model",
      userPrompt: "描述这张参考图片",
      imageUrls: [`data:image/png;base64,${PNG_BYTES.toString("base64")}`],
    });
    assert.deepEqual(JSON.parse(result.text), {
      chat: true,
      quiet: true,
      hasImage: true,
      imageBytes: PNG_BYTES.length,
    });
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("Hermes text provider uses a Codex vision summary before text generation", async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "beemax-hermes-hybrid-test-"));
  const configFile = path.join(dataDir, "config.yaml");
  await writeFile(
    configFile,
    "model:\n  default: hybrid-text-model\n  provider: custom:hybrid\n",
    "utf8",
  );
  let analyzedImages;
  const command = [
    process.execPath,
    "-e",
    "process.stdout.write(process.argv.slice(1).join(' '))",
    "--",
  ];

  try {
    const provider = await createHermesTextProvider({
      configFile,
      command,
      async visionAnalyzer({ imageUrls }) {
        analyzedImages = imageUrls;
        return "图片中是一只坐着的虎斑猫。";
      },
    });
    const imageUrl = `data:image/png;base64,${PNG_BYTES.toString("base64")}`;
    const result = await provider.generateText({
      model: "hybrid-text-model",
      userPrompt: "为这张图写一句标题",
      imageUrls: [imageUrl],
    });
    assert.deepEqual(analyzedImages, [imageUrl]);
    assert.match(result.text, /参考图片视觉摘要/);
    assert.match(result.text, /图片中是一只坐着的虎斑猫/);
    assert.doesNotMatch(result.text, /--image/);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("Hermes text provider is not published when its configured executable is missing", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "beemax-hermes-missing-test-"));
  const configFile = path.join(root, "config.yaml");
  await writeFile(configFile, "model:\n  default: glm-test-text\n", "utf8");
  await assert.rejects(
    createHermesTextProvider({
      configFile,
      command: [path.join(root, "missing-hermes")],
    }),
    /ENOENT/,
  );
  await rm(root, { recursive: true, force: true });
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
