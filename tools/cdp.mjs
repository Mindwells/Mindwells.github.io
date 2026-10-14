/**
 * Minimal Chrome DevTools Protocol client.
 *
 * Shared by the audit and the OG-image generator. CDP is driven over a
 * WebSocket rather than by spawning a browser from Node, so this works in
 * environments that block piped child processes.
 *
 * The browser is expected to be started separately with
 * `--remote-debugging-port`, e.g.:
 *
 *   msedge --headless=new --remote-debugging-port=9222 \
 *          --user-data-dir=.audit/edge about:blank
 */

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Finds the first debuggable page target. */
export async function findPageTarget(port = process.env.CDP_PORT ?? '9222') {
  const res = await fetch(`http://127.0.0.1:${port}/json/list`);
  const targets = await res.json();
  const page = targets.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
  if (!page) {
    throw new Error('No page target found. Is the browser running with --remote-debugging-port?');
  }
  return page;
}

/** Opens a CDP session and returns small promise-based helpers. */
export function connect(url) {
  const ws = new WebSocket(url);
  let nextId = 1;
  const pending = new Map();
  const listeners = new Map();

  ws.addEventListener('message', (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(`${msg.error.message} (${JSON.stringify(msg.error.data ?? '')})`));
      else resolve(msg.result);
      return;
    }
    if (msg.method && listeners.has(msg.method)) {
      for (const fn of listeners.get(msg.method)) fn(msg.params);
    }
  });

  const ready = new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', () => reject(new Error('CDP socket error')), { once: true });
  });

  return {
    ready,
    send(method, params = {}) {
      const id = nextId++;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        ws.send(JSON.stringify({ id, method, params }));
      });
    },
    /** Resolves with the params of the next occurrence of `method`. */
    once(method) {
      return new Promise((resolve) => {
        const fn = (params) => {
          listeners.get(method).delete(fn);
          resolve(params);
        };
        if (!listeners.has(method)) listeners.set(method, new Set());
        listeners.get(method).add(fn);
      });
    },
    /**
     * Subscribes to every occurrence of `method`. Returns an unsubscribe
     * function — used for streaming CDP events such as Network traffic.
     */
    on(method, handler) {
      if (!listeners.has(method)) listeners.set(method, new Set());
      listeners.get(method).add(handler);
      return () => listeners.get(method)?.delete(handler);
    },
    close() {
      ws.close();
    },
  };
}

/** Navigates and waits for the load event, then settles for `settleMs`. */
export async function navigate(cdp, url, settleMs = 1200) {
  const loaded = cdp.once('Page.loadEventFired');
  await cdp.send('Page.navigate', { url });
  await loaded;
  await sleep(settleMs);
}

/** Evaluates an expression in the page and returns its value. */
export async function evaluate(cdp, expression, { awaitPromise = false } = {}) {
  const { result, exceptionDetails } = await cdp.send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise,
  });
  if (exceptionDetails) throw new Error(exceptionDetails.text ?? 'page exception');
  return result.value;
}
