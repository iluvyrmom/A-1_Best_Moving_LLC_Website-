import { callHurklBooking } from "./_shared/hurkl-bookings.mjs";
import { json, runtimeEnv } from "./_shared/runtime.mjs";
import { verifyStripeWebhook } from "./_shared/stripe.mjs";

function stringValue(value) {
  return typeof value === "string" ? value : "";
}

export default async function handler(request) {
  if (request.method !== "POST") return json(405, { error: "Method not allowed." });
  const webhookSecret = runtimeEnv("STRIPE_WEBHOOK_SECRET");
  if (!webhookSecret) return json(503, { error: "Webhook is not configured." });

  const rawBody = await request.text();
  let event;
  try {
    event = verifyStripeWebhook(
      rawBody,
      request.headers.get("stripe-signature") || "",
      webhookSecret,
    );
  } catch {
    return json(400, { error: "Invalid signature." });
  }

  if (!["checkout.session.completed", "checkout.session.expired"].includes(event.type)) {
    return json(200, { received: true, ignored: true });
  }

  const session = event.data.object;
  const metadata = session.metadata || {};
  const reservationId = stringValue(metadata.reservation_id);
  const sessionId = stringValue(session.id);
  if (!reservationId || !sessionId) {
    return json(400, { error: "Webhook metadata is incomplete." });
  }

  try {
    if (event.type === "checkout.session.completed") {
      if (session.payment_status !== "paid") {
        return json(200, { received: true, awaitingPayment: true });
      }
      const paymentIntent =
        typeof session.payment_intent === "string"
          ? session.payment_intent
          : stringValue(session.payment_intent?.id);
      await callHurklBooking("confirm", {
        eventId: event.id,
        reservationId,
        sessionId,
        paymentIntentId: paymentIntent,
        amountCents: Number(session.amount_total),
        currency: stringValue(session.currency).toLowerCase(),
      });
    } else {
      await callHurklBooking("expire", {
        eventId: event.id,
        reservationId,
        sessionId,
      });
    }
  } catch (error) {
    console.error("A-1 booking status update failed", {
      eventId: event.id,
      eventType: event.type,
      error: error instanceof Error ? error.name : "unknown",
    });
    return json(500, { error: "Booking status update failed." });
  }

  return json(200, { received: true });
}

export const config = { path: "/api/stripe/webhook" };
