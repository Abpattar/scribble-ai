import { requireRole } from '../../../src/lib/serverAuth.js';
import { competitionCollection } from '../../../src/lib/mongodb.js';
import { ObjectId } from 'mongodb';

export default async function handler(request, response) {
  if (request.method !== 'DELETE') return response.status(405).json({ error: 'Method not allowed' });
  const user = await requireRole(request, 'admin', 'superadmin');
  if (!user) return response.status(403).json({ error: 'Forbidden: admin access required.' });

  const id = String(request.query?.competitionId || '');
  let comp;
  try {
    comp = await (await competitionCollection()).findOne({ _id: new ObjectId(id) });
  } catch {
    comp = null;
  }
  if (!comp) return response.status(404).json({ error: 'Competition not found.' });

  await (await competitionCollection()).deleteOne({ _id: comp._id });
  return response.status(200).json({ ok: true, deleted: true });
}