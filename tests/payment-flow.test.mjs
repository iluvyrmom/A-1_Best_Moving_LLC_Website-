import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import checkoutHandler from "../netlify/functions/create-checkout-session.mjs";
import statusHandler from "../netlify/functions/booking-status.mjs";
import webhookHandler from "../netlify/functions/stripe-webhook.mjs";

const VALID_BOOKING = {
  requestId: "05e9ad23-a8df-4650-ae32-24ddc662cf0b",
  name: "Jordan Reyes",
  phone: "503-555-0100",
  email: "jordan@example.com",
  from: "Portland, OR",
  to: "Beaverton, OR",
  moveDates: ["2026-10-10", "2026-10-11"],
  preferredTime: "Morning",
  crewSize: "2 movers",
  hoursRequested: "4 hours",
};

function setRuntimeEnv(values) {
  globalThis.Netlify = { env: { get: (name) => values[name] || "" } };
}

test("A-1 creates its own Stripe Checkout for $100 per selected day", async (t) => {
  const originalFetch = globalThis.fetch;
  const originalNetlify = globalThis.Netlify;
  t.after(() => {
    globalThis.fetch = originalFetch;
    globalThis.Netlify = originalNetlify;
  });
  setRuntimeEnv({
    STRIPE_SECRET_KEY: "sk_live_a1_private",
    STRIPE_WEBHOOK_SECRET: "whsec_a1_test_secret",
    A1_BOOKING_INTEGRATION_SECRET: "integration-secret-that-is-at-least-32-characters",
  });

  const hurklCalls = [];
  let stripeForm;
  globalThis.fetch = async (url, init) => {
    if (String(url).includes("hurkl-platform")) {
      const body = JSON.parse(init.body);
      hurklCalls.push({ body, authorization: init.headers.Authorization });
      if (body.operation === "hold") {
        return Response.json({
          reservationId: "5bd781c6-ad92-4f90-8944-25e9833aa8ba",
          expiresAt: "2026-10-01T12:35:00.000Z",
          stripeCheckoutSessionId: null,
          amountCents: 20000,
          requestedDates: VALID_BOOKING.moveDates,
          customerEmail: VALID_BOOKING.email,
        });
      }
      return Response.json({ attached: true });
    }
    assert.match(String(url), /api\.stripe\.com\/v1\/checkout\/sessions$/);
    assert.equal(init.headers.Authorization, "Bearer sk_live_a1_private");
    stripeForm = new URLSearchParams(init.body);
    return Response.json({
      id: "cs_live_a1_test",
      url: "https://checkout.stripe.com/c/pay/a1-test",
      status: "open",
      expires_at: Math.floor(Date.now() / 1000) + 1800,
    });
  };

  const response = await checkoutHandler(
    new Request("https://a-1bestmoving.netlify.app/api/create-checkout-session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(VALID_BOOKING),
    }),
  );
  const body = await response.json();
  assert.equal(response.status, 201);
  assert.equal(body.checkoutUrl, "https://checkout.stripe.com/c/pay/a1-test");
  assert.equal(body.amountCents, 20000);
  assert.equal(body.customerEmail, undefined);
  assert.equal(stripeForm.get("line_items[0][price_data][unit_amount]"), "10000");
  assert.equal(stripeForm.get("line_items[0][quantity]"), "2");
  assert.equal(stripeForm.get("payment_intent_data[receipt_email]"), VALID_BOOKING.email);
  assert.equal(stripeForm.get("metadata[company_slug]"), "a1-best-moving");
  assert.deepEqual(hurklCalls.map((call) => call.body.operation), ["hold", "attach"]);
  assert.ok(hurklCalls.every((call) => call.authorization.startsWith("Bearer integration-")));
  assert.ok(hurklCalls.every((call) => !call.authorization.includes("sk_live")));
});

