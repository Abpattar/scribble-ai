import { useCallback, useRef, useState } from 'react';
import { useSession } from '@clerk/clerk-react';
import type { DrawEngine, Stroke } from '../lib/engine';

interface ProfileUser {
  uid: string;
  email: string | null;
}

export interface HistorySnap {
  ts: number;
  strokes: Stroke[];
}

// Mirrors the server's free tier (catalog.js) so the client renders sane locks
// even before the first profile fetch and during API hiccups.
export interface Features {
  templates: boolean;
  background_images: boolean;
  export_transparent: boolean;
  replay: boolean;
  record: boolean;
  battles: boolean;
}

export const FREE_TIER_FEATURES: Features = {
  templates: false,
  background_images: false,
  export_transparent: false,
  replay: false,
  record: false,
  battles: true,
};

export const DEFAULT_GALLERY_LIMIT = 3;

// Fetches the user's profile document from MongoDB via the serverless API.
// The Clerk session JWT (Authorization header) identifies the user server-side —
// the caller's uid is never trusted directly.
function useProfileApi() {
  const { session } = useSession();
  const tokenFnRef = useRef<(() => Promise<string | null>) | null>(null);

  if (session) {
    tokenFnRef.current = () => session.getToken();
  }

  const apiRequest = useCallback(async (body?: Record<string, any>) => {
    const token = (await tokenFnRef.current?.()) || null;
    const res = await fetch('/api/profile', {
      method: body ? 'POST' : 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const type = res.headers.get('content-type') || '';
    if (!type.includes('application/json')) {
      // Plain `vite dev` without the dev API server returns SPA HTML for /api —
      // surface that clearly instead of silently discarding data.
      throw new Error('Save failed — API unavailable. Run via `npm run dev` (with the dev API server).');
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || `Request failed (${res.status})`);
    }
    return data;
  }, []);

  return apiRequest;
}

export function useProfile() {
  const apiRequest = useProfileApi();
  const [nickname, setNickname] = useState<string | null>(null);
  const [bio, setBio] = useState('');
  const [subscribed, setSubscribedState] = useState(false);
  const [role, setRole] = useState<string>('user');
  const [plan, setPlan] = useState<string | null>(null);
  const [subscribedUntil, setSubscribedUntil] = useState<number | null>(null);
  const [payments, setPayments] = useState<any[]>([]);
  const [avatar, setAvatar] = useState<string>('');
  const [features, setFeatures] = useState<Features>({ ...FREE_TIER_FEATURES });
  const [galleryLimit, setGalleryLimit] = useState<number>(DEFAULT_GALLERY_LIMIT);
  const [drawings, setDrawings] = useState<Record<string, Stroke[]>>({});
  const [favorites, setFavorites] = useState<Record<string, boolean>>({});
  const [history, setHistory] = useState<Record<string, HistorySnap[]>>({});
  const [currentName, setCurrentName] = useState('Untitled');
  const [saveStatus, setSaveStatus] = useState('');
  const userRef = useRef<ProfileUser | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout>>();
  const drawStart = useRef(Date.now());

  const load = useCallback(
    async (user: ProfileUser, engine: DrawEngine) => {
      userRef.current = user;
      let nn: string | null = null;
      let bb = '';
      let sub = false;
      let rl = 'user';
      let pl = null as string | null;
      let until = null as number | null;
      let pays: any[] = [];
      let av = null as string | null;
      let ft: Features = { ...FREE_TIER_FEATURES };
      let gl = DEFAULT_GALLERY_LIMIT;
      let dr: Record<string, Stroke[]> = {};
      let fv: Record<string, boolean> = {};
      let hs: Record<string, HistorySnap[]> = {};
      try {
        const { profile } = await apiRequest();
        if (profile) {
          dr = profile.drawings || {};
          fv = profile.favorites || {};
          hs = profile.history || {};
          nn = profile.nickname || null;
          bb = profile.bio || '';
          sub = !!profile.subscribed || (profile.subscribedUntil || 0) > Date.now();
          rl = profile.role || 'user';
          pl = profile.plan || null;
          until = profile.subscribedUntil || null;
          pays = profile.payments || [];
          av = profile.avatar || null;
          ft = profile.features ? { ...FREE_TIER_FEATURES, ...profile.features } : ft;
          gl = typeof profile.galleryLimit === 'number' ? profile.galleryLimit : DEFAULT_GALLERY_LIMIT;
        }
      } catch (e) {
        console.error('Failed to load saved drawings:', e);
      }

      // Always start a fresh, blank drawing on login/reopen instead of
      // resuming the last-open one. Existing saved drawings are untouched
      // and stay browsable in the gallery — this just picks a name that
      // doesn't collide with any of them for the new blank session.
      let cur = 'Untitled';
      let n = 2;
      while (dr[cur]) {
        cur = 'Untitled ' + n;
        n++;
      }
      dr = { ...dr, [cur]: [] };

      setNickname(nn);
      setBio(bb);
      setSubscribedState(sub);
      setRole(rl);
      setPlan(pl);
      setSubscribedUntil(until);
      setPayments(pays);
      setAvatar(av || '');
      setFeatures(ft);
      setGalleryLimit(gl);
      setDrawings(dr);
      setFavorites(fv);
      setHistory(hs);
      setCurrentName(cur);
      drawStart.current = Date.now();
      engine.setStrokes([]);
      return nn;
    },
    [apiRequest]
  );

  // Re-fetches just the account-level fields (role, plan, subscription,
  // payments) after a payment or an admin role change — keeps current
  // drawing state untouched.
  const refresh = useCallback(async () => {
    try {
      const { profile } = await apiRequest();
      if (!profile) return;
      setSubscribedState(!!profile.subscribed || (profile.subscribedUntil || 0) > Date.now());
      setRole(profile.role || 'user');
      setPlan(profile.plan || null);
      setSubscribedUntil(profile.subscribedUntil || null);
      setPayments(profile.payments || []);
      setAvatar(profile.avatar || '');
      setFeatures(profile.features ? { ...FREE_TIER_FEATURES, ...profile.features } : { ...FREE_TIER_FEATURES });
      setGalleryLimit(typeof profile.galleryLimit === 'number' ? profile.galleryLimit : DEFAULT_GALLERY_LIMIT);
    } catch (e) {
      console.error('Failed to refresh profile:', e);
      throw e;
    }
  }, [apiRequest]);

  const persist = useCallback(
    async (partial: Record<string, any>) => {
      if (!userRef.current) return;
      try {
        await apiRequest(partial);
      } catch (e) {
        console.error('Save failed:', e);
        throw e;
      }
    },
    [apiRequest]
  );

  const saveNicknameOnly = useCallback(
    async (nn: string) => {
      setNickname(nn);
      await persist({ nickname: nn, email: userRef.current?.email });
    },
    [persist]
  );

  // Mirrors the legacy Firebase helper, but MongoDB-backed `subscribed` can
  // only be flipped server-side by /api/verify-payment after a verified
  // Razorpay payment. Kept only for local/dev testing;  no longer wired to UI.
  const setSubscribed = useCallback(
    async (value: boolean) => {
      setSubscribedState(value);
      await persist({ subscribed: value, email: userRef.current?.email });
    },
    [persist]
  );

  // Updates only local React state to reflect a subscription that was
  // already confirmed and written server-side. Does NOT write to MongoDB
  // itself — the server already did that.
  const markSubscribedLocally = useCallback(() => {
    setSubscribedState(true);
  }, []);

  const saveProfileDetails = useCallback(
    async (name: string, newBio: string, avatar = '') => {
      setNickname(name);
      setBio(newBio);
      await persist({ nickname: name, bio: newBio, avatar, email: userRef.current?.email });
    },
    [persist]
  );

  const saveCurrentDrawing = useCallback(
    (engine: DrawEngine) => {
      if (!userRef.current) return;
      setDrawings((prevDr) => {
        const nextDr = { ...prevDr, [currentName]: engine.getStrokes() };
        setHistory((prevHs) => {
          const h = [...(prevHs[currentName] || [])];
          h.push({ ts: Date.now(), strokes: JSON.parse(JSON.stringify(engine.getStrokes())) });
          if (h.length > 10) h.shift();
          const nextHs = { ...prevHs, [currentName]: h };
          setFavorites((prevFv) => {
            setSaveStatus('Saving…');
            persist({
              drawings: nextDr,
              current: currentName,
              favorites: prevFv,
              history: nextHs,
              email: userRef.current?.email,
              updatedAt: Date.now(),
            })
              .then(() => {
                setSaveStatus('Saved ✓');
                setTimeout(() => setSaveStatus((s) => (s === 'Saved ✓' ? '' : s)), 1500);
              })
              .catch(() => setSaveStatus('Save failed'));
            return prevFv;
          });
          return nextHs;
        });
        return nextDr;
      });
    },
    [currentName, persist]
  );

  const scheduleSave = useCallback(
    (engine: DrawEngine) => {
      if (!userRef.current) return;
      setSaveStatus('Saving…');
      clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => saveCurrentDrawing(engine), 800);
    },
    [saveCurrentDrawing]
  );

  const switchDrawing = useCallback(
    (name: string, engine: DrawEngine) => {
      if (name === currentName) return;
      engine.commitActiveStroke();
      engine.commitShape();
      setDrawings((prev) => {
        const next = { ...prev, [currentName]: engine.getStrokes() };
        setCurrentName(name);
        engine.setStrokes(next[name] ? JSON.parse(JSON.stringify(next[name])) : []);
        drawStart.current = Date.now();
        scheduleSave(engine);
        return next;
      });
    },
    [currentName, scheduleSave]
  );

  const newDrawing = useCallback(
    (rawName: string, engine: DrawEngine) => {
      engine.commitActiveStroke();
      engine.commitShape();
      setDrawings((prev) => {
        let name = rawName.trim();
        if (!name) {
          let n = Object.keys(prev).length + 1;
          do {
            name = 'Drawing ' + n;
            n++;
          } while (prev[name]);
        }
        if (prev[name]) {
          setCurrentName(name);
          engine.setStrokes(prev[name] ? JSON.parse(JSON.stringify(prev[name])) : []);
          return prev;
        }
        const next = { ...prev, [currentName]: engine.getStrokes(), [name]: [] };
        setCurrentName(name);
        engine.setStrokes([]);
        drawStart.current = Date.now();
        scheduleSave(engine);
        return next;
      });
    },
    [currentName, scheduleSave]
  );

  const renameDrawing = useCallback(
    (oldName: string, newName: string, engine: DrawEngine) => {
      if (!newName || newName === oldName) return;
      setDrawings((prev) => {
        if (prev[newName]) {
          alert('A drawing with that name already exists.');
          return prev;
        }
        const next = { ...prev, [newName]: prev[oldName] };
        delete next[oldName];
        return next;
      });
      setFavorites((prev) => {
        const next = { ...prev };
        if (next[oldName]) {
          next[newName] = true;
          delete next[oldName];
        }
        return next;
      });
      setHistory((prev) => {
        const next = { ...prev };
        if (next[oldName]) {
          next[newName] = next[oldName];
          delete next[oldName];
        }
        return next;
      });
      setCurrentName((prev) => (prev === oldName ? newName : prev));
      scheduleSave(engine);
    },
    [scheduleSave]
  );

  const duplicateDrawing = useCallback(
    (name: string, engine: DrawEngine) => {
      setDrawings((prev) => {
        let copyName = name + ' copy';
        let n = 2;
        while (prev[copyName]) {
          copyName = name + ' copy ' + n;
          n++;
        }
        const next = { ...prev, [copyName]: JSON.parse(JSON.stringify(prev[name])) };
        return next;
      });
      scheduleSave(engine);
    },
    [scheduleSave]
  );

  const deleteDrawing = useCallback(
    (name: string, engine: DrawEngine) => {
      if (!confirm(`Delete "${name}"? This cannot be undone.`)) return;
      setDrawings((prev) => {
        const next = { ...prev };
        delete next[name];
        if (currentName === name) {
          const remaining = Object.keys(next);
          const nextCurrent = remaining[0] || 'Untitled';
          if (!next[nextCurrent]) next[nextCurrent] = [];
          setCurrentName(nextCurrent);
          engine.setStrokes(next[nextCurrent] ? JSON.parse(JSON.stringify(next[nextCurrent])) : []);
        }
        return next;
      });
      setFavorites((prev) => {
        const next = { ...prev };
        delete next[name];
        return next;
      });
      setHistory((prev) => {
        const next = { ...prev };
        delete next[name];
        return next;
      });
      scheduleSave(engine);
    },
    [currentName, scheduleSave]
  );

  const toggleFavorite = useCallback(
    (name: string, engine: DrawEngine) => {
      setFavorites((prev) => ({ ...prev, [name]: !prev[name] }));
      scheduleSave(engine);
    },
    [scheduleSave]
  );

  const restoreVersion = useCallback(
    (snap: HistorySnap, engine: DrawEngine) => {
      if (!confirm('Restore this version? Current changes will be overwritten.')) return;
      engine.commitActiveStroke();
      engine.commitShape();
      engine.setStrokes(JSON.parse(JSON.stringify(snap.strokes)));
      scheduleSave(engine);
    },
    [scheduleSave]
  );

  const reset = useCallback(() => {
    userRef.current = null;
    setNickname(null);
    setBio('');
    setSubscribedState(false);
    setRole('user');
    setPlan(null);
    setSubscribedUntil(null);
    setPayments([]);
    setAvatar('');
    setFeatures({ ...FREE_TIER_FEATURES });
    setGalleryLimit(DEFAULT_GALLERY_LIMIT);
    setDrawings({});
    setFavorites({});
    setHistory({});
    setCurrentName('Untitled');
    setSaveStatus('');
  }, []);

  return {
    nickname,
    bio,
    subscribed,
    role,
    avatar,
    plan,
    subscribedUntil,
    payments,
    features,
    galleryLimit,
    isAdmin: role === 'admin' || role === 'superadmin',
    isSuperadmin: role === 'superadmin',
    setSubscribed,
    markSubscribedLocally,
    drawings,
    favorites,
    history,
    currentName,
    saveStatus,
    drawStartTime: drawStart,
    load,
    refresh,
    saveNicknameOnly,
    saveProfileDetails,
    scheduleSave,
    switchDrawing,
    newDrawing,
    renameDrawing,
    duplicateDrawing,
    deleteDrawing,
    toggleFavorite,
    restoreVersion,
    reset,
  };
}