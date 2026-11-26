export const A1_SITE_URL = "https://a-1bestmoving.netlify.app";
export const HURKL_BOOKING_URL =
  "https://hurkl-platform.netlify.app/api/integrations/a1/bookings";

export function runtimeEnv(name) {
  return globalThis.Netlify?.env?.get?.(name) || "";
}

export function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}
