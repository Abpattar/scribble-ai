import { requireUser } from '../../src/lib/serverAuth.js';
import { groupCollection, friendshipCollection, profileCollection, competitionCollection } from '../../src/lib/mongodb.js';
import { ObjectId } from 'mongodb';

async function membersOf(ids) {
  const docs = await (await profileCollection()).find({ _id: { $in: ids } }).toArray();
  const map = {};
  for (const d of docs) map[d._id] = { userId: d._id, nickname: d.nickname || '', email: d.email || '', avatar: d.avatar || '' };
  return map;
}

export default async function handler(request, response) {
  const user = await requireUser(request);
  if (!user) return response.status(401).json({ error: 'Unauthorized: invalid session.' });

  const groupId = String(request.query?.groupId || '');
  let group;
  try {
    group = await (await groupCollection()).findOne({ _id: new ObjectId(groupId) });
  } catch {
    group = null;
  }
  if (!group || !group.memberIds?.includes(user.userId)) {
    return response.status(404).json({ error: 'Group not found.' });
  }
  const isAdmin = group.adminId === user.userId;

  if (request.method === 'GET') {
    const map = await membersOf(group.memberIds);
    return response.status(200).json({
      id: String(group._id),
      name: group.name,
      emoji: group.emoji,
      adminId: group.adminId,
      wins: group.wins || 0,
      played: group.played || 0,
      isAdmin,
      members: group.memberIds.map((id) => map[id] || { userId: id }),
    });
  }

  if (request.method !== 'POST') return response.status(405).json({ error: 'Method not allowed' });

  const col = await groupCollection();
  const action = request.body?.action || '';

  if (action === 'rename') {
    if (!isAdmin) return response.status(403).json({ error: 'Only the group creator can rename.' });
    const name = String(request.body.name || '').trim().slice(0, 40);
    if (!name) return response.status(400).json({ error: 'Group needs a name.' });
    await col.updateOne({ _id: group._id }, { $set: { name, updatedAt: Date.now() } });
    return response.status(200).json({ ok: true });
  }

  if (action === 'invite') {
    if (!isAdmin) return response.status(403).json({ error: 'Only the group creator can invite.' });
    const memberId = String(request.body.memberId || '');
    if (!memberId || group.memberIds.includes(memberId)) return response.status(400).json({ error: 'Already a member.' });
    const friendship = await (await friendshipCollection()).findOne({
      status: 'accepted',
      $or: [
        { userA: user.userId, userB: memberId },
        { userA: memberId, userB: user.userId },
      ],
    });
    if (!friendship) return response.status(403).json({ error: 'You can only invite friends.' });
    await col.updateOne({ _id: group._id }, { $push: { memberIds: memberId } });
    return response.status(200).json({ ok: true });
  }

  if (action === 'remove') {
    if (!isAdmin) return response.status(403).json({ error: 'Only the group creator can remove members.' });
    const memberId = String(request.body.memberId || '');
    if (memberId === user.userId) return response.status(400).json({ error: 'Use "leave" to exit the group.' });
    await col.updateOne({ _id: group._id }, { $pull: { memberIds: memberId } });
    return response.status(200).json({ ok: true });
  }

  if (action === 'leave') {
    if (group.memberIds.length <= 1) {
      await (await competitionCollection()).deleteMany({ $or: [{ groupA: groupId }, { groupB: groupId }] });
      await col.deleteOne({ _id: group._id });
      return response.status(200).json({ ok: true, deleted: true });
    }
    await col.updateOne({ _id: group._id }, { $pull: { memberIds: user.userId } });
    if (isAdmin) {
      const next = await col.findOne({ _id: group._id });
      if (next) await col.updateOne({ _id: group._id }, { $set: { adminId: next.memberIds[0] || user.userId } });
    }
    return response.status(200).json({ ok: true });
  }

  if (action === 'delete') {
    if (!isAdmin) return response.status(403).json({ error: 'Only the group creator can delete.' });
    await (await competitionCollection()).deleteMany({ $or: [{ groupA: groupId }, { groupB: groupId }] });
    await col.deleteOne({ _id: group._id });
    return response.status(200).json({ ok: true, deleted: true });
  }

  return response.status(400).json({ error: 'Unknown action.' });
}