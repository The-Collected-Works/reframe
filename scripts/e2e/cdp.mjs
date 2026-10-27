// Drives a page over the Chrome DevTools protocol: evaluating, the mouse and the keyboard as a user
// would use them (real input events, so pointer capture, hover and focus all behave), screenshots.

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

export class Page {
  /** Connects to the first page of the app listening on `port`, waiting up to `timeout` ms for it. */
  static async connect(port, timeout = 30000) {
    const until = Date.now() + timeout
    for (;;) {
      try {
        const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json()
        const page = list.find((p) => p.type === 'page')
        if (page) return await new Page(page.webSocketDebuggerUrl).ready
      } catch {
        // Not up yet.
      }
      if (Date.now() > until) throw new Error(`No page on port ${port}`)
      await sleep(250)
    }
  }

  constructor(url) {
    this.ws = new WebSocket(url)
    this.id = 0
    this.waiting = new Map()
    /** Uncaught exceptions in the page, as they happen. */
    this.errors = []
    this.ws.addEventListener('message', (e) => {
      const m = JSON.parse(e.data)
      if (m.id && this.waiting.has(m.id)) {
        this.waiting.get(m.id)(m)
        this.waiting.delete(m.id)
      } else if (m.method === 'Runtime.exceptionThrown') {
        const d = m.params.exceptionDetails
        this.errors.push(d.exception?.description ?? d.text)
      }
    })
    this.ready = new Promise((resolve) =>
      this.ws.addEventListener('open', async () => {
        await this.send('Runtime.enable')
        resolve(this)
      })
    )
  }

  send(method, params = {}) {
    const id = ++this.id
    return new Promise((resolve) => {
      this.waiting.set(id, resolve)
      this.ws.send(JSON.stringify({ id, method, params }))
    })
  }

  close() {
    this.ws.close()
  }

  /** The value of `expression` (awaited if it's a promise). Throws what the page threw. */
  async eval(expression) {
    const r = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description ?? r.result.exceptionDetails.text)
    return r.result?.result?.value
  }

  /** Waits until `expression` is truthy (giving its value), or fails after `timeout` ms. */
  async waitFor(expression, timeout = 10000, what = expression) {
    const until = Date.now() + timeout
    for (;;) {
      const v = await this.eval(expression).catch(() => null)
      if (v) return v
      if (Date.now() > until) throw new Error(`Timed out waiting for ${what}`)
      await sleep(100)
    }
  }

  /**
   * The centre of the first element matching `selector` (or a point inside it, as fractions),
   * scrolled into view first if it isn't, as a person would.
   */
  async point(selector, fx = 0.5, fy = 0.5) {
    const p = await this.eval(`(async () => {
      const el = document.querySelector(${JSON.stringify(selector)})
      if (!el) return null
      let r = el.getBoundingClientRect()
      if (r.top < 0 || r.bottom > innerHeight || r.left < 0 || r.right > innerWidth) {
        el.scrollIntoView({ block: 'center', inline: 'nearest' })
        await new Promise((f) => requestAnimationFrame(() => requestAnimationFrame(f)))
        r = el.getBoundingClientRect()
      }
      return { x: Math.round(r.left + r.width * ${fx}), y: Math.round(r.top + r.height * ${fy}) }
    })()`)
    if (!p) throw new Error(`Nothing matches ${selector}`)
    return p
  }

  mouse(type, x, y, extra = {}) {
    return this.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', ...extra })
  }

  async click(x, y, { count = 1, button = 'left' } = {}) {
    const buttons = button === 'left' ? 1 : button === 'right' ? 2 : 4
    await this.mouse('mouseMoved', x, y, { button: 'none' })
    for (let c = 1; c <= count; c++) {
      await this.mouse('mousePressed', x, y, { button, buttons, clickCount: c })
      await this.mouse('mouseReleased', x, y, { button, buttons: 0, clickCount: c })
    }
  }

  async clickOn(selector, opts) {
    const p = await this.point(selector)
    await this.click(p.x, p.y, opts)
  }

  hover(x, y) {
    return this.mouse('mouseMoved', x, y, { button: 'none' })
  }

  /** Presses at one point, moves to another in `steps`, and lets go. `modifiers`: as CDP's (8 Shift, 2 Ctrl). */
  async drag(x0, y0, x1, y1, { steps = 10, modifiers = 0, pause = 0 } = {}) {
    await this.mouse('mouseMoved', x0, y0, { button: 'none' })
    await this.mouse('mousePressed', x0, y0, { buttons: 1, clickCount: 1, modifiers })
    for (let i = 1; i <= steps; i++) {
      await this.mouse('mouseMoved', x0 + ((x1 - x0) * i) / steps, y0 + ((y1 - y0) * i) / steps, { buttons: 1, modifiers })
      if (pause) await sleep(pause)
    }
    await this.mouse('mouseReleased', x1, y1, { buttons: 0, clickCount: 1, modifiers })
  }

  /** A key press. `mods`: 'ctrl', 'shift', 'alt', 'meta', combined with '+'. */
  async key(key, mods = '') {
    const m = { alt: 1, ctrl: 2, meta: 4, shift: 8 }
    const modifiers = mods
      .split('+')
      .filter(Boolean)
      .reduce((n, k) => n | m[k], 0)
    const code = key.length === 1 ? (/[a-z]/i.test(key) ? 'Key' + key.toUpperCase() : /\d/.test(key) ? 'Digit' + key : key) : key
    const vk =
      key.length === 1
        ? key.toUpperCase().charCodeAt(0)
        : { Escape: 27, Enter: 13, ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40, ' ': 32 }[key] || 0
    for (const type of ['keyDown', 'keyUp']) await this.send('Input.dispatchKeyEvent', { type, key, code, modifiers, windowsVirtualKeyCode: vk })
  }

  async wheel(x, y, deltaY, modifiers = 0) {
    await this.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x, y, deltaX: 0, deltaY, modifiers })
  }

  /** PNG bytes of the page. */
  async screenshot() {
    const r = await this.send('Page.captureScreenshot', { format: 'png' })
    return Buffer.from(r.result.data, 'base64')
  }

  /**
   * How many different pictures a canvas shows per second, over `ms`: drawn small each frame and
   * hashed, so a playing video counts its frames and a still one counts none.
   */
  pictures(selector, ms = 2000) {
    return this.eval(`(async () => {
      const c = document.querySelector(${JSON.stringify(selector)})
      const o = new OffscreenCanvas(48, 27).getContext('2d')
      let last = '', n = 0
      const t0 = performance.now()
      while (performance.now() - t0 < ${ms}) {
        await new Promise((r) => requestAnimationFrame(r))
        o.drawImage(c, 0, 0, 48, 27)
        const d = o.getImageData(0, 0, 48, 27).data
        let h = 0
        for (let i = 0; i < d.length; i += 3) h = (h * 31 + d[i]) | 0
        if (String(h) !== last) { n++; last = String(h) }
      }
      return n / (${ms} / 1000)
    })()`)
  }
}

export { sleep }
