import { requireUser } from '../src/lib/serverAuth.js';
import { groupCollection, friendshipCollection, profileCollection } from '../src/lib/mongodb.js';
import { ObjectId } from 'mongodb';

async function membersOf(ids) {
  const docs = await (await profileCollection()).find({ _id: { $in: ids } }).toArray();
  const map = {};
  for (const d of docs) map[d._id] = { userId: d._id, nickname: d.nickname || '', email: d.email || '', avatar: d.avatar || '' };
  return map;
}

async function withMembers(group, ids) {
  const map = await membersOf(ids);
  return {
    ...group,
    id: String(group._id),
    _id: undefined,
    members: ids.map((id) => map[id] || { userId: id }),
  };
}

export default async function handler(request, response) {
  const user = await requireUser(request);
  if (!user) return response.status(401).json({ error: 'Unauthorized: invalid session.' });

  if (request.method === 'GET') return getGroups(request, response, user);
  if (request.method === 'POST') return createGroup(request, response, user);
  return response.status(405).json({ error: 'Method not allowed' });
}

async function getGroups(request, response, user) {
  const col = await groupCollection();
  const rows = await col.find({ memberIds: user.userId }).sort({ createdAt: -1 }).toArray();
  const groups = await Promise.all(rows.map((g) => withMembers(g, g.memberIds)));

  const friendships = await (await friendshipCollection())
    .find({
      status: 'accepted',
      $or: [{ userA: user.userId }, { userB: user.userId }],
    })
    .toArray();
  const friendIds = friendships.map((f) => (f.userA === user.userId ? f.userB : f.userA));
  const friends = await membersOf(friendIds);

  return response.status(200).json({ groups, friends: friendIds.map((id) => friends[id] || { userId: id }) });
}

async function createGroup(request, response, user) {
  const body = request.body || {};
  const name = String(body.name || '').trim().slice(0, 40);
  if (!name) return response.status(400).json({ error: 'Group needs a name.' });
  const emoji = String(body.emoji || '🎨');
  const memberIds = Array.isArray(body.memberIds)
    ? [...new Set(body.memberIds.map((m) => String(m)).filter((m) => m !== user.userId))].slice(0, 8)
    : [];

  const friendships = await (await friendshipCollection())
    .find({
      status: 'accepted',
      $or: [{ userA: user.userId }, { userB: user.userId }],
    })
    .toArray();
  const friendIds = new Set(friendships.map((f) => (f.userA === user.userId ? f.userB : f.userA)));
  const cleanMembers = memberIds.filter((m) => friendIds.has(m));
  const allMembers = [user.userId, ...cleanMembers];

  const result = await (await groupCollection()).insertOne({
    name,
    emoji,
    adminId: user.userId,
    memberIds: allMembers,
    wins: 0,
    played: 0,
    createdAt: Date.now(),
  });

  return response.status(200).json({ ok: true, groupId: String(result.insertedId) });
}