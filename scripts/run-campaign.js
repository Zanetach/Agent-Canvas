import fs from "node:fs/promises";
import path from "node:path";
import { runMarketingCampaignLive } from "../src/marketingAgent.js";
import { writeCampaignArtifacts } from "../src/campaignArtifacts.js";

const root = path.resolve(import.meta.dirname, "..");
const inputFlag = process.argv.indexOf("--input");
const inputFile = inputFlag >= 0 ? process.argv[inputFlag + 1] : "examples/building-context.json";
if (!inputFile) throw new Error("--input requires a JSON file path");

const request = JSON.parse(await fs.readFile(path.resolve(root, inputFile), "utf8"));
const result = await runMarketingCampaignLive(request);
const artifacts = await writeCampaignArtifacts({
  result,
  outputRoot: path.join(root, "outputs"),
  heroAssetPath: path.join(root, "public", "assets", "office-building-dusk-v1.png")
});

console.log(JSON.stringify({ run_id: result.run_id, selected_topic: result.selected_topic, artifacts }, null, 2));
