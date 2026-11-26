const CURRENT_DEPLOY_ORIGIN =
  "https://6a8afaddc923ea3306ae9993--a-1bestmoving.netlify.app";

function queryString(event) {
  if (typeof event.rawQuery === "string" && event.rawQuery) {
    return `?${event.rawQuery}`;
  }

  const values = event.queryStringParameters || {};
  const params = new URLSearchParams();
  Object.entries(values).forEach(([key, value]) => {
    if (value !== undefined && value !== null) params.set(key, String(value));
  });
  const encoded = params.toString();
  return encoded ? `?${encoded}` : "";
}

function responseHeaders(response) {
  const headers = {
    "Content-Type": response.headers.get("content-type") || "application/json",
    "X-Robots-Tag": "noindex",
  };

  const cacheControl = response.headers.get("cache-control");
  const netlifyVary = response.headers.get("netlify-vary");
  if (cacheControl) headers["Cache-Control"] = cacheControl;
  if (netlifyVary) headers["Netlify-Vary"] = netlifyVary;
  return headers;
}

function createProxyHandler(functionName) {
  return async function handler(event) {
    const method = event.httpMethod || "GET";
    const target = `${CURRENT_DEPLOY_ORIGIN}/.netlify/functions/${functionName}${queryString(event)}`;
    const headers = {};
    if (event.headers && event.headers["content-type"]) {
      headers["Content-Type"] = event.headers["content-type"];
    }
    if (event.headers && event.headers.accept) {
      headers.Accept = event.headers.accept;
    }

    let body;
    if (method !== "GET" && method !== "HEAD" && event.body != null) {
      body = event.isBase64Encoded
        ? Buffer.from(event.body, "base64")
        : event.body;
    }

    try {
      const response = await fetch(target, { method, headers, body });
      const responseBody = await response.text();
      return {
        statusCode: response.status,
        headers: responseHeaders(response),
        body: responseBody,
      };
    } catch (error) {
      console.error(`A-1 ${functionName} bridge failed`, {
        error: error instanceof Error ? error.message : String(error),
      });
      return {
        statusCode: 502,
        headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
        body: JSON.stringify({ error: "Service temporarily unavailable" }),
      };
    }
  };
}

module.exports = { createProxyHandler };
