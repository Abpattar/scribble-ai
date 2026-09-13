import Razorpay from 'razorpay';
import { requireUser } from '../src/lib/serverAuth.js';
import { profileCollection } from '../src/lib/mongodb.js';

// Cancels the user's Razorpay subscription at the end of the current billing
// period (entitlements remain until subscribedUntil).
export default async function handler(request, response) {
  if (request.method !== 'POST') {
    return response.status(405).json({ error: 'Method not allowed' });
  }

  const user = await requireUser(request);
  if (!user) {
    return response.status(401).json({ error: 'Unauthorized: invalid session.' });
  }

  const subId = user.profile?.subscriptionId;
  if (!subId) {
    return response.status(400).json({ error: 'No active subscription to cancel.' });
  }

  try {
    const keyId = process.env.RAZORPAY_KEY_ID || process.env.VITE_RAZORPAY_KEY_ID;
    const keySecret = process.env.RAZORPAY_KEY_SECRET;
    const razorpay = new Razorpay({ key_id: keyId, key_secret: keySecret });
    await razorpay.subscriptions.cancel(subId, true); // true = cancel at period end
    await (await profileCollection()).updateOne({ _id: user.userId }, { $set: { cancelledAt: Date.now(), updatedAt: Date.now() } });
    return response.status(200).json({ ok: true, message: 'Subscription will end at the current billing period close.' });
  } catch (error) {
    console.error('Failed to cancel subscription:', error);
    return response.status(502).json({ error: 'Unable to cancel subscription right now.' });
  }
}