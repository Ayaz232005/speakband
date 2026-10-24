# SpeakBand Pro — payments setup (~10 minutes, $0)

Pro checkout is **activation-ready but not live**. The site shows honest
"coming soon" copy and every "Go Pro" button routes to the waitlist until
the two values below exist. Nothing charges anyone before then.

## Primary provider: Creem (decision 2026-10-24)

Creem is our merchant of record: it is the legal seller, handles sales
tax / VAT, invoicing, fraud screening, and chargebacks, and pays us out.
It accepts individual sellers (no company needed); the payout account
must match the verified identity name.

## What the user does (one time, in the Creem dashboard)

1. **Create a free Creem account** at creem.io — free, no card required
   to start, no monthly or setup fee. Complete KYC (identity check) and
   wait for Creem team approval of the payout account.
2. **Create a product**: "SpeakBand Pro", $9/month subscription
   ($90/year option).
3. **Copy the checkout URL** — the product's checkout link.
4. **Add a webhook**: Developers → Webhook → Add endpoint.
   URL: `https://speakband-api.ayazawan273.workers.dev/api/creem-webhook`
   Copy the **webhook secret** Creem shows you.
5. **Tell Muse the two values** (checkout URL + webhook secret, via a
   secure card — never in chat).

## What Muse then wires (2 minutes)

1. In `index.html` and `account.html`: set `CREEM_CHECKOUT_URL` to the
   checkout URL. "Go Pro" buttons immediately start real checkouts.
2. As the worker secret: `CREEM_WEBHOOK_SECRET` (only the key owner can
   paste secrets — the user does this in the Cloudflare dashboard, or via
   the secure flow). The `/api/creem-webhook` endpoint then verifies the
   `creem-signature` header (HMAC-SHA256 of the raw body) and records
   Pro entitlements: subscription events set `pro_until` on the matching
   account, or a pending entitlement applied at signup/login if the buyer
   has no account yet; cancellation keeps access until period end, expiry
   clears it. Pro accounts skip the 3/day grading quota. Events are
   deduplicated by event ID (Creem retries non-200 responses: 30s, 5min,
   30min, 6h — 5 attempts, never after 24h).
3. Redeploy the worker, verify a test webhook returns 200, flip the
   "Coming soon" badge copy to live.

## Creem payout facts (verified from Creem docs, Oct 2026)

- **Transaction fee: 3.9% + $0.40**, no monthly/setup fee, no
  international-card fee.
- **Payouts: 1st and 15th of each month, $50 minimum**, after a
  **7–12 day risk hold**. Bank transfer costs **$7 or 1% of the payout,
  whichever is higher** (via Paysway); USDC via Polygon costs 2%.
  The banking partner may add a currency-conversion fee outside
  Creem's control.
- **Pakistan: supported merchant country, flagged `**`.** Creem's docs
  say `**` countries "may have restrictions that affect payouts — for
  example, only individual (personal) bank accounts being supported, or
  business transfers not being available." The Pakistan-specific
  restriction is **not publicly named** — do not guess it. As an
  individual seller with a personal bank account in his own name, the
  user fits the example restriction, but confirm at signup or with
  Creem support before relying on it.
- **Early-payout caveat:** the $7 flat fee hurts small withdrawals
  (14% of a $50 payout). Let the balance build before withdrawing;
  at $1,000+ the fee is just 1%.

## Pricing and unit math (verified Oct 2026)

- **Free** — $0 forever: unlimited questions, real timings, 3 AI gradings/day.
- **Pro** — $9/mo (or $90/yr): unlimited AI gradings, detailed examiner
  reports, pronunciation scoring from audio, progress tracking, cancel anytime.

Creem fees on a $9/mo subscription:
- Sale fee: 3.9% × $9 = $0.351, + $0.40 = **$0.751** → $8.249 kept.
- Payout fee at scale (1% of a $1,000+ payout): $8.249 × 0.99 ≈ **$8.17
  net per subscription**.
- That means **≈ 123 paying subscribers = US$1,000/month** (1000 ÷ 8.17
  ≈ 122.4, rounded up) — the December 2027 target.

## Backup provider: Lemon Squeezy (not primary)

Kept as backup only. The `/api/lemon-webhook` endpoint stays live and
records Pro entitlements the same way. Known Lemon Squeezy facts
(verified Oct 2026): **5% + $0.50 per transaction, plus 1% for
non-US-bank payouts** → ≈ $8.04 net per $9 sub → ≈ 125 subscribers =
$1,000/month; $50 minimum payout, twice-monthly, ~13-day hold.
**Payoneer is NOT a Lemon Squeezy payout method** — use bank transfer
or PayPal. **Long-term risk:** Lemon Squeezy announced (Jan 2026) it
will move merchants to Stripe Managed Payments (no date announced),
and Pakistan is not among Stripe Managed Payments' supported business
locations — which is why Creem is primary.

## Honesty rules (do not break)

- Never imply checkout works before `CREEM_CHECKOUT_URL` is set.
- The "Coming soon" flag on the Pro card stays until the store is live.
- Free tier promises ("free tier stays free", "early members keep a free
  tier forever") are commitments — Pro must never remove free grading.
