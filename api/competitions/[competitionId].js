import { requireUser } from '../../src/lib/serverAuth.js';
import { competitionCollection, groupCollection } from '../../src/lib/mongodb.js';
import { ObjectId } from 'mongodb';

function statusOf(c) {
  const now = Date.now();
  if (now < c.drawEndTime) return 'drawing';
  if (now < c.voteEndTime) return 'voting';
  return 'closed';
}

function safeId(id) {
  try {
    return new ObjectId(id);
  } catch {
    return id;
  }
}

async function groupDoc(id) {
  try {
    return await (await groupCollection()).findOne({ _id: safeId(id) });
  } catch {
    return null;
  }
}

async function memberKey(comp, userId) {
  for (const gid of [comp.groupA, comp.groupB]) {
    const g = await groupDoc(gid);
    if (g?.memberIds?.includes(userId)) return gid;
  }
  return null;
}

// Lazily finalises a competition once the vote window passes: tallies votes,
// records the winner and bumps each group's leaderboard counters. Runs on the
// first request after the deadline (no cron needed).
async function settle(comp) {
  if (comp.winner !== null && comp.winner !== undefined) return comp;
  if (statusOf(comp) !== 'closed') return comp;
  const votes = comp.votes || {};
  const aCount = Object.values(votes).filter((v) => v === comp.groupA).length;
  const bCount = Object.values(votes).filter((v) => v === comp.groupB).length;
  const winner = aCount === bCount ? null : aCount > bCount ? comp.groupA : comp.groupB;
  const col = await competitionCollection();
  await col.updateOne({ _id: comp._id }, { $set: { winner, closedAt: Date.now() } });
  const groupCol = await groupCollection();
  for (const gid of [comp.groupA, comp.groupB]) {
    const inc = { played: 1 };
    if (winner === gid) inc.wins = 1;
    await groupCol.updateOne({ _id: safeId(gid) }, { $inc: inc });
  }
  comp.winner = winner;
  return comp;
}

export default async function handler(request, response) {
  const user = await requireUser(request);
  if (!user) return response.status(401).json({ error: 'Unauthorized: invalid session.' });

  const id = String(request.query?.competitionId || '');
  let comp = await (await competitionCollection()).findOne({ _id: safeId(id) });
  if (!comp) return response.status(404).json({ error: 'Competition not found.' });

  if (request.method === 'GET') {
    comp = await settle(comp);
    return getOne(comp, user, response);
  }
  if (request.method !== 'POST') return response.status(405).json({ error: 'Method not allowed' });

  comp = await settle(comp);
  const col = await competitionCollection();
  const action = request.body?.action || '';
  const myKey = await memberKey(comp, user.userId);

  if (action === 'sync' || action === 'submit') {
    if (!myKey) return response.status(403).json({ error: 'You are not part of this battle.' });
    if (statusOf(comp) !== 'drawing') return response.status(400).json({ error: 'The drawing window is over.' });
    const strokes = Array.isArray(request.body.strokes) ? request.body.strokes : undefined;
    const entry = { updatedAt: Date.now() };
    if (strokes) entry.strokes = strokes;
    if (action === 'submit') entry.submittedAt = Date.now();
    await col.updateOne({ _id: comp._id }, { $set: { [`entries.${myKey}`]: entry } });
    return response.status(200).json({ ok: true });
  }

  if (action === 'vote') {
    if (statusOf(comp) !== 'voting') return response.status(400).json({ error: 'Voting is not open yet.' });
    const target = String(request.body.groupId || '');
    if (target !== comp.groupA && target !== comp.groupB) return response.status(400).json({ error: 'Invalid vote target.' });
    if (comp.votes?.[user.userId]) return response.status(400).json({ error: 'You already voted.' });
    await col.updateOne({ _id: comp._id }, { $set: { [`votes.${user.userId}`]: target } });
    return response.status(200).json({ ok: true, voted: target });
  }

  return response.status(400).json({ error: 'Unknown action.' });
}

async function getOne(comp, user, response) {
  const [ga, gb] = await Promise.all([groupDoc(comp.groupA), groupDoc(comp.groupB)]);
  const myKey = await memberKey(comp, user.userId);
  const st = statusOf(comp);
  const votes = comp.votes || {};
  const aCount = Object.values(votes).filter((v) => v === comp.groupA).length;
  const bCount = Object.values(votes).filter((v) => v === comp.groupB).length;
  const entries = [
    { groupId: comp.groupA, strokes: comp.entries?.[comp.groupA]?.strokes || [], submittedAt: comp.entries?.[comp.groupA]?.submittedAt || 0 },
    { groupId: comp.groupB, strokes: comp.entries?.[comp.groupB]?.strokes || [], submittedAt: comp.entries?.[comp.groupB]?.submittedAt || 0 },
  ];

  return response.status(200).json({
    id: String(comp._id),
    prompt: comp.prompt,
    groupA: { id: comp.groupA, name: ga?.name || 'Group A', emoji: ga?.emoji || '🎨' },
    groupB: { id: comp.groupB, name: gb?.name || 'Group B', emoji: gb?.emoji || '🎨' },
    status: st,
    drawEndTime: comp.drawEndTime,
    voteEndTime: comp.voteEndTime,
    myGroup: myKey || null,
    myVote: votes[user.userId] || null,
    hasVoted: Boolean(votes[user.userId]),
    votes: st === 'voting' || st === 'closed' ? { A: aCount, B: bCount } : null,
    winner:
      st === 'closed' && comp.winner
        ? { id: comp.winner, name: comp.winner === comp.groupA ? ga?.name : gb?.name, emoji: comp.winner === comp.groupA ? ga?.emoji : gb?.emoji }
        : null,
    entries: st === 'drawing' && !myKey ? null : entries,
  });
}