test("checkout stays closed until A-1's signed webhook is configured", async (t) => {
  const originalFetch = globalThis.fetch;
  const originalNetlify = globalThis.Netlify;
  t.after(() => {
    globalThis.fetch = originalFetch;
    globalThis.Netlify = originalNetlify;
  });
  setRuntimeEnv({ STRIPE_SECRET_KEY: "sk_live_a1_private" });
  let called = false;
  globalThis.fetch = async () => {
    called = true;
    return Response.json({});
  };
  const response = await checkoutHandler(
    new Request("https://a-1bestmoving.netlify.app/api/create-checkout-session", {
      method: "POST",
      body: JSON.stringify(VALID_BOOKING),
    }),
  );
  assert.equal(response.status, 503);
  assert.equal(called, false);
});

test("signed paid webhook sends only verified status to HURKL", async (t) => {
  const originalFetch = globalThis.fetch;
  const originalNetlify = globalThis.Netlify;
  t.after(() => {
    globalThis.fetch = originalFetch;
    globalThis.Netlify = originalNetlify;
  });
  const webhookSecret = "whsec_a1_test_secret";
  setRuntimeEnv({
    STRIPE_WEBHOOK_SECRET: webhookSecret,
    A1_BOOKING_INTEGRATION_SECRET: "integration-secret-that-is-at-least-32-characters",
  });
  let forwarded;
  globalThis.fetch = async (_url, init) => {
    forwarded = JSON.parse(init.body);
    return Response.json({ confirmed: true });
  };
  const event = {
    id: "evt_a1_test",
    type: "checkout.session.completed",
    data: {
      object: {
        id: "cs_live_a1_test",
        payment_status: "paid",
        payment_intent: "pi_a1_test",
        amount_total: 20000,
        currency: "usd",
        metadata: { reservation_id: "5bd781c6-ad92-4f90-8944-25e9833aa8ba" },
      },
    },
  };
  const raw = JSON.stringify(event);
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = createHmac("sha256", webhookSecret)
    .update(`${timestamp}.${raw}`)
    .digest("hex");
  const response = await webhookHandler(
    new Request("https://a-1bestmoving.netlify.app/api/stripe/webhook", {
      method: "POST",
      headers: { "stripe-signature": `t=${timestamp},v1=${signature}` },
      body: raw,
    }),
  );
  assert.equal(response.status, 200);
  assert.equal(forwarded.operation, "confirm");
  assert.equal(forwarded.amountCents, 20000);
  assert.equal(forwarded.currency, "usd");
});

test("webhook rejects an invalid Stripe signature before any status update", async (t) => {
  const originalFetch = globalThis.fetch;
  const originalNetlify = globalThis.Netlify;
  t.after(() => {
    globalThis.fetch = originalFetch;
    globalThis.Netlify = originalNetlify;
  });
  setRuntimeEnv({
    STRIPE_WEBHOOK_SECRET: "whsec_a1_test_secret",
    A1_BOOKING_INTEGRATION_SECRET: "integration-secret-that-is-at-least-32-characters",
  });
  let called = false;
  globalThis.fetch = async () => {
    called = true;
    return Response.json({});
  };
  const response = await webhookHandler(
    new Request("https://a-1bestmoving.netlify.app/api/stripe/webhook", {
      method: "POST",
      headers: { "stripe-signature": "t=1,v1=bad" },
      body: JSON.stringify({ id: "evt_bad" }),
    }),
  );
  assert.equal(response.status, 400);
  assert.equal(called, false);
});

test("booking status exposes no customer information", async (t) => {
  const originalFetch = globalThis.fetch;
  const originalNetlify = globalThis.Netlify;
  t.after(() => {
    globalThis.fetch = originalFetch;
    globalThis.Netlify = originalNetlify;
  });
  setRuntimeEnv({
    A1_BOOKING_INTEGRATION_SECRET: "integration-secret-that-is-at-least-32-characters",
  });
  globalThis.fetch = async () => Response.json({
    status: "paid",
    requestedDates: ["2026-10-10"],
    amountCents: 10000,
    currency: "usd",
    email: "must-not-pass@example.com",
  });
  const response = await statusHandler(
    new Request("https://a-1bestmoving.netlify.app/api/booking-status?session_id=cs_live_a1_test"),
  );
  const body = await response.json();
  assert.equal(body.status, "paid");
  assert.equal(body.email, undefined);
});
