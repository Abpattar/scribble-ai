import { requireRole } from '../../src/lib/serverAuth.js';
import { profileCollection } from '../../src/lib/mongodb.js';

export default async function handler(request, response) {
  if (request.method !== 'GET') return response.status(405).json({ error: 'Method not allowed' });
  const user = await requireRole(request, 'admin', 'superadmin');
  if (!user) return response.status(403).json({ error: 'Forbidden: admin access required.' });

  const now = Date.now();
  const profiles = await (await profileCollection())
    .find({})
    .sort({ createdAt: -1 })
    .limit(200)
    .toArray();

  const rows = profiles.map((p) => ({
    id: p._id,
    nickname: p.nickname || '',
    email: p.email || '',
    avatar: p.avatar || '',
    role: p.role || 'user',
    subscribed: !!(p.subscribed && (p.subscribedUntil || 0) > now),
    subscribedUntil: p.subscribedUntil || null,
    plan: p.plan || null,
    suspended: !!p.suspended,
    createdAt: p.createdAt || 0,
    drawingCount: Object.keys(p.drawings || {}).length,
  }));

  return response.status(200).json({ users: rows });
}