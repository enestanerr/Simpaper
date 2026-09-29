// Minimal Chrome DevTools Protocol client (Node's global WebSocket) for driving Varak's renderer in the GUI spike.
// Mouse/keyboard events sent through CDP reach the web contents without moving the OS cursor or focus.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class Cdp {
  #ws;
  #next = 1;
  #pending = new Map();

  static async connect(port, timeoutMs = 60_000) {
    const until = Date.now() + timeoutMs;
    while (Date.now() < until) {
      try {
        const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
        const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
        if (page) return await new Cdp().#open(page.webSocketDebuggerUrl);
      } catch {
        // app not up yet
      }
      await sleep(300);
    }
    throw new Error(`no CDP page on port ${port}`);
  }

  #open(url) {
    return new Promise((resolve, reject) => {
      this.#ws = new WebSocket(url);
      this.#ws.onopen = () => resolve(this);
      this.#ws.onerror = (e) => reject(new Error(`CDP socket error: ${e.message ?? e}`));
      // The app may quit (or crash) while a call is pending: fail those calls instead of leaving them unsettled.
      this.#ws.onclose = () => {
        for (const p of this.#pending.values()) p.reject(new Error('CDP connection closed'));
        this.#pending.clear();
        this.closed = true;
      };
      this.#ws.onmessage = (msg) => {
        const data = JSON.parse(typeof msg.data === 'string' ? msg.data : Buffer.from(msg.data).toString());
        const p = data.id ? this.#pending.get(data.id) : undefined;
        if (!p) return;
        this.#pending.delete(data.id);
        if (data.error) p.reject(new Error(`${data.error.message} (${data.error.code})`));
        else p.resolve(data.result);
      };
    });
  }

  send(method, params = {}) {
    if (this.closed) return Promise.reject(new Error('CDP connection closed'));
    const id = this.#next++;
    this.#ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => this.#pending.set(id, { resolve, reject }));
  }

  /** Evaluates an expression in the page (promises awaited) and returns its JSON value. */
  async eval(expression) {
    const r = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    return r.result.value;
  }

  /** Calls window.varakIpc.invoke(channel, req) in the page. */
  invoke(channel, req) {
    return this.eval(`window.varakIpc.invoke(${JSON.stringify(channel)}, ${JSON.stringify(req ?? null)})`);
  }

  /** Bounding rect (CSS px, viewport) of the first element matching `selector` that has a size; null if none. */
  rectOf(selector) {
    return this.eval(`(() => {
      for (const el of document.querySelectorAll(${JSON.stringify(selector)})) {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) return { x: r.x, y: r.y, width: r.width, height: r.height };
      }
      return null;
    })()`);
  }

  async clickAt(x, y) {
    await this.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
    await this.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
    await this.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
  }

  /** Drags the left mouse button from (x1, y1) to (x2, y2) in `steps` moves (text selection, drawing). */
  async drag(x1, y1, x2, y2, steps = 12) {
    await this.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x1, y: y1 });
    await this.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: x1, y: y1, button: 'left', buttons: 1, clickCount: 1 });
    for (let i = 1; i <= steps; i++) {
      const x = x1 + ((x2 - x1) * i) / steps;
      const y = y1 + ((y2 - y1) * i) / steps;
      await this.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'left', buttons: 1 });
      await sleep(15);
    }
    await this.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: x2, y: y2, button: 'left', buttons: 0, clickCount: 1 });
  }

  async click(selector) {
    const r = await this.rectOf(selector);
    if (!r) throw new Error(`no visible element for ${selector}`);
    await this.clickAt(r.x + r.width / 2, r.y + r.height / 2);
    return r;
  }

  async key(key, code, windowsVirtualKeyCode) {
    await this.send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode });
    await this.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode });
  }

  close() {
    this.#ws?.close();
  }
}
