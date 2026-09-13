import { MongoClient } from 'mongodb';

// Lazy + never throws at import time: a missing/unreachable MONGODB_URI must
// not crash every API route (modals fall back to seeded data instead).
const uri = process.env.MONGODB_URI;

const DB_NAME = 'neonair';
const PROFILES_COLLECTION = 'profiles';
const FRIENDSHIPS_COLLECTION = 'friendships';
const GROUPS_COLLECTION = 'groups';
const COMPETITIONS_COLLECTION = 'competitions';
const PLANS_COLLECTION = 'plans';

let clientPromisePromise = null;

function createClient() {
  const client = new MongoClient(uri, {
    appName: 'neon-air-draw',
    connectTimeoutMS: 5000,
    serverSelectionTimeoutMS: 5000,
  });
  return client.connect();
}

export async function getDb() {
  if (!uri) {
    throw new Error('MONGODB_URI environment variable is missing.');
  }
  if (!clientPromisePromise) {
    if (process.env.NODE_ENV !== 'production') {
      clientPromisePromise = globalThis._mongoClientPromise || createClient();
      globalThis._mongoClientPromise = clientPromisePromise;
    } else {
      clientPromisePromise = createClient();
    }
  }
  const client = await clientPromisePromise;
  return client.db(DB_NAME);
}

export const profileCollection = () => getDb().then((db) => db.collection(PROFILES_COLLECTION));
export const friendshipCollection = () => getDb().then((db) => db.collection(FRIENDSHIPS_COLLECTION));
export const groupCollection = () => getDb().then((db) => db.collection(GROUPS_COLLECTION));
export const competitionCollection = () => getDb().then((db) => db.collection(COMPETITIONS_COLLECTION));
export const planCollection = () => getDb().then((db) => db.collection(PLANS_COLLECTION));