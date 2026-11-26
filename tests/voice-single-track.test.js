const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function makeClassList() {
  const values = new Set();
  return {
    add: (...names) => names.forEach((name) => values.add(name)),
    remove: (...names) => names.forEach((name) => values.delete(name)),
    contains: (name) => values.has(name),
    toggle: (name, force) => {
      const next = force === undefined ? !values.has(name) : Boolean(force);
      if (next) values.add(name); else values.delete(name);
      return next;
    },
  };
}

class FakeElement {
  constructor() {
    this.listeners = {};
    this.attributes = {};
    this.classList = makeClassList();
    this.children = [];
    this.value = '';
    this.textContent = '';
    this.scrollHeight = 0;
    this.scrollTop = 0;
  }
  addEventListener(type, listener) {
    (this.listeners[type] ||= []).push(listener);
  }
  dispatch(type, event = {}) {
    for (const listener of this.listeners[type] || []) listener(event);
  }
  appendChild(child) {
    this.children.push(child);
    this.scrollHeight += 1;
    return child;
  }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  getAttribute(name) { return this.attributes[name] ?? null; }
  querySelector() { return null; }
  scrollIntoView() {}
  remove() {}
}

function createHarness(mainPath) {
  const launcher = new FakeElement();
  const panel = new FakeElement();
  const avatar = new FakeElement();
  const thread = new FakeElement();
  const input = new FakeElement();
  const send = new FakeElement();
  const trigger = new FakeElement();
  trigger.setAttribute('data-mason-message', 'Help me book a move quickly.');
  panel.querySelector = () => avatar;

  const documentListeners = {};
  const document = {
    body: { classList: { contains: () => true }, appendChild() {} },
    addEventListener(type, listener) { (documentListeners[type] ||= []).push(listener); },
    querySelector(selector) {
      return {
        '.mason-launcher': launcher,
        '.mason-panel': panel,
        '.mason-panel-close': null,
        '.nav-toggle': null,
        '.mobile-menu': null,
        '#quote-form': null,
      }[selector] ?? null;
    },
    querySelectorAll(selector) { return selector === '.mason-trigger' ? [trigger] : []; },
    getElementById(id) {
      return {
        'mason-thread': thread,
        'mason-mic': null,
        'mason-mute': null,
        'mason-text-input': input,
        'mason-send': send,
      }[id] ?? null;
    },
    createElement() { return new FakeElement(); },
  };

  let concurrent = 0;
  let maximumConcurrent = 0;
  const spoken = [];

  class FakeAudio {
    constructor(source) {
      this.source = source;
      this.listeners = {};
      this.playing = false;
      this.currentTime = 0;
    }
    addEventListener(type, listener) { (this.listeners[type] ||= []).push(listener); }
    emit(type) { for (const listener of this.listeners[type] || []) listener(); }
    play() {
      if (this.source.startsWith('data:audio/wav')) return Promise.resolve();
      const encoded = this.source.split(',')[1];
      spoken.push(Buffer.from(encoded, 'base64').toString('utf8'));
      this.playing = true;
      concurrent += 1;
      maximumConcurrent = Math.max(maximumConcurrent, concurrent);
      setTimeout(() => {
        if (!this.playing) return;
        this.playing = false;
        concurrent -= 1;
        this.emit('ended');
      }, 250);
      return Promise.resolve();
    }
    pause() {
      if (!this.playing) return;
      this.playing = false;
      concurrent -= 1;
    }
  }

  const fetch = async (url, options) => {
    const body = JSON.parse(options.body);
    if (url.endsWith('/mason-speak')) {
      return {
        ok: true,
        status: 200,
        async json() {
          return { mime: 'audio/mpeg', audio: Buffer.from(body.text).toString('base64') };
        },
      };
    }
    if (url.endsWith('/mason-chat')) {
      return {
        ok: true,
        async json() { return { reply: 'Great, what date are you moving?' }; },
      };
    }
    throw new Error(`Unexpected fetch: ${url}`);
  };

  const storage = new Map();
  const context = {
    window: { crypto: { randomUUID: () => 'test-conversation' } },
    document,
    localStorage: {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value),
    },
    Audio: FakeAudio,
    AbortController,
    fetch,
    setTimeout,
    clearTimeout,
    Promise,
    URLSearchParams,
    console,
  };
  vm.runInNewContext(fs.readFileSync(mainPath, 'utf8'), context, { filename: mainPath });
  for (const listener of documentListeners.DOMContentLoaded || []) listener();

  return {
    trigger,
    spoken,
    getMaximumConcurrent: () => maximumConcurrent,
  };
}

test('Mason queues the greeting and first reply on one audio track', async () => {
  const harness = createHarness(path.join(__dirname, '..', 'main.js'));
  harness.trigger.dispatch('click');
  await new Promise((resolve) => setTimeout(resolve, 750));

  assert.equal(harness.getMaximumConcurrent(), 1);
  assert.deepEqual(harness.spoken, [
    'A-1 Best Moving, how may I help you?',
    'Great, what date are you moving?',
  ]);
});
