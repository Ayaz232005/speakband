# SpeakBand Pro — payments setup (~10 minutes, $0)

Pro checkout is **activation-ready but not live**. The site shows honest
"coming soon" copy and every "Go Pro" button routes to the waitlist until
the two values below exist. Nothing charges anyone before then.

## What the user does (one time, in the Lemon Squeezy dashboard)

1. **Create a free Lemon Squeezy store** at lemonsqueezy.com — free plan,
   no card required to start. Lemon Squeezy pays out to Pakistan banks
   ($50 minimum payout).
2. **Create a product**: "SpeakBand Pro", $9/month subscription.
3. **Copy the checkout URL** — the product's "Buy now" / checkout link
   (looks like `https://speakband.lemonsqueezy.com/checkout/buy/…`).
4. **Add a webhook**: Store settings → Webhooks → Add endpoint.
   URL: `https://speakband-api.ayazawan273.workers.dev/api/lemon-webhook`
   Copy the **signing secret** Lemon Squeezy shows you.
5. **Tell Muse the two values** (checkout URL + webhook secret, via a
   secure card — never in chat).

## What Muse then wires (2 minutes)

1. In `index.html`: set `LS_CHECKOUT_URL` to the checkout URL. "Go Pro"
   buttons immediately start real checkouts.
2. As the worker secret: `LEMON_WEBHOOK_SECRET` (only the key owner can
   paste secrets — the user does this in the Cloudflare dashboard, or via
   the secure flow). The `/api/lemon-webhook` endpoint then verifies
   signatures and logs subscription events; Pro entitlements (unlimited
   grading keyed by customer email) get built on top at launch.
3. Redeploy the worker, verify a test webhook returns 200, flip the
   "Coming soon" badge copy to live.

## Pricing (already on the landing page)

- **Free** — $0 forever: unlimited questions, real timings, 3 AI gradings/day.
- **Pro** — $9/mo: unlimited AI gradings, detailed examiner reports,
  pronunciation scoring from audio, progress tracking, cancel anytime.

## Honesty rules (do not break)

- Never imply checkout works before `LS_CHECKOUT_URL` is set.
- The "Coming soon" flag on the Pro card stays until the store is live.
- Free tier promises ("free tier stays free", "early members keep a free
  tier forever") are commitments — Pro must never remove free grading.
