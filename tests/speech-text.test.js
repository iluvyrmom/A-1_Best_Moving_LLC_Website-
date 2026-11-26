const test = require("node:test");
const assert = require("node:assert/strict");
const { toSpeechText } = require("../netlify/functions/speech-text");

test("normalizes slash-form hourly rates for natural speech", () => {
  assert.equal(toSpeechText("It is $50/hour."), "It is 50 dollars an hour.");
  assert.equal(toSpeechText("Two movers are $100/hr."), "Two movers are 100 dollars an hour.");
  assert.equal(toSpeechText("It comes to 130/hour."), "It comes to 130 dollars an hour.");
});

test("normalizes already-readable currency and leaves percentages alone", () => {
  assert.equal(
    toSpeechText("The rate is $130 an hour, or $1,000 flat with up to 5% off."),
    "The rate is 130 dollars an hour, or 1,000 dollars flat with up to 5% off.",
  );
});
