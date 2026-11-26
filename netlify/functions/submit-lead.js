// Thin A-1 website adapter for HURKL's tenant-aware lead intake.
//
// Netlify Forms remains the independent backup copy. This function sends the
// same accepted request into HURKL so it appears in the owner's A-1 dashboard
// without putting a service-role key or webhook secret in the browser.

const DEFAULT_HURKL_LEADS_URL = "https://hurkl-platform.netlify.app/api/leads";
const REQUEST_TIMEOUT_MS = 15_000;

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return json(405, { error: "Method not allowed" });
  }

  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return json(400, { error: "Invalid JSON body" });
  }

  const name = clean(body.name);
  const phone = clean(body.phone);
  const email = clean(body.email);
  if (!name) return json(400, { error: "name is required" });
  if (!phone && !email) return json(400, { error: "phone or email is required" });

  const access = [clean(body.access), clean(body.parking)].filter(Boolean).join("; ");
  const crew = clean(body.crew_size);
  const hours = clean(body.hours_requested);

  const lead = {
    companySlug: "a1-best-moving",
    name,
    phone,
    email,
    pickupAddress: clean(body.from),
    destinationAddress: clean(body.to),
    moveDate: clean(body.move_date),
    preferredTime: clean(body.preferred_time),
    propertyType: [crew, hours].filter(Boolean).join(" · "),
    accessNotes: access,
    inventoryNotes: "",
    notes: [crew && hours ? `Hourly request: ${crew} for ${hours}` : "", clean(body.notes)].filter(Boolean).join("; "),
  };

  const targetUrl = (process.env.HURKL_LEADS_URL || DEFAULT_HURKL_LEADS_URL).trim();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(targetUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(lead),
      signal: controller.signal,
    });
    const responseBody = await response.json().catch(() => ({}));
    if (!response.ok || typeof responseBody.leadId !== "string") {
      console.error("HURKL lead intake rejected A-1 website request", {
        status: response.status,
      });
      return json(502, {
        error: "We couldn't confirm your request. Please call (971) 777-6660.",
      });
    }

    return json(201, { received: true });
  } catch (error) {
    console.error("HURKL lead intake could not be reached", {
      error: error instanceof Error ? error.name : "unknown",
    });
    return json(502, {
      error: "We couldn't confirm your request. Please call (971) 777-6660.",
    });
  } finally {
    clearTimeout(timeout);
  }
};

function clean(value) {
  return typeof value === "string" ? value.trim() : "";
}

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
