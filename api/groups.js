import { requireUserId } from '../src/lib/serverAuth.js';
import { groupCollection, friendshipCollection, profileCollection, competitionCollection } from '../src/lib/mongodb.js';
import { ObjectId } from 'mongodb';

async function membersOf(ids) {
  const docs = await (await profileCollection()).find({ _id: { $in: ids } }).toArray();
  const map = {};
  for (const d of docs) map[d._id] = { userId: d._id, nickname: d.nickname || '', email: d.email || '', avatar: d.avatar || '' };
  return map;
}

// Auth identity + profile/suspension check, loaded in the same wave as the
// endpoint's own first query (2 parallel Mongo round-trips total per handler).
async function profileOf(userId) {
  return (await profileCollection()).findOne({ _id: userId });
}

export default async function handler(request, response) {
  try {
    const userId = await requireUserId(request);
    if (!userId) return response.status(401).json({ error: 'Unauthorized: invalid session.' });

    const isGroupRoute = request.query?.route === 'group' || Boolean(request.query?.groupId);
    if (isGroupRoute) return groupAction(request, response, userId);

    if (request.method === 'GET') return getGroups(request, response, userId);
    if (request.method === 'POST') return createGroup(request, response, userId);
    return response.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    console.error('groups handler failed:', error?.message || error);
    return response.status(503).json({
      error: 'Groups are temporarily unavailable. Give it a moment and try again.',
    });
  }
}

async function groupAction(request, response, userId) {
  const groupId = String(request.query?.groupId || '');
  let profile;
  let group;
  try {
    [profile, group] = await Promise.all([
      profileOf(userId),
      (await groupCollection()).findOne({ _id: new ObjectId(groupId) }),
    ]);
  } catch {
    profile = null;
    group = null;
  }
  if (profile?.suspended) return response.status(401).json({ error: 'Unauthorized: invalid session.' });
  if (!group || !group.memberIds?.includes(userId)) {
    return response.status(404).json({ error: 'Group not found.' });
  }
  const isAdmin = group.adminId === userId;

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
        { userA: userId, userB: memberId },
        { userA: memberId, userB: userId },
      ],
    });
    if (!friendship) return response.status(403).json({ error: 'You can only invite friends.' });
    await col.updateOne({ _id: group._id }, { $push: { memberIds: memberId } });
    return response.status(200).json({ ok: true });
  }

  if (action === 'remove') {
    if (!isAdmin) return response.status(403).json({ error: 'Only the group creator can remove members.' });
    const memberId = String(request.body.memberId || '');
    if (memberId === userId) return response.status(400).json({ error: 'Use "leave" to exit the group.' });
    await col.updateOne({ _id: group._id }, { $pull: { memberIds: memberId } });
    return response.status(200).json({ ok: true });
  }

  if (action === 'leave') {
    if (group.memberIds.length <= 1) {
      await (await competitionCollection()).deleteMany({ $or: [{ groupA: groupId }, { groupB: groupId }] });
      await col.deleteOne({ _id: group._id });
      return response.status(200).json({ ok: true, deleted: true });
    }
    await col.updateOne({ _id: group._id }, { $pull: { memberIds: userId } });
    if (isAdmin) {
      const next = await col.findOne({ _id: group._id });
      if (next) await col.updateOne({ _id: group._id }, { $set: { adminId: next.memberIds[0] || userId } });
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

async function getGroups(request, response, userId) {
  // Wave 1: profile + this user's groups + accepted friendships, in parallel.
  const [profile, rows, friendships] = await Promise.all([
    profileOf(userId),
    (await groupCollection()).find({ memberIds: userId }).sort({ createdAt: -1 }).toArray(),
    (await friendshipCollection())
      .find({ status: 'accepted', $or: [{ userA: userId }, { userB: userId }] })
      .toArray(),
  ]);
  if (profile?.suspended) return response.status(401).json({ error: 'Unauthorized: invalid session.' });

  const friendIds = friendships.map((f) => (f.userA === userId ? f.userB : f.userA));

  // Wave 2: one query resolves every referenced profile (group members +
  // friends) instead of one query per group.
  const memberIds = new Set();
  for (const g of rows) for (const m of g.memberIds || []) memberIds.add(m);
  for (const f of friendIds) memberIds.add(f);
  const map = memberIds.size ? await membersOf(Array.from(memberIds)) : {};

  const groups = rows.map((g) => ({
    ...g,
    id: String(g._id),
    _id: undefined,
    members: (g.memberIds || []).map((id) => map[id] || { userId: id }),
  }));
  return response.status(200).json({ groups, friends: friendIds.map((id) => map[id] || { userId: id }) });
}

async function createGroup(request, response, userId) {
  const body = request.body || {};
  const name = String(body.name || '').trim().slice(0, 40);
  if (!name) return response.status(400).json({ error: 'Group needs a name.' });
  const emoji = String(body.emoji || '🎨');
  const memberIds = Array.isArray(body.memberIds)
    ? [...new Set(body.memberIds.map((m) => String(m)).filter((m) => m !== userId))].slice(0, 8)
    : [];

  const [profile, friendships] = await Promise.all([
    profileOf(userId),
    (await friendshipCollection())
      .find({ status: 'accepted', $or: [{ userA: userId }, { userB: userId }] })
      .toArray(),
  ]);
  if (profile?.suspended) return response.status(401).json({ error: 'Unauthorized: invalid session.' });

  const friendIds = new Set(friendships.map((f) => (f.userA === userId ? f.userB : f.userA)));
  const cleanMembers = memberIds.filter((m) => friendIds.has(m));
  const allMembers = [userId, ...cleanMembers];

  const result = await (await groupCollection()).insertOne({
    name,
    emoji,
    adminId: userId,
    memberIds: allMembers,
    wins: 0,
    played: 0,
    createdAt: Date.now(),
  });

  return response.status(200).json({ ok: true, groupId: String(result.insertedId) });
}