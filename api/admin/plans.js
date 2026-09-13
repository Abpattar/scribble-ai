import { requireUser } from '../../src/lib/serverAuth.js';
import { planCollection } from '../../src/lib/mongodb.js';
import { ensurePlans, publicPlan, PRO_FEATURES, FEATURE_CATALOG } from '../lib/catalog.js';

export default async function handler(request, response) {
  const user = await requireUser(request);
  if (!user || (user.role !== 'admin' && user.role !== 'superadmin')) {
    return response.status(403).json({ error: 'Forbidden: admin access required.' });
  }

  if (request.method === 'GET') {
    try {
      await ensurePlans();
      const plans = await (await planCollection()).find({}).sort({ price: 1 }).toArray();
      return response.status(200).json({ plans: plans.map(publicPlan), catalog: FEATURE_CATALOG });
    } catch (error) {
      return response.status(500).json({ error: error?.message || 'Could not load plans.' });
    }
  }

  if (request.method === 'POST') {
    if (user.role !== 'superadmin') {
      return response.status(403).json({ error: 'Forbidden: superadmin only.' });
    }
    const { label, amount, price, period, interval, totalCount, description } = request.body || {};
    if (!label || !label.trim()) {
      return response.status(400).json({ error: 'Plan label is required.' });
    }
    const id = label.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    if (!id) {
      return response.status(400).json({ error: 'Plan label must contain letters or numbers.' });
    }
    const fine = Math.round(Number(price) || Number(amount) * 100 || 0);
    if (!(fine > 0) || !['monthly', 'yearly'].includes(period || 'monthly')) {
      return response.status(400).json({ error: 'Plans need a positive price and a period (monthly/yearly).' });
    }
    try {
      const col = await planCollection();
      await ensurePlans();
      const existing = await col.findOne({ id });
      if (existing) {
        return response.status(409).json({ error: `A plan with id "${id}" already exists.` });
      }
      await col.insertOne({
        id,
        label: label.trim(),
        amount: Math.round(fine / 100),
        price: fine,
        period,
        interval: Number(interval) || 1,
        totalCount: Number(totalCount) || 1,
        features: { ...PRO_FEATURES },
        galleryLimit: -1,
        free: false,
        active: true,
        description: description || `${label.trim()} plan`,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      return response.status(201).json({ ok: true, plan: publicPlan({ id, label: label.trim(), amount: Math.round(fine / 100), price: fine, period, interval: Number(interval) || 1, totalCount: Number(totalCount) || 1, features: { ...PRO_FEATURES }, galleryLimit: -1, free: false, active: true, description: description || `${label.trim()} plan` }) });
    } catch (error) {
      return response.status(500).json({ error: error?.message || 'Could not create plan.' });
    }
  }

  return response.status(405).json({ error: 'Method not allowed' });
}