import { requireUserId } from '../src/lib/serverAuth.js';
import { competitionCollection, groupCollection, profileCollection } from '../src/lib/mongodb.js';
import { ObjectId } from 'mongodb';
import { DRAW_WINDOW_MS, VOTE_WINDOW_MS, BATTLE_PROMPTS } from './lib/battle.js';

function safeId(id) {
  try {
    return new ObjectId(id);
  } catch {
    return id;
  }
}

// Expands a set of group ids into a mixed `$in` filter so a single query
// matches documents whose _id is stored as a string or as an ObjectId.
function batchIds(ids) {
  const out = [];
  for (const id of ids) {
    const s = String(id);
    if (s && !out.includes(s)) out.push(s);
    const oi = safeId(s);
    if (oi instanceof ObjectId && !out.some((x) => x instanceof ObjectId && x.toHexString() === oi.toHexString())) {
      out.push(oi);
    }
  }
  return out;
}

async function groupDoc(id) {
  try {
    return await (await groupCollection()).findOne({ _id: safeId(id) });
  } catch {
    return null;
  }
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

function tally(votes, id) {
  return Object.values(votes || {}).filter((v) => String(v) === String(id)).length;
}

// Which side of the battle this user belongs to (they must be a member of
// the group to draw/vote for it).
function myGroupOf(comp, gaDoc, gbDoc, userId) {
  if (gaDoc?.memberIds?.includes(userId)) return comp.groupA;
  if (gbDoc?.memberIds?.includes(userId)) return comp.groupB;
  return null;
}

async function memberKey(comp, userId) {
  const docs = await (await groupCollection())
    .find({ _id: { $in: batchIds([comp.groupA, comp.groupB]) } })
    .toArray();
  const gaDoc = docs.find((g) => String(g._id) === String(comp.groupA)) || null;
  const gbDoc = docs.find((g) => String(g._id) === String(comp.groupB)) || null;
  return myGroupOf(comp, gaDoc, gbDoc, userId);
}

// Authenticated reads run the (cheap) profile lookup in parallel with the
// real work below it, keeping the whole handler to ~2 Mongo round-trips
// instead of ~3-4 sequential ones. A suspended user is still rejected.
async function profileOf(userId) {
  return (await profileCollection()).findOne({ _id: userId });
}

export default async function handler(request, response) {
  try {
    const userId = await requireUserId(request);
    if (!userId) return response.status(401).json({ error: 'Unauthorized: invalid session.' });

    const isCompetitionRoute = request.query?.route === 'competition' || Boolean(request.query?.competitionId);
    if (isCompetitionRoute) return competitionAction(request, response, userId);

    if (request.method === 'GET') return getCompetitions(request, response, userId);
    if (request.method === 'POST') return createCompetition(request, response, userId);
    return response.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    console.error('competitions handler failed:', error?.message || error);
    return response.status(503).json({
      error: 'Battles are temporarily unavailable. Give it a moment and try again.',
    });
  }
}

// Lazily finalises a competition once the vote window passes: tallies votes,
// records the winner and bumps each group's leaderboard counters. Runs on the
// first request after the deadline (no cron needed).
async function settle(comp) {
  if (comp.winner !== null && comp.winner !== undefined) return comp;
  if (statusOf(comp) !== 'closed') return comp;
  const aCount = tally(comp.votes, comp.groupA);
  const bCount = tally(comp.votes, comp.groupB);
  const winner = aCount === bCount ? null : aCount > bCount ? comp.groupA : comp.groupB;
  const col = await competitionCollection();
  await col.updateOne({ _id: comp._id }, { $set: { winner, closedAt: Date.now() } });
  const groupCol = await groupCollection();
  for (const gid of [comp.groupA, comp.groupB]) {
    const inc = { played: 1 };
    if (String(winner) === String(gid)) inc.wins = 1;
    await groupCol.updateOne({ _id: safeId(gid) }, { $inc: inc });
  }
  comp.winner = winner;
  return comp;
}

async function getOne(comp, user, response) {
  const [ga, gb] = await Promise.all([groupDoc(comp.groupA), groupDoc(comp.groupB)]);
  const myKey = myGroupOf(comp, ga, gb, user.userId);
  const st = statusOf(comp);
  const votes = comp.votes || {};
  const aCount = tally(votes, comp.groupA);
  const bCount = tally(votes, comp.groupB);
  const entries = [
    { groupId: comp.groupA, strokes: comp.entries?.[comp.groupA]?.strokes || [], submittedAt: comp.entries?.[comp.groupA]?.submittedAt || 0 },
    { groupId: comp.groupB, strokes: comp.entries?.[comp.groupB]?.strokes || [], submittedAt: comp.entries?.[comp.groupB]?.submittedAt || 0 },
  ];

  return response.status(200).json({
    id: String(comp._id),
    prompt: comp.prompt,
    groupA: { id: String(ga?._id || comp.groupA), name: ga?.name || 'Group A', emoji: ga?.emoji || '🎨' },
    groupB: { id: String(gb?._id || comp.groupB), name: gb?.name || 'Group B', emoji: gb?.emoji || '🎨' },
    status: st,
    drawEndTime: comp.drawEndTime,
    voteEndTime: comp.voteEndTime,
    myGroup: myKey || null,
    myVote: votes[user.userId] || null,
    hasVoted: Boolean(votes[user.userId]),
    votes: st === 'voting' || st === 'closed' ? { A: aCount, B: bCount } : null,
    winner:
      st === 'closed' && comp.winner
        ? { id: comp.winner, name: String(comp.winner) === String(comp.groupA) ? (ga?.name || 'Group A') : (gb?.name || 'Group B'), emoji: String(comp.winner) === String(comp.groupA) ? (ga?.emoji || '🎨') : (gb?.emoji || '🎨') }
        : null,
    entries: st === 'drawing' && !myKey ? null : entries,
  });
}

async function competitionAction(request, response, userId) {
  const id = String(request.query?.competitionId || '');
  const [profile, comp] = await Promise.all([
    profileOf(userId),
    (await competitionCollection()).findOne({ _id: safeId(id) }),
  ]);
  if (profile?.suspended) return response.status(401).json({ error: 'Unauthorized: invalid session.' });
  if (!comp) return response.status(404).json({ error: 'Competition not found.' });
  const user = { userId };

  if (request.method === 'GET') {
    const settled = await settle(comp);
    return getOne(settled, user, response);
  }
  if (request.method !== 'POST') return response.status(405).json({ error: 'Method not allowed' });

  const settled = await settle(comp);
  const col = await competitionCollection();
  const action = request.body?.action || '';
  const myKey = await memberKey(settled, user.userId);

  if (action === 'sync' || action === 'submit') {
    if (!myKey) return response.status(403).json({ error: 'You are not part of this battle.' });
    if (statusOf(settled) !== 'drawing') return response.status(400).json({ error: 'The drawing window is over.' });
    const strokes = Array.isArray(request.body.strokes) ? request.body.strokes : undefined;
    const entry = { updatedAt: Date.now() };
    if (strokes) entry.strokes = strokes;
    if (action === 'submit') entry.submittedAt = Date.now();
    await col.updateOne({ _id: settled._id }, { $set: { [`entries.${myKey}`]: entry } });
    return response.status(200).json({ ok: true });
  }

  if (action === 'vote') {
    if (statusOf(settled) !== 'voting') return response.status(400).json({ error: 'Voting is not open yet.' });
    const target = String(request.body.groupId || '');
    if (target !== String(settled.groupA) && target !== String(settled.groupB)) return response.status(400).json({ error: 'Invalid vote target.' });
    if (settled.votes?.[user.userId]) return response.status(400).json({ error: 'You already voted.' });
    await col.updateOne({ _id: settled._id }, { $set: { [`votes.${user.userId}`]: target } });
    return response.status(200).json({ ok: true, voted: target });
  }

  return response.status(400).json({ error: 'Unknown action.' });
}

// List endpoint, deliberately batching MongoDB reads: one query for the
// battles, one $in for every referenced group, one for this user's groups.
// The previous per-battle findOne loop was ~4 round-trips × up to 30 battles
// (sequential along the way) — enough to exceed Vercel Hobby's ~10s cap and
// surface as a flaky 500 on cold starts.
async function getCompetitions(request, response, userId) {
  // Wave 1: verify identity (basic read) + load the battles in parallel.
  const [profile, rows] = await Promise.all([
    profileOf(userId),
    (await competitionCollection()).find({}).sort({ createdAt: -1 }).limit(40).toArray(),
  ]);
  if (profile?.suspended) return response.status(401).json({ error: 'Unauthorized: invalid session.' });
  if (!rows.length) {
    return response.status(200).json({ active: [], recent: [] });
  }

  const refIds = new Set();
  for (const c of rows) {
    refIds.add(c.groupA);
    refIds.add(c.groupB);
  }

  // Wave 2: one query for every referenced group + one for the user's groups.
  const groupCol = await groupCollection();
  const [groupDocs, myGroups] = await Promise.all([
    groupCol.find({ _id: { $in: batchIds(refIds) } }).toArray(),
    groupCol.find({ memberIds: userId }).project({ _id: 1 }).toArray(),
  ]);
  const groupMap = new Map(groupDocs.map((g) => [String(g._id), g]));
  const myGroupIds = new Set(myGroups.map((g) => String(g._id)));

  const infoOf = (id) => {
    const g = groupMap.get(String(id));
    return g ? { id: String(g._id), name: g.name, emoji: g.emoji } : { id: String(id), name: 'Group', emoji: '🎨' };
  };

  const out = [];
  for (const c of rows) {
    const ga = infoOf(c.groupA);
    const gb = infoOf(c.groupB);
    const st = statusOf(c);
    const aCount = tally(c.votes, c.groupA);
    const bCount = tally(c.votes, c.groupB);
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
          ? { id: c.winner, name: String(c.winner) === String(c.groupA) ? ga.name : gb.name, emoji: String(c.winner) === String(c.groupA) ? ga.emoji : gb.emoji }
          : null,
      myGroup: myGroupIds.has(String(c.groupA)) ? c.groupA : myGroupIds.has(String(c.groupB)) ? c.groupB : null,
      hasVoted: Boolean(c.votes?.[userId]),
      votes: closed || st === 'voting' ? { A: aCount, B: bCount } : null,
    });
  }

  const active = out.filter((o) => o.status !== 'closed').slice(0, 12);
  const recent = out.filter((o) => o.status === 'closed').slice(0, 12);
  return response.status(200).json({ active, recent });
}

