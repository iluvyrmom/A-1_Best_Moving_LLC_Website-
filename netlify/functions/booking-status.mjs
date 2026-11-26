import { callHurklBooking, HurklBookingError } from "./_shared/hurkl-bookings.mjs";
import { json } from "./_shared/runtime.mjs";

export default async function handler(request) {
  if (request.method !== "GET") return json(405, { error: "Method not allowed." });
  const sessionId = new URL(request.url).searchParams.get("session_id") || "";
  if (!/^cs_[A-Za-z0-9_]+$/.test(sessionId) || sessionId.length > 255) {
    return json(400, { error: "Invalid checkout session." });
  }

  try {
    const body = await callHurklBooking("status", { sessionId });
    return json(200, {
      status: body.status,
      requestedDates: body.requestedDates,
      amountCents: body.amountCents,
      currency: body.currency,
    });
  } catch (error) {
    return json(error instanceof HurklBookingError ? error.status : 502, {
      error: error instanceof Error ? error.message : "Payment status is unavailable.",
    });
  }
}

export const config = { path: "/api/booking-status" };
