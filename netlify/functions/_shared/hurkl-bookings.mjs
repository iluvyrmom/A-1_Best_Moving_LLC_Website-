import { HURKL_BOOKING_URL, runtimeEnv } from "./runtime.mjs";

const REQUEST_TIMEOUT_MS = 20_000;

export class HurklBookingError extends Error {
  constructor(message, status = 502) {
    super(message);
    this.name = "HurklBookingError";
    this.status = status;
  }
}

export async function callHurklBooking(operation, input = {}, fetcher = fetch) {
  const integrationSecret = runtimeEnv("A1_BOOKING_INTEGRATION_SECRET");
  if (!integrationSecret) {
    throw new HurklBookingError("Booking service is not configured.", 503);
  }

  const target = runtimeEnv("HURKL_BOOKING_INTEGRATION_URL") || HURKL_BOOKING_URL;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetcher(target, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${integrationSecret}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ operation, ...input }),
      signal: controller.signal,
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new HurklBookingError(
        typeof body.error === "string" ? body.error : "Booking service is temporarily unavailable.",
        response.status,
      );
    }
    return body;
  } catch (error) {
    if (error instanceof HurklBookingError) throw error;
    throw new HurklBookingError("Booking service is temporarily unavailable.", 502);
  } finally {
    clearTimeout(timeout);
  }
}
