import { verifyToken } from '@clerk/backend';
import { profileCollection } from './mongodb.js';

const secretKey = process.env.CLERK_SECRET_KEY;

if (!secretKey) {
  throw new Error('CLERK_SECRET_KEY environment variable is missing.');
}

// Verifies the client's Clerk session JWT (sent as `Authorization: Bearer <token>`)
// and returns the Clerk user id, or null when the session is invalid.
export async function requireUserId(request) {
  const header = request?.headers?.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) return null;

  try {
    const payload = await verifyToken(token, { secretKey });
    return payload.sub || null;
  } catch (error) {
    console.error('Clerk session verification failed:', error?.message || error);
    return null;
  }
}

// Authenticates the request and resolves the caller's role from their profile
// document. Suspended users are treated as unauthenticated. Returns
// { userId, role, profile } or null.
export async function requireUser(request) {
  const userId = await requireUserId(request);
  if (!userId) return null;
  const profile = await (await profileCollection()).findOne({ _id: userId });
  if (!profile || profile.suspended) return null;
  return { userId, profile, role: profile.role || 'user' };
}

// Like requireUser but enforces the role is one of `roles` (e.g. 'admin').
export async function requireRole(request, ...roles) {
  const user = await requireUser(request);
  if (!user) return null;
  if (roles.length && !roles.includes(user.role)) return null;
  return user;
}