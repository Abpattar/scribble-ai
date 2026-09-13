import { requireUser } from '../../src/lib/serverAuth.js';
import { friendshipCollection } from '../../src/lib/mongodb.js';

// Lightweight pending friend-request counter so the UI can show a glowing
// badge without downloading the whole friend graph on a poll.
export default async function handler(request, response) {
  if (request.method !== 'GET') {
    return response.status(405).json({ error: 'Method not allowed' });
  }
  const user = await requireUser(request);
  if (!user) {
    return response.status(401).json({ error: 'Unauthorized: invalid session.' });
  }
  try {
    const count = await (await friendshipCollection()).countDocuments({
      status: 'pending',
      actionUserId: { $ne: user.userId },
      $or: [{ userA: user.userId }, { userB: user.userId }],
    });
    return response.status(200).json({ count });
  } catch (error) {
    return response.status(500).json({ error: error?.message || 'Could not load friend requests.' });
  }
}