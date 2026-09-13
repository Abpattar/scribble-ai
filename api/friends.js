import { requireUser } from '../src/lib/serverAuth.js';
import { friendshipCollection, profileCollection } from '../src/lib/mongodb.js';

const pair = (a, b) => (a < b ? [a, b] : [b, a]);

async function resolveUsers(ids) {
  if (!ids.length) return {};
  const docs = await (await profileCollection()).find({ _id: { $in: ids } }).toArray();
  const map = {};
  for (const d of docs) {
    map[d._id] = { userId: d._id, nickname: d.nickname || '', email: d.email || '', avatar: d.avatar || '' };
  }
  return map;
}

export default async function handler(request, response) {
  const user = await requireUser(request);
  if (!user) return response.status(401).json({ error: 'Unauthorized: invalid session.' });

  if (request.method === 'GET') return getFriends(request, response, user);
  if (request.method === 'POST') return postFriends(request, response, user);
  return response.status(405).json({ error: 'Method not allowed' });
}

async function getFriends(request, response, user) {
  const col = await friendshipCollection();
  const rows = await col
    .find({ $or: [{ userA: user.userId }, { userB: user.userId }] })
    .toArray();

  const friends = [];
  const outgoing = [];
  const incoming = [];
  for (const r of rows) {
    const other = r.userA === user.userId ? r.userB : r.userA;
    if (r.status === 'accepted') friends.push(other);
    else if (r.actionUserId === user.userId) outgoing.push(other);
    else incoming.push(other);
  }

  const allIds = new Set([...friends, ...outgoing, ...incoming]);
  const users = await resolveUsers([...allIds]);
  const toView = (id) => ({ userId: id, ...(users[id] || { userId: id }) });

  return response.status(200).json({
    friends: friends.map(toView),
    outgoing: outgoing.map(toView),
    incoming: incoming.map(toView),
  });
}

async function postFriends(request, response, user) {
  const col = await friendshipCollection();
  const body = request.body || {};
  const action = body.action || 'add';

  if (action === 'add') {
    const lookup = String(body.email || body.nickname || '').trim().toLowerCase();
    if (!lookup) return response.status(400).json({ error: 'Enter an email or nickname.' });
    const target = await (await profileCollection())
      .find({
        $or: [
          { email: lookup },
          { email: new RegExp(`^${lookup.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') },
          { nickname: new RegExp(`^${lookup.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') },
        ],
      })
      .limit(5)
      .toArray();
    const matched = target.filter((t) => t._id !== user.userId);
    if (!matched.length) return response.status(404).json({ error: 'No Neon Air user found with that email or nickname.' });

    // If several nicknames matched, resolve to the exact one or the first.
    const targetUser = matched.find((t) => (t.email || '').toLowerCase() === lookup || (t.nickname || '').toLowerCase() === lookup) || matched[0];
    const [a, b] = pair(user.userId, targetUser._id);
    const existing = await col.findOne({ userA: a, userB: b });
    if (existing) {
      if (existing.status === 'accepted') return response.status(200).json({ ok: true, already: true });
      if (existing.actionUserId === user.userId) return response.status(200).json({ ok: true, already: true });
      // They already sent us a request → this accepts it.
      await col.updateOne({ _id: existing._id }, { $set: { status: 'accepted', respondedAt: Date.now() } });
      return response.status(200).json({ ok: true, accepted: true });
    }
    await col.insertOne({ userA: a, userB: b, status: 'pending', actionUserId: user.userId, createdAt: Date.now() });
    return response.status(200).json({ ok: true });
  }

  const otherId = String(body.userId || '');
  const [a, b] = pair(user.userId, otherId);
  const existing = await col.findOne({ userA: a, userB: b });
  if (!existing) return response.status(404).json({ error: 'Friendship not found.' });

  if (action === 'accept') {
    if (existing.status === 'accepted') return response.status(200).json({ ok: true });
    if (existing.actionUserId === user.userId) return response.status(400).json({ error: 'That is your own outgoing request.' });
    await col.updateOne({ _id: existing._id }, { $set: { status: 'accepted', respondedAt: Date.now() } });
    return response.status(200).json({ ok: true });
  }

  if (action === 'decline' || action === 'cancel' || action === 'remove') {
    await col.deleteOne({ _id: existing._id });
    return response.status(200).json({ ok: true });
  }

  return response.status(400).json({ error: 'Unknown action.' });
}