async function createCompetition(request, response, userId) {
  const body = request.body || {};
  const source = String(body.sourceGroupId || '');
  const target = String(body.targetGroupId || '');
  if (!source || !target) return response.status(400).json({ error: 'Pick two groups to battle.' });
  if (source === target) return response.status(400).json({ error: 'A group cannot battle itself.' });

  const [profile, docs] = await Promise.all([
    profileOf(userId),
    (await groupCollection()).find({ _id: { $in: batchIds([source, target]) } }).toArray(),
  ]);
  if (profile?.suspended) return response.status(401).json({ error: 'Unauthorized: invalid session.' });
  const sdoc = docs.find((g) => String(g._id) === String(source)) || null;
  const tdoc = docs.find((g) => String(g._id) === String(target)) || null;

  if (!sdoc?.memberIds?.includes(userId)) {
    return response.status(403).json({ error: 'You must be a member of the challenging group.' });
  }
  if (!tdoc) return response.status(404).json({ error: 'Target group not found.' });

  const prompt = String(body.prompt || '').trim() || BATTLE_PROMPTS[Math.floor(Math.random() * BATTLE_PROMPTS.length)];
  const now = Date.now();
  const result = await (await competitionCollection()).insertOne({
    prompt,
    groupA: source,
    groupB: target,
    createdBy: userId,
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