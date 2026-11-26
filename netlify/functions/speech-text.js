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

function toSpeechText(input) {
  return input
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

module.exports = { toSpeechText };
