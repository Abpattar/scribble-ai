import { requireUser } from '../src/lib/serverAuth.js';
import { competitionCollection, groupCollection } from '../src/lib/mongodb.js';
import { ObjectId } from 'mongodb';
import { DRAW_WINDOW_MS, VOTE_WINDOW_MS, BATTLE_PROMPTS } from './lib/battle.js';

async function groupInfo(id) {
  try {
    const g = await (await groupCollection()).findOne({ _id: new ObjectId(id) });
    if (g) return { id: String(g._id), name: g.name, emoji: g.emoji };
  } catch {
    /* bad id */
  }
  return { id, name: 'Group', emoji: '🎨' };
}

async function isGroupMember(groupId, userId) {
  try {
    const g = await (await groupCollection()).findOne({ _id: new ObjectId(groupId) });
    return Boolean(g?.memberIds?.includes(userId));
  } catch {
    return false;
  }
}

function statusOf(c) {
  const now = Date.now();
  if (now < c.drawEndTime) return 'drawing';
  if (now < c.voteEndTime) return 'voting';
  return 'closed';
}

export default async function handler(request, response) {
  const user = await requireUser(request);
  if (!user) return response.status(401).json({ error: 'Unauthorized: invalid session.' });

  if (request.method === 'GET') return getCompetitions(request, response, user);
  if (request.method === 'POST') return createCompetition(request, response, user);
  return response.status(405).json({ error: 'Method not allowed' });
}

async function getCompetitions(request, response, user) {
  const rows = await (await competitionCollection()).find({}).sort({ createdAt: -1 }).limit(30).toArray();
  const out = [];
  for (const c of rows) {
    const [ga, gb] = await Promise.all([groupInfo(c.groupA), groupInfo(c.groupB)]);
    const st = statusOf(c);
    const votes = c.votes || {};
    const aCount = Object.values(votes).filter((v) => v === c.groupA).length;
    const bCount = Object.values(votes).filter((v) => v === c.groupB).length;
    const closed = st === 'closed';
    out.push({
      id: String(c._id),
      prompt: c.prompt,
      groupA: ga,
      groupB: gb,
      status: st,
      drawEndTime: c.drawEndTime,
      voteEndTime: c.voteEndTime,
      createdAt: c.createdAt,
      winner:
        closed && c.winner
          ? { id: c.winner, name: c.winner === c.groupA ? ga.name : gb.name, emoji: c.winner === c.groupA ? ga.emoji : gb.emoji }
          : null,
      myGroup: (await isGroupMember(c.groupA, user.userId))
        ? c.groupA
        : (await isGroupMember(c.groupB, user.userId))
          ? c.groupB
          : null,
      hasVoted: Boolean(votes[user.userId]),
      votes: closed || st === 'voting' ? { A: aCount, B: bCount } : null,
    });
  }
  const active = out.filter((o) => o.status !== 'closed').slice(0, 12);
  const recent = out.filter((o) => o.status === 'closed').slice(0, 12);
  return response.status(200).json({ active, recent });
}

async function createCompetition(request, response, user) {
  const body = request.body || {};
  const source = String(body.sourceGroupId || '');
  const target = String(body.targetGroupId || '');
  if (!source || !target) return response.status(400).json({ error: 'Pick two groups to battle.' });
  if (source === target) return response.status(400).json({ error: 'A group cannot battle itself.' });
  if (!(await isGroupMember(source, user.userId))) {
    return response.status(403).json({ error: 'You must be a member of the challenging group.' });
  }
  const gb = await (await groupCollection()).findOne({ _id: safeId(target) });
  if (!gb) return response.status(404).json({ error: 'Target group not found.' });

  const prompt = String(body.prompt || '').trim() || BATTLE_PROMPTS[Math.floor(Math.random() * BATTLE_PROMPTS.length)];
  const now = Date.now();
  const result = await (await competitionCollection()).insertOne({
    prompt,
    groupA: source,
    groupB: target,
    createdBy: user.userId,
    createdAt: now,
    drawEndTime: now + DRAW_WINDOW_MS,
    voteEndTime: now + DRAW_WINDOW_MS + VOTE_WINDOW_MS,
    entries: {
      [source]: { strokes: [], updatedAt: 0, submittedAt: 0 },
      [target]: { strokes: [], updatedAt: 0, submittedAt: 0 },
    },
    votes: {},
    winner: null,
    closedAt: null,
  });
  return response.status(200).json({ ok: true, id: String(result.insertedId), drawEndTime: now + DRAW_WINDOW_MS });
}

function safeId(id) {
  try {
    return new ObjectId(id);
  } catch {
    return id;
  }
}