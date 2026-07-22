import assert from "node:assert/strict";
import { createCdpBrowserSession } from "./cdp-browser-helpers.mjs";

const debugBase = process.argv[2];
const session = await createCdpBrowserSession(debugBase);
const { evaluate, wait } = session;

async function waitFor(expression, attempts = 40) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    await wait(100);
    if (await evaluate(expression)) return true;
  }
  return false;
}

try {
  await wait(600);
  await evaluate(`document.querySelector('.new-project-card')?.click()`);
  await wait(500);
  await evaluate(
    `document.querySelector('.canvas-toolbar-add-option[aria-label="图片"]')?.click()`,
  );
  await wait(500);
  await evaluate(`document.querySelector('.react-flow__node')?.click()`);
  await wait(500);

  const initial = await evaluate(`JSON.stringify({
    visible: Boolean(document.querySelector('.poster-template-panel')),
    brief: Boolean(document.querySelector('.poster-template-brief')),
    modeSwitch: Boolean(document.querySelector('.image-composer-mode-switch')),
    separateComposer: Boolean(document.querySelector('.canvas-composer-dock')),
    unifiedCreator: Boolean(document.querySelector('.canvas-image-assistant-form')),
    materialOpen: document.querySelector('.image-composer-poster-material')?.open || false,
    advancedOpen: document.querySelector('.poster-template-advanced')?.open || false,
    fields: document.querySelectorAll('.poster-template-fields input, .poster-template-fields textarea').length,
    styles: [...document.querySelectorAll('.poster-template-style')].map((element) => element.textContent.trim())
  })`);
  const initialState = JSON.parse(initial);
  assert.equal(initialState.visible, true);
  assert.equal(initialState.brief, false);
  assert.equal(initialState.modeSwitch, false);
  assert.equal(initialState.separateComposer, false);
  assert.equal(initialState.unifiedCreator, true);
  assert.equal(initialState.materialOpen, false);
  assert.equal(initialState.advancedOpen, false);
  assert.equal(initialState.fields, 10);
  assert.deepEqual(initialState.styles, [
    "翡翠绿企业数据风",
    "象牙白海军蓝法律风",
    "深蓝金色招生紧迫风",
  ]);

  await evaluate(`document.querySelector('.image-composer-poster-material').open = true`);
  await wait(100);

  await evaluate(
    `[...document.querySelectorAll('button')].find((button) => button.innerText === '应用海报模板')?.click()`,
  );
  await wait(100);
  const validation = await evaluate(
    `document.querySelector('.poster-template-message')?.innerText || ''`,
  );
  assert.match(validation, /请先在上方填写图片或海报描述/);

  await evaluate(`(() => {
    const fields = [...document.querySelectorAll('.poster-template-fields input, .poster-template-fields textarea')];
    for (const field of fields) {
      const prototype = field instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
      const descriptor = Object.getOwnPropertyDescriptor(prototype, 'value');
      descriptor.set.call(field, '示例海报信息');
      field.dispatchEvent(new Event('input', { bubbles: true }));
    }
  })()`);
  await wait(100);
  await evaluate(
    `[...document.querySelectorAll('button')].find((button) => button.innerText === '应用海报模板')?.click()`,
  );
  await wait(100);
  assert.match(
    await evaluate(`document.querySelector('.poster-template-message')?.innerText || ''`),
    /请先在上方填写图片或海报描述/,
  );

  await evaluate(`(() => {
    const field = document.querySelector('.canvas-image-assistant-prompt');
    const descriptor = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value');
    descriptor.set.call(field, '为宏利示例制作一张保险年度业绩海报，主标题为2026年度增长报告，核心数据312.9亿元，同比增长39%，行动号召是查看完整报告。');
    field.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await wait(100);
  await evaluate(
    `[...document.querySelectorAll('button')].find((button) => button.innerText === '应用海报模板')?.click()`,
  );
  const templateApplied = await waitFor(
    `document.querySelector('.poster-template-apply')?.innerText === '模板已应用'`,
  );
  assert.equal(templateApplied, true);
  assert.equal(
    await evaluate(`Boolean(document.querySelector('.result-image-node img'))`),
    false,
  );
  const appliedPrompt = await evaluate(
    `document.querySelector('.canvas-image-assistant-prompt')?.value || ''`,
  );
  assert.ok(appliedPrompt.length > 100);
  assert.match(appliedPrompt, /2026年度增长报告/);
  assert.match(appliedPrompt, /翡翠绿和青绿色单色体系/);
  assert.equal(
    await evaluate(`document.querySelector('select[aria-label="图片比例"]')?.value`),
    '3:4',
  );

  await evaluate(
    `[...document.querySelectorAll('button')].find((button) => button.innerText === '开始生成')?.click()`,
  );
  const posterGenerated = await waitFor(
    `Boolean(document.querySelector('.result-image-node img'))`,
    80,
  );

  const applied = await evaluate(`JSON.stringify({
    separateComposer: Boolean(document.querySelector('.canvas-composer-dock')),
    unifiedCreator: !document.querySelector('.canvas-image-assistant')?.hidden
  })`);
  const appliedState = JSON.parse(applied);
  assert.equal(posterGenerated, true);
  assert.equal(appliedState.separateComposer, false);
  assert.equal(appliedState.unifiedCreator, true);

  await evaluate(`(() => {
    const generatedNode = [...document.querySelectorAll('.react-flow__node')]
      .find((node) => node.querySelector('.result-image-node img'));
    generatedNode?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  })()`);
  assert.equal(
    await waitFor(`Boolean(document.querySelector('.result-image-portal-toolbar'))`),
    true,
    'selected generated image node should show its image action toolbar',
  );
  const selectedToolbar = JSON.parse(
    await evaluate(`JSON.stringify({
      visible: Boolean(document.querySelector('.result-image-portal-toolbar')),
      sidebarVisible: !document.querySelector('.canvas-image-assistant')?.hidden,
      actions: [...document.querySelectorAll('.result-image-portal-toolbar button')]
        .map((button) => button.getAttribute('aria-label'))
    })`),
  );
  assert.equal(selectedToolbar.visible, true);
  assert.equal(selectedToolbar.sidebarVisible, true);
  assert.deepEqual(selectedToolbar.actions, [
    '下载',
    '裁剪',
    '收藏',
    '图生图',
    '提示词',
    '标记',
    '重新上传',
    '删除节点',
  ]);

  await evaluate(`(() => {
    window.__qaOriginalRequestAnimationFrame = window.requestAnimationFrame;
    window.__qaAnimationFrameCount = 0;
    window.requestAnimationFrame = (callback) =>
      window.__qaOriginalRequestAnimationFrame((timestamp) => {
        window.__qaAnimationFrameCount += 1;
        callback(timestamp);
      });
  })()`);
  let idleAnimationFrameCount;
  try {
    await new Promise((resolve) => setTimeout(resolve, 500));
    idleAnimationFrameCount = Number(
      await evaluate(`window.__qaAnimationFrameCount`),
    );
  } finally {
    await evaluate(`(() => {
      window.requestAnimationFrame = window.__qaOriginalRequestAnimationFrame;
      delete window.__qaOriginalRequestAnimationFrame;
      delete window.__qaAnimationFrameCount;
    })()`);
  }
  assert.ok(
    idleAnimationFrameCount < 12,
    `selected image toolbar should not continuously animate while idle; observed ${idleAnimationFrameCount} frames in 500ms`,
  );

  const toolbarLeftBeforeNodeMove = Number(
    await evaluate(`parseFloat(document.querySelector('.result-image-portal-toolbar')?.style.left || '0')`),
  );
  await evaluate(`(() => {
    const generatedNode = [...document.querySelectorAll('.react-flow__node')]
      .find((node) => node.querySelector('.result-image-node img'));
    if (generatedNode) generatedNode.style.transform += ' translateX(40px)';
  })()`);
  assert.equal(
    await waitFor(
      `Math.abs(parseFloat(document.querySelector('.result-image-portal-toolbar')?.style.left || '0') - ${toolbarLeftBeforeNodeMove}) > 20`,
    ),
    true,
    'selected image toolbar should follow node geometry changes without polling',
  );
  console.log(
    `PASS idle selected-toolbar animation frames: ${idleAnimationFrameCount} in 500ms`,
  );
  session.assertNoRuntimeErrors("poster flow");
} finally {
  session.close();
}

console.log("PASS structured commercial poster form browser interaction");
