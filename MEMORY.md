# MEMORY — Session Handoff

Continuity notes for working on **Scribble Air Draw** (repo `Abpattar/scribble-air-draw`,
previously `scribble-ai`; codebase directory `NeonAir-main`). Read this first
in any new session so nothing is missed.

---

## 1. What this project is

A React + TypeScript + Tailwind web app: point a webcam at yourself, hold up
your hand, and draw in the air — MediaPipe tracks your fingertip as the pen.
Includes stroke rendering, gestures, zoom/pan, a trace-template library,
friends/groups/battles, an admin panel, Clerk auth, MongoDB persistence, and
Razorpay billing.

**Product name is "Scribble Air Draw", NOT "Neon Air Draw".** Legacy codenames
(`NeonAir`, `neonair`, `neon-air-draw`) still exist in some spots; only the
MongoDB database name `neonair` may NOT change (that's where the data lives).

## 2. Current architecture (referenced by file)

- `src/App.tsx` — stage machine: landing → login (Clerk) → nickname → app.
  Owns camera start, hint bar, gallery, modals. Gate helper proxies feature
  checks to `useProfile`.
- `src/lib/engine.ts` — the drawing/hand-tracking engine (MediaPipe `Hands` +
  `Camera`, canvas, gesture state machine, stroke cache, replay/record/video).
  Camera has an idle auto-hibernate (`IDLE_CAMERA_OFF_MS`) and a tap-to-wake
  overlay.
- `src/hooks/useAuth.ts` — Clerk wrapper (`useAuth`, session, idToken helpers).
- `src/hooks/useProfile.ts` — profile persistence + **client entitlement**:
  `entitlementFeatures(isPro, serverFeatures)` forces all Pro features = true
  and gallery limit = -1 whenever `subscribed || subscribedUntil > now`. This
  is what makes a paying user never see locks.
- `src/components/` — `SubscriptionModal` (plan + Razorpay checkout),
  `TemplatesModal` (trace library), `RazorpayModal` (paywall global listener),
  gallery/tools/onboarding/stats/admin/chat/friends modals.
- `api/billing.js` — `?route=` dispatcher for `/api/create-order`,
  `/api/create-subscription`, `/api/verify-payment`, `/api/check-subscription`,
  `/api/cancel-subscription`, `/api/razorpay-webhook`.
- `api/profile.js`, `api/plans.js`, `api/friends.js`, `api/groups.js`,
  `api/competitions.js`, `api/admin.js` — consolidated serverless functions.
- `server/devServer.js` + `server/vercelDevPlugin.js` — local API shim so
  `npm run dev` (Vite on 5173) also serves the real handlers on 8787 and
  proxies `/api` → it. **Handlers are imported ONCE at startup** — after
  editing any `api/*.js` you must restart the dev server.

## 3. Billing model (IMPORTANT — easy to get wrong)

**We use one-time Razorpay Orders, NOT recurring Subscriptions.** Reasons:
- The user pivoted to TEST keys only (no live keys yet; "real one later").
- The Razorpay test account returns **401 on the Subscriptions/plans API** —
  recurring billing is not enabled on the account. Orders API works fine.
- To go recurring later: enable Recurring Payments/Subscriptions in the
  Razorpay dashboard, then re-point the frontend/`createSubscription`.

Order flow (production and local both work):
1. `POST /api/create-order {planId}` → auth required; validates plan via
   `ensurePlans`; saves `pendingPlan` on the profile; returns
   `{ orderId, amount, currency, keyId, plan }`.
2. `SubscriptionModal.startCheckout` opens Razorpay checkout with `order_id`
   seeded from `keyId`, then `handleVerify` calls `POST /api/verify-payment`
   with the Clerk idToken.
3. `verifyPayment` (order branch) resolves plan/period from
   `profile.pendingPlan` (fallback: monthly), sets
   `subscribed, plan, planPeriod, subscribedUntil`, clears `pendingPlan`,
   pushes a payment record. Signature + Clerk identity are both verified.
4. `cancelSubscription` now **ends a subscription immediately**: best-effort
   Razorpay `subscriptions.cancel` (swallowed if the account can't do it),
   then sets `subscribed: false, subscribedUntil: 0, cancelledAt`. Payment
   history is kept. UI confirm text reflects "ends now".

Test card: `4111 1111 1111 1111`, future expiry, any CVV, OTP `1221`.

Webhook handling: `chargedEvents = ['payment.captured','subscription.charged',
'payment.authorized']`, `endedEvents = ['subscription.cancelled','subscription.completed',
'subscription.expired','subscription.paused','subscription.halted']`.

## 4. Environment / keys (keep consistent in 3 places: local `.env` + Vercel prod/preview/dev)

- `VITE_CLERK_PUBLISHABLE_KEY` / `CLERK_SECRET_KEY` — Clerk dashboard.
- `MONGODB_URI` — Mongo; DB name `neonair`, collection `profiles`, keyed by
  Clerk user id.
- `RAZORPAY_KEY_ID=rzp_test_TbQovvqgjvtDWT`
- `RAZORPAY_KEY_SECRET=ZWyGczQWgPkHR1YN4EwE3gOi`
- `RAZORPAY_WEBHOOK_SECRET=whsec_scribbleai_test_9f3kLm2Q8x`
- Old dead keys (`rzp_test_S9gk8Rymd2M1` / `kocYfhRUDPdjgD2zW2GM3gel`) were
  removed from Vercel after the 401 fiasco.

**Vercel env gotcha:** `PATCH /v9/.../env` returns 404. Use DELETE existing env
ids then `POST /v10/projects/{id}/env?upsert=true`.

## 5. Known accounts / data (Mongo `neonair.profiles`)

- Paid (the payment worked): `user_3JG4UeVR2X8ZdAatIuCQYMgYVYk` (nickname
  "Diablo"), `subscribed: true`, `plan: monthly`, `subscribedUntil: 2026-10-13`
  (this was reset when he cancelled during testing — verify current state).
- Free test accounts: user `user_3IXmc6awk4o3CIgYn0bcWsP7BrE` and
  `user_3IY4LSKE5a5G9KJ4Q3ijBSGU46g` (both nickname "Aditya").
- Plans live in `plans` collection: `free` (limited), `monthly` ₹99, `yearly`
  ₹999, with correct PRO feature flags.

## 6. What was fixed recently (session log, newest last)

- **Camera wake freeze:** `resumeCamera()` used to call `start()` on the same
  MediaPipe `Camera` after `stop()` → stale loop sat on `video.currentTime`
  and never fired frames, so tracking stayed dead while the overlay was gone.
  Fix: rebuild a fresh `Camera` in `resumeCamera()`; added `frameLoopRunning`
  flag (false in `hibernate()`/`destroy()`, true after `start()`); `Camera`
  never auto-hibernates while `camPaused` (template tracing); wake prompt only
  hides when the loop actually restarts (`resumeCamera` returns false
  otherwise).
- **Pro features locked for a paying user:** server entitlement was correct but
  the client gate could report a subscriber as free. Fix: `useProfile.ts`
  trust-the-subscription entitlement (`entitlementFeatures`), applied in both
  `load()` and `refresh()`.
- **Free templates unusable:** `onPickTemplate` in `App.tsx` gated everything
  by Pro. Fix: only non-free templates gate; free templates pickable by
  anyone. `TemplatesModal` (locked = !templatesAllowed) already only locked
  non-free ones.
- **Plan modal "can't cancel" (UX):** `SubscriptionModal` overlay now closes on
  backdrop click (in addition to ✕).
- **Cancel did nothing / errored:** see §3 flow. Now ends the subscription
  immediately and returns a success message.
- **Empty-canvas feedback:** Replay/Record on a blank canvas shows a hint
  ("✍ Draw something first…").
- **Clerk v5 idToken:** modals use `useSession()` (not `useClerk().session`)
  so `/api/verify-payment` and other authed calls always have a token.

## 7. Commits / deployment state

- Latest commits: `617e09e` (client entitlement + free templates + backdrop
  close), `c87c107` (camera wake fix + empty replay/record hints), `12cba2c`
  (one-time Razorpay order flow + Clerk v5 + delete leaked test files).
- Local uncommitted (if not yet pushed when you open this): cancel-subscription
  rewrite + `SubscriptionModal` confirm text + branding renames (Scribble Air
  Draw) + README + this MEMORY file.
- Live: `https://scribble-ai.vercel.app` (alias pinned manually after every
  deploy; per-deploy URLs look like
  `scribble-xxxxxxxx-adityas-projects-cf1e02fd.vercel.app`). Vercel token in
  `~/.local/share/com.vercel.cli/auth.json`; project id in `.vercel/project.json`
  (`prj_y0H0V26pK6j1aJwF7igTOiIujo1n`, team `team_Kxe5J05W0LbH6jFkxmKW1vdE`).
- GitHub CLI (`gh`) is authed as `Abpattar`. Production deploy URL:
  `scribble-hcfo26h6q-adityas-projects-cf1e02fd.vercel.app`.

## 8. Handy commands

```bash
# local dev (Vite 5173 + local API 8787 via the vite plugin)
node node_modules/vite/bin/vite.js
# (the .bin shims lost their exec bit — always use node node_modules/...)

# typecheck + build
node node_modules/typescript/bin/tsc -b
node node_modules/vite/bin/vite.js build

# stop local servers (note: pkill patterns can match YOUR OWN shell cmdline —
# use exact pids, not pkill -f with a substring you also type)
kill $(cat /tmp/opencode/vite.pid)   # vite + it respawned api? no — kills only vite

# after an API deploy is READY, re-pin the alias:
vercel alias set <deployment-url> scribble-ai.vercel.app
```

## 9. Gotchas / pitfalls

- **Restart dev server after editing `api/*.js`** (imports cached at startup).
- **`pkill -f '<pattern>'` can kill the shell running the command** if the
  pattern appears in that same command line — prefer `kill <pid>`.
- **Vercel alias is manual** — re-pin after every deploy or the old bundle
  stays live (stale client code makes features look broken).
- **12-function Hobby limit** — already solved by consolidation; don't add
  separate top-level `api/*.js` files without folding them into a dispatcher.
- **Never rename the Mongo database** `neonair`; never commit `*.env` (it's
  gitignored; secrets live only in `.env` + Vercel).
- **`gh` renames the repo** but local `git remote` needs `git remote set-url`
  afterwards; GitHub redirects the old URL so Vercel's repo link keeps working.
- Built bundles change per deploy (`dist/assets/index-*.js`) — verify the live
  bundle hash matches the newest build when diagnosing "works locally, not on
  prod".

## 10. Deferred / next steps

- Enable **Recurring Payments + Subscriptions** in the Razorpay dashboard and
  switch `create-subscription`/recurring flow (or keep orders — user chose
  orders for now).
- Swap in **live Razorpay keys** when ready for real payments (update `.env` +
  Vercel prod/preview/dev).
- Resolve the documented-but-parked paths: recent page asset `/pages/` glue,
  activity/leaderboard wiring, mediapipe model warm-up spinner.
- Test template tracing uses an external background image; confirm
  camera-pause (camPaused) + resume behaviour is polished.
- (User may test cancel flow now on local and confirm the success alert +
  jump back to plan grid.)