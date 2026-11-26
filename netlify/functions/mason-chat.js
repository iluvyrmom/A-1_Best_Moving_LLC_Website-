// Thin website-channel adapter for the single Mason engine in HURKL.
//
// The A-1 website owns the customer experience. HURKL owns Mason's
// reasoning, company context, critical review, spend controls, memory, and
// lead extraction. No model key or duplicate Mason prompt belongs here.

const DEFAULT_HURKL_MASON_URL =
  "https://hurkl-platform.netlify.app/api/mason/chat/a1-best-moving";
const MAX_MESSAGE_LENGTH = 2000;
const REQUEST_TIMEOUT_MS = 25_000;

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return json(405, { error: "Method not allowed" });
  }

  let payload;
  try {
    payload = JSON.parse(event.body || "{}");
  } catch {
    return json(400, { error: "Invalid JSON body" });
  }

  // The current site sends one message plus a stable page-session ID. Keep
  // accepting the recovered site's history payload for cached browsers so a
  // deployment cannot strand somebody who loaded the old JavaScript.
  const legacyHistory = Array.isArray(payload.history) ? payload.history : [];
  const latestLegacyUserMessage = [...legacyHistory]
    .reverse()
    .find((item) => item && item.role === "user" && typeof item.content === "string");
  const message =
    typeof payload.message === "string"
      ? payload.message.trim()
      : latestLegacyUserMessage?.content.trim() || "";

  const suppliedConversationId =
    typeof payload.conversationId === "string" ? payload.conversationId.trim() : "";
  const conversationId =
    suppliedConversationId || `a1-web-${crypto.randomUUID()}`;

  if (!message) {
    return json(400, { error: "message is required" });
  }
  if (message.length > MAX_MESSAGE_LENGTH) {
    return json(400, { error: "message is too long" });
  }
  if (conversationId.length > 200) {
    return json(400, { error: "conversationId is too long" });
  }

  const targetUrl =
    (process.env.HURKL_MASON_CHAT_URL || DEFAULT_HURKL_MASON_URL).trim();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(targetUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ conversationId, message }),
      signal: controller.signal,
    });

    const body = await response.json().catch(() => ({}));
    if (!response.ok || typeof body.reply !== "string") {
      console.error("HURKL Mason website channel failed", {
        status: response.status,
      });
      return json(502, {
        error: "Mason is having trouble responding right now — please try again.",
      });
    }

    return json(200, {
      reply: body.reply,
      leadSubmitted: Boolean(body.leadSubmitted),
      calendar: body.calendar && body.calendar.show ? body.calendar : undefined,
    });
  } catch (error) {
    console.error("HURKL Mason website channel could not be reached", {
      error: error instanceof Error ? error.name : "unknown",
    });
    return json(502, {
      error: "Mason is having trouble responding right now — please try again.",
    });
  } finally {
    clearTimeout(timeout);
  }
};

function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
    body: JSON.stringify(body),
  };
}
