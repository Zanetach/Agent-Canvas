#!/usr/bin/env node

import { spawn } from 'node:child_process';

import { BeeMaxCanvasClient, registerAgentCapabilities } from '../src/index.js';

const OPERATIONS = new Set(['generate', 'references', 'edit', 'mask', 'outpaint', 'variation']);

function help() {
  return `BeeMax Canvas for Zylos

Usage:
  beemax.js status
  beemax.js generate --prompt TEXT [options]
  beemax.js references --input IMAGE [--input IMAGE] --prompt TEXT [options]
  beemax.js edit --input IMAGE --prompt TEXT [options]
  beemax.js mask --input IMAGE --mask MASK.png --prompt TEXT [options]
  beemax.js outpaint --input IMAGE --prompt TEXT --aspect-ratio 16:9 [options]
  beemax.js variation --input IMAGE --prompt TEXT [options]
  beemax.js import --input IMAGE
  beemax.js task --task-id ID
  beemax.js cancel --task-id ID
  beemax.js retry --task-id ID
  beemax.js open [--no-launch]

Options:
  --input PATH_OR_URL       Repeat for up to ten reference images
  --mask PATH_OR_URL        Alpha PNG mask for the mask command
  --prompt TEXT             Generation or editing instruction
  --aspect-ratio RATIO      1:1, 16:9, 3:4, or 9:16
  --resolution VALUE        1k, 2k, or 4k
  --quality VALUE           low, medium, or high
  --model NAME              Image model override
  --count NUMBER            Number of outputs, 1-4
  --project-id ID           Canvas project ID
  --node-id ID              Canvas node ID
  --parent-asset-id ID      Parent asset provenance
  --timeout SECONDS         Request and task timeout
  --no-wait                 Return immediately after task submission
  --base-url URL            Override BeeMax Canvas URL
  --no-launch               Print the web URL without launching a browser
  --help                    Show this help`;
}

function parseArgs(argv) {
  const parsed = { inputs: [], wait: true, launch: true };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith('-') && !parsed.command) parsed.command = arg;
    else if (arg === '--input' || arg === '-i') parsed.inputs.push(argv[++index]);
    else if (arg === '--prompt' || arg === '-p') parsed.prompt = argv[++index];
    else if (arg === '--mask') parsed.mask = argv[++index];
    else if (arg === '--aspect-ratio') parsed.aspectRatio = argv[++index];
    else if (arg === '--resolution') parsed.resolution = argv[++index];
    else if (arg === '--quality') parsed.quality = argv[++index];
    else if (arg === '--model') parsed.model = argv[++index];
    else if (arg === '--count') parsed.count = Number(argv[++index]);
    else if (arg === '--project-id') parsed.projectId = argv[++index];
    else if (arg === '--node-id') parsed.nodeId = argv[++index];
    else if (arg === '--parent-asset-id') parsed.parentAssetId = argv[++index];
    else if (arg === '--task-id') parsed.taskId = argv[++index];
    else if (arg === '--timeout') parsed.timeoutSeconds = Number(argv[++index]);
    else if (arg === '--base-url') parsed.baseUrl = argv[++index];
    else if (arg === '--no-wait') parsed.wait = false;
    else if (arg === '--launch') parsed.launch = true;
    else if (arg === '--no-launch') parsed.launch = false;
    else if (arg === '--help' || arg === '-h') parsed.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return parsed;
}

function launch(url) {
  return new Promise((resolve, reject) => {
    const command = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open';
    const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
    const child = spawn(command, args, { stdio: 'ignore', windowsHide: true });
    child.once('error', reject);
    child.once('close', (code) => {
      if (code === 0) resolve(true);
      else reject(new Error(`Browser launcher exited with code ${code}`));
    });
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.command) {
    console.log(help());
    return;
  }
  const client = new BeeMaxCanvasClient(args);
  const gateway = String(process.env.BEEMAX_AGENT_GATEWAY_URL || '').trim();
  const rawModels = String(process.env.BEEMAX_AGENT_MODELS_JSON || '').trim();
  if (gateway && rawModels) {
    await registerAgentCapabilities({
      ...args,
      id: process.env.BEEMAX_AGENT_INSTANCE_ID || 'zylos-agent',
      endpoint: gateway,
      models: JSON.parse(rawModels),
    });
  }
  let result;
  if (args.command === 'status') result = await client.status();
  else if (args.command === 'import') result = await client.importImage(args.inputs[0]);
  else if (args.command === 'task') result = await client.task(args.taskId);
  else if (args.command === 'cancel') result = await client.cancel(args.taskId);
  else if (args.command === 'retry') result = await client.retry(args.taskId);
  else if (args.command === 'open') {
    await client.status();
    const browserOpened = args.launch ? await launch(client.baseUrl) : false;
    result = { success: true, canvas_url: client.baseUrl, browser_opened: browserOpened };
  } else if (OPERATIONS.has(args.command)) {
    if (args.command === 'references' && args.inputs.length === 0) {
      throw new Error('references requires at least one --input image');
    }
    const operation = args.command === 'references' ? 'generate' : args.command;
    result = await client.submit(operation, args);
  } else {
    throw new Error(`Unknown command: ${args.command}`);
  }
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(JSON.stringify({ success: false, error: error.message }));
  process.exitCode = 1;
});
