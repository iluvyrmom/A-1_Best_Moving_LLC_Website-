# A-1 Best Moving LLC — Website (source of truth)

This repository is the single official copy of the live A-1 Best Moving website
(Netlify project `a-1bestmoving`). All changes are made here, tested, then
published to Netlify. Do not edit or upload the site any other way.

## How the site connects to Mason

The website owns the customer experience only. Mason himself is built once, in
HURKL. The functions in `netlify/functions/` are thin, same-origin connectors:

| Function | Connects to |
| --- | --- |
| `mason-chat` | HURKL Mason engine (`HURKL_MASON_CHAT_URL`) |
| `calendar-availability` | HURKL calendar (`HURKL_CALENDAR_URL`) |
| `submit-lead` | HURKL leads (`HURKL_LEADS_URL`) |
| `mason-speak`, `speech-text` | Mason's voice (ElevenLabs, keys in Netlify env only) |
| `create-checkout-session`, `stripe-webhook`, `booking-status` | Online booking deposits (Stripe, keys in Netlify env only) |

No keys or secrets belong in this repository. They live in Netlify environment
variables.

## Tests

```
node --test tests/payment-flow.test.mjs
node --test tests/speech-text.test.js
node --test tests/voice-single-track.test.js
node --test tests/no-duplicate-send.test.js
```
