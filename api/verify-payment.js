import crypto from 'node:crypto';
import { verifyToken } from '@clerk/backend';
import { planCollection, profileCollection } from '../src/lib/mongodb.js';
import { PERIOD_MS } from './lib/plans.js';
import { ensurePlans } from './lib/catalog.js';

// Verifies a payment razorpay callback. Supports BOTH the legacy one-time
// order flow and the recurring subscription flow. The receipt of a valid
// signature + Clerk session is what upgrades the user, never anything the
// client sends beyond the Razorpay-injected callback fields.
export default async function handler(request, response) {
  if (request.method !== 'POST') {
    return response.status(405).json({ error: 'Method not allowed' });
  }

  const secret = process.env.RAZORPAY_KEY_SECRET;
  const {
    razorpay_order_id,
    razorpay_payment_id,
    razorpay_signature,
    razorpay_subscription_id,
    idToken,
  } = request.body || {};

  if (!secret || !razorpay_payment_id || !razorpay_signature || !idToken) {
    return response.status(400).json({ error: 'Payment verification data is incomplete.' });
  }

  const isSubscription = Boolean(razorpay_subscription_id);
  if (!isSubscription && !razorpay_order_id) {
    return response.status(400).json({ error: 'Payment verification data is incomplete.' });
  }

  // 1. Verify the Razorpay signature. Subscriptions sign over
  //    `payment_id | subscription_id`; orders over `order_id | payment_id`.
  const signedPayload = isSubscription
    ? `${razorpay_payment_id}|${razorpay_subscription_id}`
    : `${razorpay_order_id}|${razorpay_payment_id}`;
  const expectedSignature = crypto.createHmac('sha256', secret).update(signedPayload).digest('hex');
  const validSignature =
    expectedSignature.length === razorpay_signature.length &&
    crypto.timingSafeEqual(Buffer.from(expectedSignature, 'utf8'), Buffer.from(razorpay_signature, 'utf8'));
  if (!validSignature) {
    return response.status(400).json({ verified: false, error: 'Payment signature is invalid.' });
  }

  // 2. Verify the Clerk session token to get the REAL user id (can't be spoofed).
  const secretKey = process.env.CLERK_SECRET_KEY;
  let userId;
  try {
    const payload = await verifyToken(idToken, { secretKey });
    userId = payload.sub;
  } catch (error) {
    console.error('Clerk session verification failed:', error?.message || error);
    return response.status(401).json({ verified: false, error: 'Invalid session.' });
  }
  if (!userId) {
    return response.status(401).json({ verified: false, error: 'Invalid session.' });
  }

  // 3. Mark the account subscribed server-side.
  try {
    const col = await profileCollection();
    if (isSubscription) {
      const profile = await col.findOne({ _id: userId });
      await ensurePlans();
      const dbPlan = await (await planCollection()).findOne({ id: profile?.pendingPlan || 'monthly' }) || null;
      const periodKey = (dbPlan?.period && PERIOD_MS[dbPlan.period]) ? dbPlan.period : 'monthly';
      const subscribedUntil = Date.now() + PERIOD_MS[periodKey];
      const plan = {
        id: dbPlan?.id || 'monthly',
        label: dbPlan?.label || 'Monthly',
        price: dbPlan?.price || 9900,
        period: periodKey,
      };
      const payment = {
        paymentId: razorpay_payment_id,
        subscriptionId: razorpay_subscription_id,
        amount: plan.price,
        currency: 'INR',
        plan: plan.id,
        ts: Date.now(),
        status: 'charged',
      };
      await col.updateOne(
        { _id: userId },
        {
          $set: {
            subscribed: true,
            plan: plan.id,
            planPeriod: plan.period,
            subscribedUntil,
            subscriptionId: razorpay_subscription_id,
            pendingPlan: null,
            updatedAt: Date.now(),
          },
          $push: { payments: payment },
        },
        { upsert: true }
      );
    } else {
      await col.updateOne(
        { _id: userId },
        {
          $set: { subscribed: true, subscribedUntil: Date.now() + PERIOD_MS.monthly, plan: 'monthly', updatedAt: Date.now() },
          $push: {
            payments: {
              paymentId: razorpay_payment_id,
              orderId: razorpay_order_id,
              amount: 9900,
              currency: 'INR',
              plan: 'monthly',
              ts: Date.now(),
              status: 'charged',
            },
          },
        },
        { upsert: true }
      );
    }
  } catch (error) {
    console.error('Failed to update subscription status:', error);
    return response.status(500).json({ verified: true, error: 'Payment verified but failed to update account.' });
  }

  return response.status(200).json({ verified: true });
}