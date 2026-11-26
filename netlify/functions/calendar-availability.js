// Same-origin, privacy-safe adapter for HURKL's Calendar & Availability
// Specialist. No customer record or server credential is sent to the browser.

const DEFAULT_HURKL_CALENDAR_URL =
  "https://hurkl-platform.netlify.app/api/calendar/a1-best-moving";
const REQUEST_TIMEOUT_MS = 12_000;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

exports.handler = async (event) => {
  if (event.httpMethod !== "GET") return json(405, { error: "Method not allowed" });

  const from = cleanDate(event.queryStringParameters && event.queryStringParameters.from);
  const to = cleanDate(event.queryStringParameters && event.queryStringParameters.to);
  const target = new URL(
    (process.env.HURKL_CALENDAR_URL || DEFAULT_HURKL_CALENDAR_URL).trim(),
  );
  if (from) target.searchParams.set("from", from);
  if (to) target.searchParams.set("to", to);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(target, { signal: controller.signal });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || !Array.isArray(body.dates)) {
      return json(502, { error: "Availability is temporarily unavailable" });
    }
    return json(200, {
      from: body.from,
      to: body.to,
      generatedAt: body.generatedAt,
      dates: body.dates,
    }, "public, max-age=30, stale-while-revalidate=120");
  } catch {
    return json(502, { error: "Availability is temporarily unavailable" });
  } finally {
    clearTimeout(timeout);
  }
};

function cleanDate(value) {
  return typeof value === "string" && DATE_PATTERN.test(value) ? value : "";
}

function json(statusCode, body, cacheControl) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": cacheControl || "no-store",
    },
    body: JSON.stringify(body),
  };
}
