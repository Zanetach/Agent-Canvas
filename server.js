import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runMarketingCampaignLive, sampleKnowledgeBase } from "./src/marketingAgent.js";
import { writeCampaignArtifacts } from "./src/campaignArtifacts.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, "public");
const runsDir = path.join(__dirname, "data", "runs");
const port = Number(process.env.PORT ?? 5173);

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (req.method === "GET" && url.pathname === "/api/sample") {
      return json(res, { knowledge_base: sampleKnowledgeBase });
    }

    if (req.method === "POST" && url.pathname === "/api/run") {
      const body = await readJson(req);
      const result = await runMarketingCampaignLive(body);
      const artifacts = await writeCampaignArtifacts({
        result,
        outputRoot: path.join(__dirname, "outputs"),
        heroAssetPath: path.join(publicDir, "assets", "office-building-dusk-v1.png")
      });
      const artifactUrls = Object.fromEntries(
        Object.entries(artifacts)
          .filter(([name, file]) => name !== "run_dir" && file)
          .map(([name, file]) => [name, `/api/runs/${result.run_id}/artifacts/${file}`])
      );
      const record = {
        ...result,
        artifacts: artifactUrls
      };
      await fs.mkdir(runsDir, { recursive: true });
      await fs.writeFile(path.join(runsDir, `${result.run_id}.json`), JSON.stringify(record, null, 2));
      return json(res, record);
    }

    if (req.method === "GET" && /^\/api\/runs\/[^/]+$/.test(url.pathname)) {
      const runId = path.basename(url.pathname.replace("/api/runs/", ""), ".json");
      const raw = await fs.readFile(path.join(runsDir, `${runId}.json`), "utf8");
      return json(res, JSON.parse(raw));
    }

    if (req.method === "GET" && /^\/api\/runs\/[^/]+\/artifacts\/[^/]+$/.test(url.pathname)) {
      const [, runId, fileName] = url.pathname.match(/^\/api\/runs\/([^/]+)\/artifacts\/([^/]+)$/);
      return await serveArtifact(res, runId, fileName);
    }

    return await serveStatic(res, url.pathname);
  } catch (error) {
    console.error(error);
    return json(res, { error: error.message }, error.code === "ENOENT" ? 404 : 500);
  }
});

server.listen(port, () => {
  console.log(`Marketing Agent MVP running at http://localhost:${port}`);
});

async function serveStatic(res, pathname) {
  const safePath = pathname === "/" ? "/index.html" : pathname;
  const filePath = path.join(publicDir, safePath);
  if (!filePath.startsWith(publicDir)) {
    return text(res, "Forbidden", 403);
  }
  const data = await fs.readFile(filePath);
  const ext = path.extname(filePath);
  const type = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".svg": "image/svg+xml; charset=utf-8",
    ".png": "image/png",
    ".json": "application/json; charset=utf-8",
    ".md": "text/markdown; charset=utf-8",
    ".txt": "text/plain; charset=utf-8"
  }[ext] ?? "application/octet-stream";
  res.writeHead(200, { "Content-Type": type });
  res.end(data);
}

async function serveArtifact(res, runId, fileName) {
  const safeRunId = path.basename(runId);
  const safeFileName = path.basename(fileName);
  if (safeRunId !== runId || safeFileName !== fileName) return text(res, "Forbidden", 403);
  const filePath = path.join(__dirname, "outputs", safeRunId, safeFileName);
  const data = await fs.readFile(filePath);
  const type = {
    ".png": "image/png",
    ".svg": "image/svg+xml; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".md": "text/markdown; charset=utf-8",
    ".txt": "text/plain; charset=utf-8"
  }[path.extname(filePath)] ?? "application/octet-stream";
  res.writeHead(200, { "Content-Type": type, "Content-Disposition": `inline; filename="${safeFileName}"` });
  res.end(data);
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function json(res, data, status = 200) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data, null, 2));
}

function text(res, data, status = 200) {
  res.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" });
  res.end(data);
}
