import Razorpay from 'razorpay';
import { requireRole } from '../../src/lib/serverAuth.js';
import { profileCollection } from '../../src/lib/mongodb.js';

export default async function handler(request, response) {
  if (request.method === 'GET') return getBilling(request, response);
  if (request.method === 'POST') return cancelBilling(request, response);
  return response.status(405).json({ error: 'Method not allowed' });
}

async function getBilling(request, response) {
  const user = await requireRole(request, 'admin', 'superadmin');
  if (!user) return response.status(403).json({ error: 'Forbidden: admin access required.' });

  const profiles = await (await profileCollection())
    .find({ $or: [{ subscribed: true }, { payments: { $exists: true, $ne: [] } }] })
    .sort({ updatedAt: -1 })
    .limit(300)
    .toArray();

  const now = Date.now();
  const rows = [];
  for (const p of profiles) {
    for (const pay of p.payments || []) {
      rows.push({
        id: pay.paymentId,
        userId: p._id,
        nickname: p.nickname || '',
        email: p.email || '',
        amount: pay.amount || 0,
        currency: pay.currency || 'INR',
        plan: pay.plan || null,
        ts: pay.ts || 0,
        status: pay.status || 'charged',
      });
    }
    if (p.subscriptionId && (p.subscribedUntil || 0) > now) {
      const active = rows.find((r) => r.userId === p._id && r.subscriptionId);
      if (!active) {
        rows.push({
          id: p.subscriptionId,
          userId: p._id,
          nickname: p.nickname || '',
          email: p.email || '',
          amount: 0,
          currency: 'INR',
          plan: p.plan || null,
          ts: p.subscribedUntil,
          status: 'active subscription',
        });
      }
    }
  }
  rows.sort((a, b) => (b.ts || 0) - (a.ts || 0));
  const total = rows.reduce((s, r) => s + (r.amount || 0), 0);
  return response.status(200).json({ payments: rows, total });
}

async function cancelBilling(request, response) {
  const user = await requireRole(request, 'superadmin');
  if (!user) return response.status(403).json({ error: 'Forbidden: superadmin access required.' });

  const userId = String(request.body?.userId || '');
  const profile = await (await profileCollection()).findOne({ _id: userId });
  if (!profile || !profile.subscriptionId) return response.status(400).json({ error: 'No active subscription for that user.' });

  try {
    const keyId = process.env.RAZORPAY_KEY_ID || process.env.VITE_RAZORPAY_KEY_ID;
    const keySecret = process.env.RAZORPAY_KEY_SECRET;
    const razorpay = new Razorpay({ key_id: keyId, key_secret: keySecret });
    await razorpay.subscriptions.cancel(profile.subscriptionId, true);
    await (await profileCollection()).updateOne({ _id: userId }, { $set: { cancelledAt: Date.now(), updatedAt: Date.now() } });
    return response.status(200).json({ ok: true });
  } catch (error) {
    console.error('Failed to cancel subscription:', error);
    return response.status(502).json({ error: 'Unable to cancel that subscription.' });
  }
}