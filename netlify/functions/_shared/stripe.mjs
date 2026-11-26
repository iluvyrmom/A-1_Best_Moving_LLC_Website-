import { createHmac, timingSafeEqual } from "node:crypto";

const STRIPE_API_BASE = "https://api.stripe.com/v1";

export class StripeRequestError extends Error {
  constructor(message, status) {
    super(message);
    this.name = "StripeRequestError";
    this.status = status;
  }
}

export class StripeWebhookVerificationError extends Error {
  constructor(message = "Invalid Stripe webhook signature") {
    super(message);
    this.name = "StripeWebhookVerificationError";
  }
}

async function stripeRequest(secretKey, path, init = {}, fetcher = fetch) {
  const response = await fetcher(`${STRIPE_API_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${secretKey}`,
      ...init.headers,
    },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new StripeRequestError(body?.error?.message || "Stripe request failed", response.status);
  }
  return body;
}

function dateDescription(dates) {
  const label = dates.length === 1 ? "Requested move day" : "Requested move days";
  return `${label}: ${dates.join(", ")}. Deposit is $100 for each requested day.`;
}

export async function createStripeCheckoutSession(secretKey, input, fetcher = fetch) {
  const description = dateDescription(input.requestedDates);
  const params = new URLSearchParams({
    mode: "payment",
    success_url: input.successUrl,
    cancel_url: input.cancelUrl,
    client_reference_id: input.reservationId,
    customer_email: input.customerEmail,
    customer_creation: "always",
    submit_type: "book",
    "payment_method_types[0]": "card",
    billing_address_collection: "auto",
    expires_at: String(input.expiresAt),
    "line_items[0][price_data][currency]": "usd",
    "line_items[0][price_data][unit_amount]": "10000",
    "line_items[0][price_data][product_data][name]":
      "A-1 Best Moving reservation deposit",
    "line_items[0][price_data][product_data][description]": description,
    "line_items[0][quantity]": String(input.requestedDates.length),
    "payment_intent_data[receipt_email]": input.customerEmail,
    "payment_intent_data[description]": description,
    "metadata[reservation_id]": input.reservationId,
    "metadata[company_slug]": "a1-best-moving",
    "metadata[requested_dates]": input.requestedDates.join(","),
    "payment_intent_data[metadata][reservation_id]": input.reservationId,
  });

  const session = await stripeRequest(
    secretKey,
    "/checkout/sessions",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Idempotency-Key": `a1-booking-${input.reservationId}`,
      },
      body: params,
    },
    fetcher,
  );
  if (!session.id || !session.url || !session.expires_at) {
    throw new StripeRequestError("Stripe returned an incomplete Checkout Session", 502);
  }
  return session;
}

export function retrieveStripeCheckoutSession(secretKey, sessionId, fetcher = fetch) {
  return stripeRequest(
    secretKey,
    `/checkout/sessions/${encodeURIComponent(sessionId)}`,
    {},
    fetcher,
  );
}

export function expireStripeCheckoutSession(secretKey, sessionId, fetcher = fetch) {
  return stripeRequest(
    secretKey,
    `/checkout/sessions/${encodeURIComponent(sessionId)}/expire`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    },
    fetcher,
  );
}

function safeSignatureMatch(expected, candidate) {
  if (!/^[a-f0-9]{64}$/i.test(candidate)) return false;
  const supplied = Buffer.from(candidate, "hex");
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

export function verifyStripeWebhook(
  rawBody,
  signatureHeader,
  webhookSecret,
  nowSeconds = Math.floor(Date.now() / 1000),
  toleranceSeconds = 300,
) {
  const parts = signatureHeader.split(",").map((part) => part.trim().split("=", 2));
  const timestamp = Number(parts.find(([key]) => key === "t")?.[1]);
  const signatures = parts.filter(([key]) => key === "v1").map(([, value]) => value);
  if (!Number.isInteger(timestamp) || signatures.length === 0) {
    throw new StripeWebhookVerificationError();
  }
  if (Math.abs(nowSeconds - timestamp) > toleranceSeconds) {
    throw new StripeWebhookVerificationError("Stripe webhook timestamp is outside tolerance");
  }

  const expected = createHmac("sha256", webhookSecret)
    .update(`${timestamp}.${rawBody}`, "utf8")
    .digest();
  if (!signatures.some((signature) => safeSignatureMatch(expected, signature))) {
    throw new StripeWebhookVerificationError();
  }

  let event;
  try {
    event = JSON.parse(rawBody);
  } catch {
    throw new StripeWebhookVerificationError("Stripe webhook body is not valid JSON");
  }
  if (!event?.id || !event?.type || !event?.data?.object) {
    throw new StripeWebhookVerificationError("Stripe webhook event is incomplete");
  }
  return event;
}
