import assert from "node:assert/strict";

const debugBase = process.argv[2];
assert.ok(debugBase, "missing Chrome DevTools endpoint");

const pages = await fetch(`${debugBase}/json/list`).then((response) => response.json());
const page = pages.find((candidate) => candidate.type === "page");
assert.ok(page?.webSocketDebuggerUrl, "BeeMax page was not available in Chrome");

const socket = new WebSocket(page.webSocketDebuggerUrl);
const pending = new Map();
let sequence = 0;

socket.addEventListener("message", (event) => {
  const message = JSON.parse(event.data);
  const resolve = pending.get(message.id);
  if (!resolve) return;
  pending.delete(message.id);
  resolve(message);
});

await new Promise((resolve, reject) => {
  socket.addEventListener("open", resolve, { once: true });
  socket.addEventListener("error", reject, { once: true });
});

function command(method, params = {}) {
  return new Promise((resolve) => {
    const id = ++sequence;
    pending.set(id, resolve);
    socket.send(JSON.stringify({ id, method, params }));
  });
}

async function evaluate(expression) {
  const response = await command("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (response.result?.exceptionDetails) {
    throw new Error(response.result.exceptionDetails.text || "browser evaluation failed");
  }
  return response.result?.result?.value;
}

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

try {
  await wait(600);
  await evaluate(`document.querySelector('.new-project-card')?.click()`);
  await wait(500);
  await evaluate(
    `[...document.querySelectorAll('button')].find((button) => button.getAttribute('aria-label') === '图片')?.click()`,
  );
  await wait(500);
  await evaluate(`document.querySelector('.react-flow__node')?.click()`);
  await wait(500);

  const initial = await evaluate(`JSON.stringify({
    visible: Boolean(document.querySelector('.poster-template-panel')),
    fields: document.querySelectorAll('.poster-template-fields input, .poster-template-fields textarea').length,
    styles: [...document.querySelectorAll('.poster-template-style')].map((element) => element.innerText)
  })`);
  const initialState = JSON.parse(initial);
  assert.equal(initialState.visible, true);
  assert.equal(initialState.fields, 10);
  assert.deepEqual(initialState.styles, [
    "翡翠绿企业数据风",
    "象牙白海军蓝法律风",
    "深蓝金色招生紧迫风",
  ]);

  await evaluate(
    `[...document.querySelectorAll('button')].find((button) => button.innerText === '生成并填入 Prompt')?.click()`,
  );
  await wait(100);
  const validation = await evaluate(
    `document.querySelector('.poster-template-message')?.innerText || ''`,
  );
  assert.match(validation, /请填写：主题.*合规文字/);

  const values = [
    "保险年度业绩",
    "宏利示例",
    "2026 年度增长报告",
    "稳健经营，长期增长",
    "312.9 亿元，同比增长 39%",
    "规模｜全年新造业务保费",
    "增长｜核心市场持续增长",
    "排名｜区域市场第 2 位",
    "查看完整报告",
    "数据仅供信息展示，不构成投资建议。",
  ];
  await evaluate(`(() => {
    const values = ${JSON.stringify(values)};
    const fields = [...document.querySelectorAll('.poster-template-fields input, .poster-template-fields textarea')];
    fields.forEach((field, index) => {
      const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(field), 'value');
      descriptor.set.call(field, values[index]);
      field.dispatchEvent(new Event('input', { bubbles: true }));
    });
  })()`);
  await wait(100);
  await evaluate(
    `[...document.querySelectorAll('button')].find((button) => button.innerText === '生成并填入 Prompt')?.click()`,
  );
  await wait(500);

  const applied = await evaluate(`JSON.stringify({
    prompt: document.querySelector('.image-mention-editor')?.innerText || '',
    settings: [...document.querySelectorAll('.processor-settings-summary')].map((element) => element.innerText),
    applyLabel: [...document.querySelectorAll('.poster-template-panel button')].find((button) => button.innerText.includes('Prompt'))?.innerText || ''
  })`);
  const appliedState = JSON.parse(applied);
  assert.match(appliedState.prompt, /【固定风格 STYLE LOCK】/);
  assert.match(appliedState.prompt, /2026 年度增长报告/);
  assert.ok(appliedState.settings.some((label) => /3:4.*模板锁定/.test(label)));
  assert.equal(appliedState.applyLabel, "已填入最终 Prompt");
} finally {
  socket.close();
}

console.log("PASS structured commercial poster form browser interaction");
