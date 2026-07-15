import { writeFile } from "node:fs/promises";

const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
const input = JSON.parse(Buffer.concat(chunks).toString("utf8"));
await writeFile(
  input.output_path,
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+Xy4uAAAAAElFTkSuQmCC",
    "base64",
  ),
);
process.stdout.write(
  JSON.stringify({
    success: true,
    image: input.output_path,
    provider: "openai-codex",
    model: input.model,
    aspect_ratio: input.aspect_ratio,
  }),
);
