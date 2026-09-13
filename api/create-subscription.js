import Razorpay from 'razorpay';
import { requireUser } from '../src/lib/serverAuth.js';
import { planCollection, profileCollection } from '../src/lib/mongodb.js';
import { ensurePlans } from './lib/catalog.js';

// Creates a Razorpay Subscription for the requested plan and remembers it on
// the user's profile so /verify-payment can map the paid plan server-side.
export default async function handler(request, response) {
  if (request.method !== 'POST') {
    return response.status(405).json({ error: 'Method not allowed' });
  }

  const user = await requireUser(request);
  if (!user) {
    return response.status(401).json({ error: 'Unauthorized: invalid session.' });
  }

  const keyId = process.env.RAZORPAY_KEY_ID || process.env.VITE_RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  if (!keyId || !keySecret) {
    return response.status(500).json({ error: 'Razorpay server configuration is missing.' });
  }

  await ensurePlans();
  const plan = await (await planCollection()).findOne({ id: request.body?.planId, active: true, free: { $ne: true } });
  if (!plan) {
    return response.status(400).json({ error: 'Unknown or disabled plan.' });
  }

  try {
    const razorpay = new Razorpay({ key_id: keyId, key_secret: keySecret });

    // Reuse an existing matching plan in Razorpay if one exists (idempotent),
    // otherwise create it. Plan ids are deterministic per amount+period in the
    // test environment, so duplicates are harmless.
    let razorpayPlan = null;
    try {
      const existing = await razorpay.plans.all({ count: 100 });
      for (const p of existing.items || []) {
        if (p.period === plan.period && p.item?.amount === plan.price) {
          razorpayPlan = p;
          break;
        }
      }
    } catch {
      razorpayPlan = null;
    }
    if (!razorpayPlan) {
      razorpayPlan = await razorpay.plans.create({
        period: plan.period,
        interval: plan.interval,
        item: {
          name: plan.label,
          amount: plan.price,
          currency: 'INR',
          description: plan.description,
        },
        notes: { app: 'neon-air-draw', plan: plan.id },
      });
    }

    const subscription = await razorpay.subscriptions.create({
      plan_id: razorpayPlan.id,
      total_count: plan.totalCount,
      customer_notify: 1,
      notes: { app: 'neon-air-draw', plan: plan.id },
    });

    await (await profileCollection()).updateOne(
      { _id: user.userId },
      {
        $set: {
          subscriptionId: subscription.id,
          pendingPlan: plan.id,
          updatedAt: Date.now(),
        },
      }
    );

    return response.status(200).json({
      keyId,
      subscriptionId: subscription.id,
      planId: razorpayPlan.id,
      plan: {
        id: plan.id,
        label: plan.label,
        amount: plan.amount,
      },
      customer: {
        email: user.profile?.email || '',
        name: user.profile?.nickname || 'Neon Air Drawer',
      },
    });
  } catch (error) {
    console.error('Razorpay subscription creation failed', error);
    return response.status(502).json({ error: 'Unable to create a Razorpay subscription.' });
  }
}