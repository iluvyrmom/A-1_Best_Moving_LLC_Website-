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
    constructor() { this.listeners = {}; this.starts = 0; recognition = this; }
    addEventListener(type, l) { (this.listeners[type] ||= []).push(l); }
    emit(type, event = {}) { for (const l of this.listeners[type] || []) l(event); }
    start() { this.starts += 1; this.emit('start'); }
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

const waitForPause = () => new Promise((resolve) => setTimeout(resolve, 2150));

function liveResult(text) {
  const result = [{ transcript: text }];
  result.isFinal = false;
  return { results: [result] };
}

test('one spoken sentence reported three times reaches Mason once', async () => {
  const h = createHarness();
  h.launcher.dispatch('click'); // open the chat
  h.mic.dispatch('click'); // start listening
  const recognition = h.getRecognition();
  for (let i = 0; i < 3; i += 1) recognition.emit('result', finalResult('I need two movers Saturday'));
  recognition.emit('end');
  await waitForPause();
  assert.deepEqual(h.chatMessages, ['I need two movers Saturday']);
});

test('Mason waits through a short pause and hears the whole message', async () => {
  const h = createHarness();
  h.launcher.dispatch('click');
  h.mic.dispatch('click');
  const recognition = h.getRecognition();
  recognition.emit('result', finalResult('I am moving from Vancouver'));
  recognition.emit('end'); // the phone stops at the first pause
  await settle();
  assert.deepEqual(h.chatMessages, [], 'nothing is sent during a short pause');
  recognition.emit('result', liveResult('to Tigard'));
  recognition.emit('result', finalResult('to Tigard next Friday'));
  recognition.emit('end');
  assert.equal(h.input.value, 'I am moving from Vancouver to Tigard next Friday');
  await waitForPause();
  assert.deepEqual(h.chatMessages, ['I am moving from Vancouver to Tigard next Friday']);
});

function results(...items) {
  return {
    results: items.map(([text, isFinal]) => {
      const result = [{ transcript: text }];
      result.isFinal = isFinal;
      return result;
    }),
  };
}

test('the mic stays on through a pause, so the phone does not beep mid-sentence', async () => {
  const h = createHarness();
  h.launcher.dispatch('click');
  h.mic.dispatch('click');
  const recognition = h.getRecognition();
  assert.equal(recognition.continuous, true);
  recognition.emit('result', results(['I am moving from Vancouver', true]));
  await new Promise((resolve) => setTimeout(resolve, 1200)); // a short pause
  recognition.emit('result', results(['I am moving from Vancouver', true], ['to Tigard', false]));
  recognition.emit('result', results(['I am moving from Vancouver', true], ['to Tigard next Friday', true]));
  assert.deepEqual(h.chatMessages, [], 'nothing is sent while they are still talking');
  await waitForPause();
  assert.deepEqual(h.chatMessages, ['I am moving from Vancouver to Tigard next Friday']);
  assert.equal(recognition.starts, 1, 'the mic was started once for the whole sentence');
});

test('words a phone repeats inside later results are kept once', async () => {
  const h = createHarness();
  h.launcher.dispatch('click');
  h.mic.dispatch('click');
  const recognition = h.getRecognition();
  recognition.emit('result', results(['I am', true], ['I am moving', true], ['I am moving to Tigard', true]));
  await waitForPause();
  assert.deepEqual(h.chatMessages, ['I am moving to Tigard']);
});

test('words the phone never marked finished are still sent', async () => {
  const h = createHarness();
  h.launcher.dispatch('click');
  h.mic.dispatch('click');
  const recognition = h.getRecognition();
  recognition.emit('result', liveResult('Do you move pianos'));
  recognition.emit('end');
  await waitForPause();
  assert.deepEqual(h.chatMessages, ['Do you move pianos']);
});

test('tapping the mic while talking sends right away', async () => {
  const h = createHarness();
  h.launcher.dispatch('click');
  h.mic.dispatch('click');
  const recognition = h.getRecognition();
  recognition.emit('result', finalResult('Two movers please'));
  h.mic.dispatch('click');
  await settle();
  assert.deepEqual(h.chatMessages, ['Two movers please']);
  await waitForPause();
  assert.deepEqual(h.chatMessages, ['Two movers please'], 'still sent only once');
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
