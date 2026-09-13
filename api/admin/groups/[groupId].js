import { requireRole } from '../../../src/lib/serverAuth.js';
import { groupCollection, competitionCollection } from '../../../src/lib/mongodb.js';
import { ObjectId } from 'mongodb';

export default async function handler(request, response) {
  if (request.method !== 'DELETE') return response.status(405).json({ error: 'Method not allowed' });
  const user = await requireRole(request, 'admin', 'superadmin');
  if (!user) return response.status(403).json({ error: 'Forbidden: admin access required.' });

  const id = String(request.query?.groupId || '');
  let group;
  try {
    group = await (await groupCollection()).findOne({ _id: new ObjectId(id) });
  } catch {
    group = null;
  }
  if (!group) return response.status(404).json({ error: 'Group not found.' });

  await (await competitionCollection()).deleteMany({ $or: [{ groupA: id }, { groupB: id }] });
  await (await groupCollection()).deleteOne({ _id: group._id });
  return response.status(200).json({ ok: true, deleted: true });
}