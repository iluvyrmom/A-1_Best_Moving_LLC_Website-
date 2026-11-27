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

test("speaks state codes after a city as the full state name", () => {
  assert.equal(toSpeechText("We serve Vancouver, WA and Portland, OR."), "We serve Vancouver, Washington and Portland, Oregon.");
  assert.equal(toSpeechText("Moving to Tigard OR."), "Moving to Tigard, Oregon.");
  assert.equal(toSpeechText("Vancouver WA. Next week works."), "Vancouver, Washington. Next week works.");
  assert.equal(toSpeechText("123 Main St, Beaverton, OR 97005"), "123 Main St, Beaverton, Oregon 97005");
  assert.equal(toSpeechText("Lake Oswego, OR, and Camas, WA"), "Lake Oswego, Oregon, and Camas, Washington");
});

test("leaves ordinary words alone", () => {
  assert.equal(toSpeechText("Today or tomorrow works."), "Today or tomorrow works.");
  assert.equal(toSpeechText("Yes, OK, that works."), "Yes, OK, that works.");
  assert.equal(toSpeechText("Call me in the morning."), "Call me in the morning.");
  assert.equal(toSpeechText("Book it ASAP."), "Book it ASAP.");
  assert.equal(toSpeechText("Tulsa, OK 74103"), "Tulsa, Oklahoma 74103");
});
