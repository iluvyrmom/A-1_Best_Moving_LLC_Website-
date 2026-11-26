import { callHurklBooking, HurklBookingError } from "./_shared/hurkl-bookings.mjs";
import { A1_SITE_URL, json, runtimeEnv } from "./_shared/runtime.mjs";
import {
  createStripeCheckoutSession,
  expireStripeCheckoutSession,
  retrieveStripeCheckoutSession,
} from "./_shared/stripe.mjs";

export default async function handler(request) {
  if (request.method !== "POST") return json(405, { error: "Method not allowed." });

  const stripeSecret = runtimeEnv("STRIPE_SECRET_KEY");
  const webhookSecret = runtimeEnv("STRIPE_WEBHOOK_SECRET");
  if (!stripeSecret || !webhookSecret) {
    return json(503, { error: "Secure payment is temporarily unavailable." });
  }

  let booking;
  try {
    const raw = await request.text();
    if (raw.length > 30_000) return json(413, { error: "Request is too large." });
    booking = JSON.parse(raw);
  } catch {
    return json(400, { error: "Invalid request body." });
  }

  let hold;
  try {
    hold = await callHurklBooking("hold", booking);
  } catch (error) {
    return json(error instanceof HurklBookingError ? error.status : 502, {
      error: error instanceof Error ? error.message : "Secure payment could not be opened.",
    });
  }

  const reservationId = typeof hold.reservationId === "string" ? hold.reservationId : "";
  const requestedDates = Array.isArray(hold.requestedDates) ? hold.requestedDates : [];
  const customerEmail = typeof hold.customerEmail === "string" ? hold.customerEmail : "";
  if (!reservationId || !customerEmail || requestedDates.length < 1) {
    return json(502, { error: "Secure payment could not be opened." });
  }

  if (typeof hold.stripeCheckoutSessionId === "string" && hold.stripeCheckoutSessionId) {
    try {
      const existing = await retrieveStripeCheckoutSession(
        stripeSecret,
        hold.stripeCheckoutSessionId,
      );
      if (existing.status === "open" && existing.url) {
        return json(200, {
          checkoutUrl: existing.url,
          amountCents: requestedDates.length * 10_000,
          requestedDates,
        });
      }
      if (existing.status === "complete") {
        return json(200, {
          checkoutUrl: `${A1_SITE_URL}/booking-success.html?session_id=${encodeURIComponent(existing.id)}`,
          amountCents: requestedDates.length * 10_000,
          requestedDates,
        });
      }
    } catch {
      // The idempotency key below safely resolves uncertain Stripe responses.
    }
  }

  const expiresAt = Math.floor(Date.now() / 1000) + 31 * 60;
  let session;
  try {
    session = await createStripeCheckoutSession(stripeSecret, {
      reservationId,
      customerEmail,
      requestedDates,
      successUrl: `${A1_SITE_URL}/booking-success.html?session_id={CHECKOUT_SESSION_ID}`,
      cancelUrl: `${A1_SITE_URL}/quote?payment=cancelled#quote-form`,
      expiresAt,
    });
  } catch (error) {
    await callHurklBooking("cancel", {
      reservationId,
      reason: "A-1 Stripe Checkout Session creation failed",
    }).catch(() => undefined);
    console.error("A-1 Stripe Checkout creation failed", {
      error: error instanceof Error ? error.name : "unknown",
    });
    return json(502, { error: "Secure payment could not be opened. Please try again." });
  }

  try {
    await callHurklBooking("attach", {
      reservationId,
      sessionId: session.id,
      expiresAt: new Date(session.expires_at * 1000).toISOString(),
    });
  } catch {
    await expireStripeCheckoutSession(stripeSecret, session.id).catch(() => undefined);
    await callHurklBooking("cancel", {
      reservationId,
      reason: "A-1 Checkout Session could not be attached to reservation",
    }).catch(() => undefined);
    return json(502, { error: "Secure payment could not be opened. Please try again." });
  }

  return json(201, {
    checkoutUrl: session.url,
    amountCents: requestedDates.length * 10_000,
    requestedDates,
  });
}

export const config = { path: "/api/create-checkout-session" };
