import Razorpay from 'razorpay';
import { requireUser } from '../src/lib/serverAuth.js';
import { planCollection, profileCollection } from '../src/lib/mongodb.js';
import { PERIOD_MS } from './lib/plans.js';
import { ensurePlans } from './lib/catalog.js';

// Returns the user's current subscription state, syncing against Razorpay
// when the local expiry has lapsed (covers missed webhooks).
export default async function handler(request, response) {
  if (request.method !== 'GET') {
    return response.status(405).json({ error: 'Method not allowed' });
  }

  const user = await requireUser(request);
  if (!user) {
    return response.status(401).json({ error: 'Unauthorized: invalid session.' });
  }

  const profile = user.profile || {};
  await ensurePlans();
  const sub = profile.subscriptionId ? await (await planCollection()).findOne({ id: profile.plan }) : null;
  const periodKey = sub?.period && PERIOD_MS[sub.period] ? sub.period : 'monthly';
  let subscribed = !!profile.subscribed && (profile.subscribedUntil || 0) > Date.now();

  const subId = profile.subscriptionId;
  if (subId && !subscribed) {
    try {
      const keyId = process.env.RAZORPAY_KEY_ID || process.env.VITE_RAZORPAY_KEY_ID;
      const keySecret = process.env.RAZORPAY_KEY_SECRET;
      const razorpay = new Razorpay({ key_id: keyId, key_secret: keySecret });
      const razorSub = await razorpay.subscriptions.fetch(subId);
      if (razorSub && razorSub.status === 'active') {
        const subscribedUntil = Date.now() + PERIOD_MS[periodKey];
        subscribed = true;
        await (await profileCollection()).updateOne({ _id: user.userId }, { $set: { subscribed: true, subscribedUntil } });
      } else if (razorSub && (razorSub.status === 'cancelled' || razorSub.status === 'completed' || razorSub.status === 'expired')) {
        await (await profileCollection()).updateOne({ _id: user.userId }, { $set: { subscribed: false } });
      }
    } catch (error) {
      console.error('Failed to fetch Razorpay subscription:', error);
    }
  }

  return response.status(200).json({
    subscribed,
    plan: profile.plan || null,
    subscribedUntil: profile.subscribedUntil || null,
    subscriptionId: subId || null,
  });
}