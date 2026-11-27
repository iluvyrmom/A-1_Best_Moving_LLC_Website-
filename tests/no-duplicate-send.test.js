// Each customer message must reach Mason exactly once.
//
// Nov 26, 2026: HURKL's logs showed single spoken messages arriving three
// times within a few milliseconds. These tests replay that situation (the
// phone reports the same sentence several times, or the customer taps Send
// repeatedly) and confirm only one request leaves the page.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

class FakeElement {
  constructor() {
    this.listeners = {};
    this.attributes = {};
    const values = new Set();
    this.classList = {
      add: (...n) => n.forEach((x) => values.add(x)),
      remove: (...n) => n.forEach((x) => values.delete(x)),
      contains: (x) => values.has(x),
      toggle: (x) => (values.has(x) ? (values.delete(x), false) : (values.add(x), true)),
    };
    this.children = [];
    this.value = '';
    this.textContent = '';
    this.scrollHeight = 0;
    this.scrollTop = 0;
  }
  addEventListener(type, listener) { (this.listeners[type] ||= []).push(listener); }
  dispatch(type, event = {}) { for (const l of this.listeners[type] || []) l(event); }
  appendChild(child) { this.children.push(child); return child; }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  getAttribute(name) { return this.attributes[name] ?? null; }
  querySelector() { return null; }
  scrollIntoView() {}
  remove() {}
  focus() {}
}

function createHarness() {
  const launcher = new FakeElement();
  const panel = new FakeElement();
  const thread = new FakeElement();
  const input = new FakeElement();
  const send = new FakeElement();
  const mic = new FakeElement();
  const documentListeners = {};
  const chatMessages = [];
  let recognition = null;

  class FakeRecognition {
    constructor() { this.listeners = {}; recognition = this; }
    addEventListener(type, l) { (this.listeners[type] ||= []).push(l); }
    emit(type, event = {}) { for (const l of this.listeners[type] || []) l(event); }
    start() { this.emit('start'); }
    stop() { this.emit('end'); }
  }

  const document = {
    body: { classList: { contains: () => true }, appendChild() {} },
    addEventListener(type, l) { (documentListeners[type] ||= []).push(l); },
    querySelector(selector) {
      return { '.mason-launcher': launcher, '.mason-panel': panel }[selector] ?? null;
    },
    querySelectorAll() { return []; },
    getElementById(id) {
      return {
        'mason-thread': thread,
        'mason-mic': mic,
        'mason-text-input': input,
        'mason-send': send,
      }[id] ?? null;
    },
    createElement() { return new FakeElement(); },
  };

  const fetch = async (url, options) => {
    if (url.endsWith('/mason-chat')) {
      chatMessages.push(JSON.parse(options.body).message);
      return { ok: true, async json() { return { reply: 'Great, what date are you moving?' }; } };
    }
    // Voice requests: return nothing playable; the chat path is what we test.
    return { ok: false, status: 500, async json() { return {}; } };
  };

  const storage = new Map([['masonMuted', 'true']]);
  const context = {
    window: { crypto: { randomUUID: () => 'test-conversation' }, SpeechRecognition: FakeRecognition },
    document,
    localStorage: { getItem: (k) => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v) },
    Audio: class { addEventListener() {} play() { return Promise.resolve(); } pause() {} },
    AbortController,
    fetch,
    setTimeout,
    clearTimeout,
    Promise,
    URLSearchParams,
    console,
  };
  const mainPath = path.join(__dirname, '..', 'main.js');
  vm.runInNewContext(fs.readFileSync(mainPath, 'utf8'), context, { filename: mainPath });
  for (const l of documentListeners.DOMContentLoaded || []) l();

  return { launcher, input, send, mic, chatMessages, getRecognition: () => recognition };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 50));

function finalResult(text) {
  const result = [{ transcript: text }];
  result.isFinal = true;
  return { results: [result] };
}

test('one spoken sentence reported three times reaches Mason once', async () => {
  const h = createHarness();
  h.launcher.dispatch('click'); // open the chat
  h.mic.dispatch('click'); // start listening
  const recognition = h.getRecognition();
  for (let i = 0; i < 3; i += 1) recognition.emit('result', finalResult('I need two movers Saturday'));
  await settle();
  assert.deepEqual(h.chatMessages, ['I need two movers Saturday']);
});

test('the same message sent three times in a row reaches Mason once', async () => {
  const h = createHarness();
  h.launcher.dispatch('click');
  for (let i = 0; i < 3; i += 1) {
    h.input.value = 'Do you move pianos?';
    h.send.dispatch('click');
  }
  await settle();
  assert.deepEqual(h.chatMessages, ['Do you move pianos?']);
});

test('a different next message is still sent right away', async () => {
  const h = createHarness();
  h.launcher.dispatch('click');
  h.input.value = 'Hi';
  h.send.dispatch('click');
  h.input.value = 'I am moving on the 5th';
  h.send.dispatch('click');
  await settle();
  assert.deepEqual(h.chatMessages, ['Hi', 'I am moving on the 5th']);
});
