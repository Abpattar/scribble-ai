import { requireRole } from '../../../src/lib/serverAuth.js';
import { profileCollection } from '../../../src/lib/mongodb.js';

export default async function handler(request, response) {
  const actor = await requireRole(request, 'admin', 'superadmin');
  if (!actor) return response.status(403).json({ error: 'Forbidden: admin access required.' });

  const userId = String(request.query?.userId || '');
  if (!userId) return response.status(400).json({ error: 'Missing user id.' });
  const profile = await (await profileCollection()).findOne({ _id: userId });
  if (!profile) return response.status(404).json({ error: 'User not found.' });

  if (request.method === 'GET') {
    const { drawings, history, favorites, ...rest } = profile;
    return response.status(200).json({ profiles: [rest], drawings });
  }

  if (request.method === 'PATCH') {
    const body = request.body || {};
    const set = {};
    if (body.suspended !== undefined) set.suspended = !!body.suspended;
    if (body.role !== undefined) {
      // Role changes are superadmin-only.
      if (actor.role !== 'superadmin') return response.status(403).json({ error: 'Only superadmins can change roles.' });
      if (!['user', 'admin', 'superadmin'].includes(body.role)) return response.status(400).json({ error: 'Invalid role.' });
      set.role = body.role;
      if (body.role !== 'superadmin' && actor.userId === userId) {
        return response.status(400).json({ error: 'You cannot demote yourself.' });
      }
    }
    if (Object.keys(set).length) {
      await (await profileCollection()).updateOne({ _id: userId }, { $set: { ...set, updatedAt: Date.now() } });
    }
    return response.status(200).json({ ok: true });
  }

  if (request.method === 'DELETE') {
    await (await profileCollection()).updateOne(
      { _id: userId },
      { $set: { drawings: {}, history: {}, favorites: {}, updatedAt: Date.now() } }
    );
    return response.status(200).json({ ok: true, cleared: true });
  }

  return response.status(405).json({ error: 'Method not allowed' });
}