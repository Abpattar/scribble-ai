import { requireRole } from '../src/lib/serverAuth.js';
import { profileCollection, groupCollection, competitionCollection } from '../src/lib/mongodb.js';

export default async function handler(request, response) {
  if (request.method !== 'GET') return response.status(405).json({ error: 'Method not allowed' });
  const user = await requireRole(request, 'admin', 'superadmin');
  if (!user) return response.status(403).json({ error: 'Forbidden: admin access required.' });

  const profiles = await (await profileCollection()).find({}).toArray();
  const groups = await (await groupCollection()).find({}).sort({ createdAt: -1 }).limit(200).toArray();
  const competitions = await (await competitionCollection()).find({}).sort({ createdAt: -1 }).limit(200).toArray();

  let drawings = 0;
  let subscribers = 0;
  let revenue = 0;
  let payments = 0;
  const now = Date.now();
  for (const p of profiles) {
    drawings += Object.keys(p.drawings || {}).length;
    if (p.subscribed && (p.subscribedUntil || 0) > now) subscribers++;
    for (const pay of p.payments || []) {
      revenue += pay.amount || 0;
      payments++;
    }
  }

  const newUsers = profiles
    .slice()
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
    .slice(0, 8)
    .map((p) => ({
      id: p._id,
      nickname: p.nickname || '',
      email: p.email || '',
      createdAt: p.createdAt || 0,
    }));

  const recentCompetitions = competitions
    .slice()
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
    .slice(0, 6)
    .map((c) => ({
      id: String(c._id),
      prompt: c.prompt,
      status: c.closedAt ? 'closed' : c.voteEndTime > now ? (c.drawEndTime > now ? 'drawing' : 'voting') : 'closed',
      createdAt: c.createdAt,
    }));

  const groupsList = groups.map((g) => ({
    id: String(g._id),
    name: g.name,
    emoji: g.emoji,
    adminId: g.adminId,
    memberCount: (g.memberIds || []).length,
    wins: g.wins || 0,
    played: g.played || 0,
    createdAt: g.createdAt || 0,
  }));

  const competitionsList = competitions.map((c) => ({
    id: String(c._id),
    prompt: c.prompt,
    groupA: String(c.groupA),
    groupB: String(c.groupB),
    status: c.closedAt ? 'closed' : c.voteEndTime > now ? (c.drawEndTime > now ? 'drawing' : 'voting') : 'closed',
    createdAt: c.createdAt || 0,
    votes: Object.values(c.votes || {}).length,
  }));

  return response.status(200).json({
    users: profiles.length,
    drawings,
    groups: groupsList.length,
    competitions: competitionsList.length,
    competitionsPlayed: competitions.filter((c) => c.closedAt).length,
    subscribers,
    revenue,
    payments,
    newUsers,
    recentCompetitions,
    groupsList,
    competitionsList,
  });
}