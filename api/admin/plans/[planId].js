import { requireUser } from '../../../src/lib/serverAuth.js';
import { planCollection, profileCollection } from '../../../src/lib/mongodb.js';
import { ensurePlans, publicPlan } from '../../lib/catalog.js';

const EDITABLE = ['label', 'period', 'interval', 'totalCount', 'features', 'galleryLimit', 'active', 'description'];

export default async function handler(request, response) {
  const user = await requireUser(request);
  if (!user || (user.role !== 'admin' && user.role !== 'superadmin')) {
    return response.status(403).json({ error: 'Forbidden: admin access required.' });
  }

  const planId = request.query?.planId || request.body?.planId;
  if (!planId) {
    return response.status(400).json({ error: 'Plan id is required.' });
  }

  try {
    await ensurePlans();
    const col = await planCollection();
    const plan = await col.findOne({ id: planId });
    if (!plan) {
      return response.status(404).json({ error: 'Plan not found.' });
    }

    if (request.method === 'GET') {
      return response.status(200).json({ plan: publicPlan(plan) });
    }

    if (request.method === 'PATCH') {
      if (user.role !== 'superadmin') {
        return response.status(403).json({ error: 'Forbidden: superadmin only.' });
      }
      const update = { updatedAt: Date.now() };
      const body = request.body || {};
      for (const field of EDITABLE) {
        if (body[field] !== undefined) {
          if (field === 'features' && typeof body[field] === 'object') {
            const features = {};
            for (const key of Object.keys(plan.features || {})) {
              features[key] = body[field][key] === true || body[field][key] === false ? !!body[field][key] : !!plan.features[key];
            }
            update.features = features;
          } else if (field === 'label') {
            if (!body.label || !body.label.trim()) {
              return response.status(400).json({ error: 'Plan label is required.' });
            }
            update.label = body.label.trim();
          } else {
            update[field] = body[field];
          }
        }
      }
      if (body.amount !== undefined) {
        const amount = Number(body.amount);
        if (!(amount > 0)) {
          return response.status(400).json({ error: 'Paid plans need a positive price.' });
        }
        update.amount = amount;
        update.price = Math.round(amount * 100);
      } else if (body.price !== undefined) {
        const price = Number(body.price);
        if (!(price > 0)) {
          return response.status(400).json({ error: 'Paid plans need a positive price.' });
        }
        update.price = Math.round(price);
        update.amount = Math.round(price / 100);
      }
      await col.updateOne({ _id: plan._id }, { $set: update });
      const updated = await col.findOne({ _id: plan._id });
      return response.status(200).json({ ok: true, plan: publicPlan(updated) });
    }

    if (request.method === 'DELETE') {
      if (user.role !== 'superadmin') {
        return response.status(403).json({ error: 'Forbidden: superadmin only.' });
      }
      if (plan.free) {
        return response.status(400).json({ error: 'The free plan cannot be removed.' });
      }
      const activeHolders = await (await profileCollection()).countDocuments({ plan: planId, subscribedUntil: { $gt: Date.now() } });
      if (activeHolders > 0) {
        return response.status(409).json({ error: `Cannot remove: ${activeHolders} active subscriber${activeHolders === 1 ? '' : 's'} on this plan. Set it inactive instead.` });
      }
      await col.deleteOne({ _id: plan._id });
      return response.status(200).json({ ok: true });
    }

    return response.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    return response.status(500).json({ error: error?.message || 'Could not update plan.' });
  }
}