// Deterministic TTS cleanup. Display text can keep familiar currency symbols,
// but ElevenLabs receives unambiguous spoken phrasing instead of slash syntax.

function currencyWords(rawAmount) {
  const normalized = rawAmount.replace(/,/g, "");
  const amount = Number(normalized);
  if (!Number.isFinite(amount)) return `$${rawAmount}`;

  const dollars = Math.trunc(amount);
  const cents = Math.round((amount - dollars) * 100);
  const dollarLabel = dollars === 1 ? "dollar" : "dollars";
  if (cents === 0) return `${dollars.toLocaleString("en-US")} ${dollarLabel}`;
  const centLabel = cents === 1 ? "cent" : "cents";
  return `${dollars.toLocaleString("en-US")} ${dollarLabel} and ${cents} ${centLabel}`;
}

// Written addresses use postal codes ("Vancouver, WA", "Portland OR."),
// but locals expect to hear the full state name. Only a capitalized
// two-letter code right after a capitalized place name is spoken out, so
// ordinary words ("or", "in", "me") are never touched.
const STATE_NAMES = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California",
  CO: "Colorado", CT: "Connecticut", DE: "Delaware", FL: "Florida", GA: "Georgia",
  HI: "Hawaii", ID: "Idaho", IL: "Illinois", IN: "Indiana", IA: "Iowa",
  KS: "Kansas", KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland",
  MA: "Massachusetts", MI: "Michigan", MN: "Minnesota", MS: "Mississippi",
  MO: "Missouri", MT: "Montana", NE: "Nebraska", NV: "Nevada",
  NH: "New Hampshire", NJ: "New Jersey", NM: "New Mexico", NY: "New York",
  NC: "North Carolina", ND: "North Dakota", OH: "Ohio", OK: "Oklahoma",
  OR: "Oregon", PA: "Pennsylvania", RI: "Rhode Island", SC: "South Carolina",
  SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah", VT: "Vermont",
  VA: "Virginia", WA: "Washington", WV: "West Virginia", WI: "Wisconsin",
  WY: "Wyoming",
};
// "OK" after a name is usually the word okay ("Thanks, OK"), so it is only
// spoken as Oklahoma when a ZIP code follows.
const NEEDS_ZIP = new Set(["OK"]);
const STATE_AFTER_PLACE =
  /\b([A-Z][A-Za-z'.-]*)(,?[ \t]+)([A-Z]{2})\b(?![A-Za-z])(\.?)(?=([ \t]*\d{5})?)/g;

function spellOutStates(input) {
  return input.replace(STATE_AFTER_PLACE, (match, place, gap, code, dot, zip) => {
    const name = STATE_NAMES[code];
    if (!name) return match;
    if (NEEDS_ZIP.has(code) && !zip) return match;
    return `${place}, ${name}${dot}`;
  });
}

function toSpeechText(input) {
  return spellOutStates(input)
    .replace(
      /\$\s*([0-9][0-9,]*(?:\.\d{1,2})?)\s*\/\s*(?:hour|hr)\b/gi,
      (_, amount) => `${currencyWords(amount)} an hour`,
    )
    .replace(
      /\$\s*([0-9][0-9,]*(?:\.\d{1,2})?)\s+(?:per|an)\s+hour\b/gi,
      (_, amount) => `${currencyWords(amount)} an hour`,
    )
    .replace(
      /\b([0-9][0-9,]*(?:\.\d{1,2})?)\s*\/\s*(?:hour|hr)\b/gi,
      (_, amount) => `${currencyWords(amount)} an hour`,
    )
    .replace(/\$\s*([0-9][0-9,]*(?:\.\d{1,2})?)/g, (_, amount) => currencyWords(amount))
    .replace(/\b([0-9]+)\s*hrs?\b/gi, "$1 hours")
    .replace(/\s{2,}/g, " ")
    .trim();
}

module.exports = { toSpeechText, spellOutStates };
