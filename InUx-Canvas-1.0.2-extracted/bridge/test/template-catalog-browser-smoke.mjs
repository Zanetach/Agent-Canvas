import assert from "node:assert/strict";
import { createCdpBrowserSession } from "./cdp-browser-helpers.mjs";

const debugBase = process.argv[2];
const session = await createCdpBrowserSession(debugBase);
const { evaluate, wait } = session;
let workflowTemplatesBackup = null;

try {
  await evaluate(`document.querySelector('.back-button')?.click()`);
  await wait(250);

  const homepageNames = JSON.parse(
    await evaluate(`JSON.stringify([
      ...document.querySelectorAll('.quick-create-template-primary .quick-create-template-card strong')
    ].map((node) => node.textContent.trim()))`),
  );

  await evaluate(`document.querySelector('[aria-label="模板库"]')?.click()`);
  await wait(150);

  const libraryNames = JSON.parse(
    await evaluate(`JSON.stringify([
      ...document.querySelectorAll('.starter-template-card strong')
    ].map((node) => node.textContent.trim()))`),
  );

  assert.deepEqual(
    homepageNames,
    libraryNames,
    "homepage template catalog must match the full template library",
  );
  assert.deepEqual(homepageNames, [
    "商业海报定制",
    "中文商业海报",
    "社交媒体封面",
    "商品主图",
    "短视频镜头",
  ]);

  await evaluate(
    `document.querySelector('.starter-template-card[data-template-id="commercial-poster"]')?.click()`,
  );
  await wait(150);
  assert.equal(
    await evaluate(`Boolean(document.querySelector('.quick-create-poster-modal'))`),
    true,
    "commercial poster should open the same customization flow from the full library",
  );
  await evaluate(`document.querySelector('.quick-create-poster-modal-close')?.click()`);
  await wait(100);
  assert.equal(
    await evaluate(`Boolean(document.querySelector('.quick-create-poster-modal'))`),
    false,
    "commercial poster modal should close cleanly before another template is selected",
  );

  await evaluate(`document.querySelector('[aria-label="模板库"]')?.click()`);
  await wait(100);
  await evaluate(
    `document.querySelector('.starter-template-card[data-template-id="starter-video-shot"]')?.click()`,
  );
  await wait(100);
  assert.equal(
    await evaluate(`document.querySelector('.quick-create-type-tab[aria-selected="true"]')?.innerText || ''`),
    "视频",
    "video template should switch to video when selected from the full library",
  );
  assert.match(
    await evaluate(`document.querySelector('.quick-create-prompt')?.value || ''`),
    /镜头缓慢推近/,
  );

  workflowTemplatesBackup = JSON.parse(
    await evaluate(`(async () => {
      const database = await new Promise((resolve, reject) => {
        const request = indexedDB.open('ai-canvas', 1);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const value = await new Promise((resolve, reject) => {
        const request = database.transaction('kv', 'readonly')
          .objectStore('kv')
          .get('ai-canvas.workflowTemplates');
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      database.close();
      return JSON.stringify({ exists: value !== undefined, value: value ?? null });
    })()`),
  );
  await evaluate(`(async () => {
    const database = await new Promise((resolve, reject) => {
      const request = indexedDB.open('ai-canvas', 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const currentRequest = database.transaction('kv', 'readonly')
      .objectStore('kv')
      .get('ai-canvas.workflowTemplates');
    const current = await new Promise((resolve, reject) => {
      currentRequest.onsuccess = () => resolve(currentRequest.result);
      currentRequest.onerror = () => reject(currentRequest.error);
    });
    const templates = Array.isArray(JSON.parse(current || '[]'))
      ? JSON.parse(current || '[]')
      : [];
    templates.push({
      id: 'qa-template-catalog-coexistence',
      name: 'QA 用户模板',
      description: '验证官方模板与用户模板同时显示',
      nodes: [],
      edges: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
    await new Promise((resolve, reject) => {
      const transaction = database.transaction('kv', 'readwrite');
      transaction.objectStore('kv').put(
        JSON.stringify(templates),
        'ai-canvas.workflowTemplates'
      );
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
    database.close();
    location.reload();
  })()`);
  await wait(500);
  await evaluate(`document.querySelector('[aria-label="模板库"]')?.click()`);
  await wait(150);
  assert.deepEqual(
    JSON.parse(
      await evaluate(`JSON.stringify([
        ...document.querySelectorAll('.starter-template-card strong')
      ].map((node) => node.textContent.trim()))`),
    ),
    homepageNames,
    "built-in catalog should remain visible when user templates exist",
  );
  assert.equal(
    await evaluate(
      `[...document.querySelectorAll('.material-template-card .material-card-title')].some((node) => node.textContent.trim() === 'QA 用户模板')`,
    ),
    true,
    "user templates should be listed after the shared built-in catalog",
  );

  console.log("PASS homepage and full template library share one catalog");
} finally {
  if (workflowTemplatesBackup) {
    await evaluate(`(async () => {
      const backup = ${JSON.stringify(workflowTemplatesBackup)};
      const database = await new Promise((resolve, reject) => {
        const request = indexedDB.open('ai-canvas', 1);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      await new Promise((resolve, reject) => {
        const transaction = database.transaction('kv', 'readwrite');
        const store = transaction.objectStore('kv');
        if (backup.exists) {
          store.put(backup.value, 'ai-canvas.workflowTemplates');
        } else {
          store.delete('ai-canvas.workflowTemplates');
        }
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
      });
      database.close();
      sessionStorage.removeItem('beemax.quick-create-draft');
      location.reload();
    })()`);
    await wait(400);
  } else {
    await evaluate(
      `sessionStorage.removeItem('beemax.quick-create-draft'); location.reload()`,
    );
    await wait(300);
  }
  await session.close();
}
