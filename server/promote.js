// Fallback superadmin bootstrap: `node server/promote.js <email> <role>`
// (role defaults to superadmin). Sets the role on the matching profile.
// ENV: MONGODB_URI (+ optionally CLERK_SECRET_KEY not needed for this).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { profileCollection } from '../src/lib/mongodb.js';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

for (const file of ['.env.local', '.env']) {
  const p = path.join(rootDir, file);
  if (!fs.existsSync(p)) continue;
  for (const rawLine of fs.readFileSync(p, 'utf8').split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    if (!(line.slice(0, eq).trim() in process.env)) {
      process.env[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
    }
  }
}

const email = (process.argv[2] || '').trim().toLowerCase();
const role = (process.argv[3] || 'superadmin').trim();
if (!email || !['user', 'admin', 'superadmin'].includes(role)) {
  console.error('Usage: node server/promote.js <email> <role|user|admin|superadmin>');
  process.exit(1);
}

const col = await profileCollection();
const result = await col.updateOne({ email: new RegExp(`^${email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') }, { $set: { role } });
console.log(`${result.matchedCount} matched · ${result.modifiedCount} upgraded to ${role} for ${email}`);
process.exit(0);