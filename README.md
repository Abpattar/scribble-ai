# Neon Air Draw — React port

A React + TypeScript + Tailwind rebuild of the original single-file HTML app.
Hand-tracking (MediaPipe), stroke rendering, gestures, zoom/pan, gallery,
Clerk auth + MongoDB sync — all ported with the same constants and math as
the original, so drawing accuracy/feel is unchanged. The login screen uses
Clerk's hosted sign-in component.

## Run it

```bash
npm install
npm run dev
```

## Environment variables

Copy the values into `.env` at the project root (Vite reads it and the
serverless functions in `api/` read the same file via `vercel dev`):

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

## Backend (Vercel serverless functions)

- `api/profile.js` — GET/POST the user's profile document (drawings,
  favorites, history, nickname, bio, subscription) to MongoDB. The user is
  identified by the Clerk session JWT sent as `Authorization: Bearer <token>`,
  so a caller's uid can never be spoofed.
- `api/create-order.js` — creates a Razorpay order.
- `api/verify-payment.js` — verifies the Razorpay signature and the Clerk
  session token, then flips `subscribed: true` on the user's MongoDB
  document. Clients cannot set `subscribed` themselves.

To test the frontend and API functions together, install the Vercel CLI and run:

```bash
npm install -g vercel
vercel dev
```

Use Razorpay test credentials locally and switch to live credentials only when
the Razorpay account is ready to accept real payments.

## Structure

- `src/lib/engine.ts` — the drawing/hand-tracking engine (canvas, MediaPipe,
  gesture state machine, stroke cache) as a plain class.
- `src/lib/mongodb.js`, `src/lib/serverAuth.js` — server-side Mongo client and
  Clerk session verification used by the API functions.
- `src/hooks/useAuth.ts`, `src/hooks/useProfile.ts` — Clerk auth wrapper + the
  gallery/drawings/favorites/version-history persistence logic (backed by
  `api/profile.js` → MongoDB).
- `src/components/` — Clerk sign-in, onboarding (nickname/welcome), the tools
  panel, the gallery panel, and the stats/history/profile modals.
- `src/App.tsx` — wires it all together and owns the app's stage machine
  (landing → login → nickname → app).

## Accounts

- Authenticate with Clerk (email/password or Google) — manage users at the
  [Clerk Dashboard](https://dashboard.clerk.com).
- Documents live in the `neonair` database, `profiles` collection on your
  MongoDB cluster, keyed by the Clerk user id.