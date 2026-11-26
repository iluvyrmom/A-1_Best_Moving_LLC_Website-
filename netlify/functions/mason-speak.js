// netlify/functions/mason-speak.js
//
// Takes { text } and returns { mime, audio } as base64-encoded MP3,
// spoken in Mason's ElevenLabs voice. The browser decodes and plays it
// directly — nothing is written to disk.

const ELEVENLABS_MODEL = "eleven_turbo_v2_5";
const VOICE_SEARCH_URL = "https://api.elevenlabs.io/v2/voices?search=Mason&page_size=100";
const { toSpeechText } = require("./speech-text");
let resolvedMasonVoiceId = null;

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: JSON.stringify({ error: "Method not allowed" }) };
  }

  let payload;
  try {
    payload = JSON.parse(event.body || "{}");
  } catch (e) {
    return { statusCode: 400, body: JSON.stringify({ error: "Invalid JSON body" }) };
  }

  const text = typeof payload.text === "string" ? payload.text.trim() : "";
  if (!text) {
    return { statusCode: 400, body: JSON.stringify({ error: "text is required" }) };
  }

  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    return { statusCode: 500, body: JSON.stringify({ error: "Server is missing ELEVENLABS_API_KEY" }) };
  }

  try {
    const voiceId = await resolveMasonVoiceId(apiKey);
    const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "xi-api-key": apiKey,
        Accept: "audio/mpeg"
      },
      body: JSON.stringify({
        text: toSpeechText(text),
        model_id: ELEVENLABS_MODEL,
        voice_settings: { stability: 0.45, similarity_boost: 0.8, style: 0.15, use_speaker_boost: true }
      })
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(`ElevenLabs API ${res.status}: ${errText}`);
    }

    const arrayBuffer = await res.arrayBuffer();
    const base64Audio = Buffer.from(arrayBuffer).toString("base64");

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ audio: base64Audio, mime: "audio/mpeg" })
    };
  } catch (err) {
    return {
      statusCode: 502,
      body: JSON.stringify({ error: "Mason couldn't get his voice working.", detail: String((err && err.message) || err) })
    };
  }
};

async function resolveMasonVoiceId(apiKey) {
  const configuredVoiceId = (process.env.ELEVENLABS_VOICE_ID || "").trim();
  if (configuredVoiceId) return configuredVoiceId;
  if (resolvedMasonVoiceId) return resolvedMasonVoiceId;

  const response = await fetch(VOICE_SEARCH_URL, {
    headers: { "xi-api-key": apiKey },
  });
  if (!response.ok) {
    throw new Error(`ElevenLabs voice lookup ${response.status}`);
  }

  const data = await response.json();
  const voices = Array.isArray(data.voices) ? data.voices : [];
  const exactMatches = voices.filter(
    (voice) =>
      voice &&
      typeof voice.name === "string" &&
      voice.name.trim().toLowerCase() === "mason" &&
      typeof voice.voice_id === "string",
  );
  const voice = exactMatches.find((candidate) => candidate.is_owner) || exactMatches[0];
  if (!voice) {
    throw new Error(
      "ElevenLabs voice named Mason was not found; set ELEVENLABS_VOICE_ID to the intended voice",
    );
  }

  resolvedMasonVoiceId = voice.voice_id;
  return resolvedMasonVoiceId;
}
