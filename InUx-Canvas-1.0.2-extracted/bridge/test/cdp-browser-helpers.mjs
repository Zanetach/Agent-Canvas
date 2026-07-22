import assert from "node:assert/strict";

export async function createCdpBrowserSession(debugBase) {
  assert.ok(debugBase, "missing Chrome DevTools endpoint");
  const pages = await fetch(`${debugBase}/json/list`).then((response) => response.json());
  const page = pages.find((candidate) => candidate.type === "page");
  assert.ok(page?.webSocketDebuggerUrl, "BeeMax page was not available in Chrome");

  const socket = new WebSocket(page.webSocketDebuggerUrl);
  const pending = new Map();
  const pageErrors = [];
  let sequence = 0;

  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.method === "Runtime.exceptionThrown") {
      pageErrors.push(message.params?.exceptionDetails?.text || "uncaught browser exception");
    }
    if (
      message.method === "Runtime.consoleAPICalled" &&
      message.params?.type === "error"
    ) {
      pageErrors.push(
        message.params.args
          .map((argument) => argument.value ?? argument.description ?? "")
          .join(" "),
      );
    }
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

  await command("Runtime.enable");

  return {
    command,
    evaluate,
    wait: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
    assertNoRuntimeErrors(label) {
      assert.deepEqual(pageErrors, [], `${label} should not emit browser runtime errors`);
    },
    close() {
      socket.close();
    },
  };
}
