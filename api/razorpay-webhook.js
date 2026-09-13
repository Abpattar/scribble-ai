import crypto from 'node:crypto';
import { profileCollection } from '../src/lib/mongodb.js';
import { PERIOD_MS } from './lib/plans.js';

// Razorpay webhook endpoint. Keeps subscription state accurate even when the
// client never finishes the checkout modal flow.
export default async function handler(request, response) {
  if (request.method !== 'POST') {
    return response.status(405).json({ error: 'Method not allowed' });
  }

  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!secret) {
    return response.status(500).json({ error: 'Webhook secret is missing.' });
  }

  const raw = request.rawBody || (typeof request.body === 'string' ? request.body : JSON.stringify(request.body || {}));
  const expected = crypto.createHmac('sha256', secret).update(raw, 'utf8').digest('hex');
  const received = request.headers?.['x-razorpay-signature'] || '';
  const valid =
    expected.length === received.length &&
    crypto.timingSafeEqual(Buffer.from(expected, 'utf8'), Buffer.from(received, 'utf8'));
  if (!valid) {
    return response.status(200).json({ ok: true }); // acknowledge + ignore invalid
  }

  try {
    const event = request.body?.event || '';
    const entity = request.body?.payload?.subscription?.entity || request.body?.payload?.payment?.entity || {};
    const subscriptionId = entity.subscription_id || entity.id || '';
    if (!subscriptionId) return response.status(200).json({ ok: true });

    const col = await profileCollection();
    const profile = await col.findOne({ subscriptionId });

    if (event === 'payment.captured' || event === 'subscription.charged') {
      const paymentId = entity.id || '';
      const payments = Array.isArray(profile?.payments) ? profile.payments : [];
      if (profile && !payments.some((p) => p.paymentId === paymentId)) {
        const current = profile.plan || 'monthly';
        const period = PERIOD_MS[profile.planPeriod] ? profile.planPeriod : PERIOD_MS[current] ? current : 'monthly';
        await col.updateOne(
          { _id: profile._id },
          {
            $set: { subscribed: true, subscribedUntil: Date.now() + PERIOD_MS[period], planPeriod: period, updatedAt: Date.now() },
            $push: {
              payments: {
                paymentId,
                subscriptionId,
                amount: entity.amount || 0,
                currency: entity.currency || 'INR',
                plan: current,
                ts: Date.now(),
                status: 'charged',
              },
            },
          }
        );
      }
    } else if (['subscription.cancelled', 'subscription.completed', 'subscription.expired', 'subscription.paused'].includes(event)) {
      if (profile) {
        const stillActive = (profile.subscribedUntil || 0) > Date.now() && entity.status === 'active';
        await col.updateOne({ _id: profile._id }, { $set: { subscribed: stillActive, updatedAt: Date.now() } });
      }
    }
    return response.status(200).json({ ok: true });
  } catch (error) {
    console.error('Razorpay webhook failed:', error);
    return response.status(500).json({ error: 'Webhook processing failed.' });
  }
}