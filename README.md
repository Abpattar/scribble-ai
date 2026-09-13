# Scribble Air Draw

A React + TypeScript + Tailwind app that turns a webcam into a drawing
surface: wave your hand in the air and your fingertip becomes the pen. Built
with MediaPipe hand-tracking, stroke rendering, gestures, zoom/pan, a
trace-template library, Clerk auth + MongoDB sync, and Razorpay billing.

Earlier internal names were "NeonAir" / "Neon Air Draw"; the product is
**Scribble Air Draw**. The MongoDB database is still named `neonair`.

## Run it

```bash
npm install
npm run dev
```

Vite serves the app on http://localhost:5173 and mounts the same
`api/*` handlers locally (via `server/devServer.js`, port 8787) so profiles,
drawings and billing behave exactly like production.

## Environment variables

Copy the values into `.env` at the project root:

```env
# Clerk — frontend only (safe in the browser)
VITE_CLERK_PUBLISHABLE_KEY=pk_test_...

# Clerk — server only (never prefix with VITE_)
CLERK_SECRET_KEY=sk_test_...

# MongoDB connection string (server only)
MONGODB_URI=mongodb+srv://user:pass@cluster0.mongodb.net/?appName=Cluster0

# Razorpay — server only
RAZORPAY_KEY_ID=rzp_test_...
RAZORPAY_KEY_SECRET=...
RAZORPAY_WEBHOOK_SECRET=...
```

The browser only ever sees `VITE_CLERK_PUBLISHABLE_KEY`. All secrets stay on
the server. For deployment, add the same variables to Vercel Project Settings.

## Billing (one-time payment)

Billing uses Razorpay **Orders** (one-time, no auto-renewal), not the
Subscriptions/Recurring API.

- `api/billing.js` `createOrder` validates the signed-in Clerk user, stores a
  `pendingPlan` on the profile, and mints a Razorpay order in the plan's
  currency/amount.
- The frontend opens Razorpay Checkout with that `order_id`, then calls
  `verifyPayment`, which verifies the signature and marks the profile
  `subscribed` with the correct plan/period/`subscribedUntil` from the stored
  `pendingPlan`.
- `cancelSubscription` ends a subscriber's paid period immediately (and
  best-effort cancels any real Razorpay subscription); payment history stays.
- Payment states are also reconciled via the Razorpay webhook endpoint.

Reasons we're on Orders rather than Subscriptions: on this test account the
Razorpay Recurring/Subscriptions API was disabled (401). To move to
subscriptions later, enable Recurring Payments and Subscriptions in the
Razorpay dashboard.

Local test card: `4111 1111 1111 1111`, any future expiry, any CVV,
OTP `1221`.

## Backend (Vercel serverless functions)

The API is consolidated into a small number of route-dispatching functions to
stay within the Vercel Hobby plan's 12-serverless-function limit. Legacy paths
are preserved through `vercel.json` rewrites, so the frontend's URLs are
unchanged.

- `api/profile.js` — GET/POST the user's profile document (drawings,
  favorites, history, nickname, bio, subscription) to MongoDB. The user is
  identified by the Clerk session JWT sent as `Authorization: Bearer <token>`,
  so a caller's uid can never be spoofed.
- `api/billing.js` — `?route=` switch over `/api/create-order`,
  `/api/create-subscription`, `/api/verify-payment`, `/api/check-subscription`,
  `/api/cancel-subscription` and `/api/razorpay-webhook`.
- `api/friends.js` — friend graph plus the pending-request counter at
  `/api/friends/requests`.
- `api/groups.js` — group CRUD plus single-group actions (`/api/groups/:groupId`).
- `api/competitions.js` — battle list/create plus single-competition sync,
  submit and vote (`/api/competitions/:competitionId`).
- `api/admin.js` — overview, users, billing, plans and destructive group /
  competition actions under `/api/admin*`.
- `api/plans.js` — public plan catalog.

## Structure

- `src/lib/engine.ts` — the drawing/hand-tracking engine (canvas, MediaPipe,
  gesture state machine, stroke cache) as a plain class.
- `src/lib/mongodb.js`, `src/lib/serverAuth.js` — server-side Mongo client and
  Clerk session verification used by the API functions.
- `src/hooks/useAuth.ts`, `src/hooks/useProfile.ts` — Clerk auth wrapper, plus
  the gallery/drawings/favorites/version-history + subscription entitlement
  logic (client-side "is this feature unlocked?" gates).
- `src/components/` — Clerk sign-in, onboarding (nickname/welcome), the tools
  panel, gallery panel, TemplatesModal (trace-template library),
  SubscriptionModal (plan + checkout), and stats/history/profile modals.
- `src/App.tsx` — wires it all together and owns the app's stage machine
  (landing → login → nickname → app).

## Accounts

- Authenticate with Clerk (email/password or Google) — manage users at the
  [Clerk Dashboard](https://dashboard.clerk.com).
- Documents live in the `neonair` database, `profiles` collection on your
  MongoDB cluster, keyed by the Clerk user id.

## Deployment

- Git push to `main` triggers a Vercel deploy. The production alias
  `scribble-ai.vercel.app` (and the *.vercel.app per-deploy URL) are pinned
  manually after each deploy:

  ```bash
  vercel alias set <deployment-url> scribble-ai.vercel.app
  ```

- Vercel project: `scribble-hcfo26h6q-adityas-projects-cf1e02fd.vercel.app`
  (see `vercel.json`, `.vercel/project.json`).