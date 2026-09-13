import { useCallback, useEffect, useState } from 'react';
import { X, UserCheck, UserX } from 'lucide-react';
import { useApi } from '../hooks/useApi';

interface FriendView {
  userId: string;
  nickname: string;
  email: string;
  avatar: string;
}
interface FriendsData {
  friends: FriendView[];
  outgoing: FriendView[];
  incoming: FriendView[];
}

export default function FriendsModal({ onClose, onChange }: { onClose: () => void; onChange?: () => void }) {
  const api = useApi();
  const [data, setData] = useState<FriendsData>({ friends: [], outgoing: [], incoming: [] });
  const [tab, setTab] = useState<'friends' | 'requests' | 'add'>('friends');
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const d = await api.get('/api/friends');
      setData(d);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load friends.');
    }
  }, [api]);

  useEffect(() => {
    load();
  }, [load]);

  async function act(action: string, userId?: string) {
    setError('');
    setBusy(action + (userId || ''));
    try {
      await api.post('/api/friends', userId ? { action, userId } : { action, email: query || undefined });
      setQuery('');
      await load();
      onChange?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.');
    } finally {
      setBusy(null);
    }
  }

  const view = (f: FriendView) => (
    <div key={f.userId} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '7px 0', borderBottom: '1px solid var(--chip-border)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
        <div style={{ width: 30, height: 30, borderRadius: '50%', background: 'var(--kid-yellow)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15, flexShrink: 0 }}>
          {f.avatar || '🙂'}
        </div>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 12.5, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{f.nickname || 'Neon Air drawer'}</div>
          <div style={{ fontSize: 10, color: 'var(--text-dim)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{f.email}</div>
        </div>
      </div>
    </div>
  );

  return (
    <div className="modal-overlay" style={{ zIndex: 90 }}>
      <div className="modal-box" style={{ width: 340 }}>
        <div className="close-btn" onClick={onClose} title="Close"><X size={16} /></div>
        <h3>Friends</h3>

        <div className="flex gap-1.5 mb-2">
          {(['friends', 'requests', 'add'] as const).map((t) => (
            <div key={t} className="gbtn" style={{ flex: 1, justifyContent: 'center', textTransform: 'capitalize' }} onClick={() => setTab(t)}>
              {t === 'requests' && data.incoming.length ? `${t} (${data.incoming.length})` : t}
            </div>
          ))}
        </div>

        {tab === 'add' && (
          <>
            <input className="field-input" placeholder="Email or nickname…" value={query} onChange={(e) => setQuery(e.target.value)} autoComplete="off" />
            <button className="gbtn" style={{ width: '100%', justifyContent: 'center', margin: '8px 0' }} onClick={() => act('add')} disabled={busy !== null}>
              {busy === 'add' ? 'Sending…' : 'Add friend'}
            </button>
            <div style={{ fontSize: 10.5, color: 'var(--text-dim)', marginBottom: 8 }}>
              They'll get a request; if they already sent you one, you'll be friends instantly.
            </div>
          </>
        )}

        <div style={{ maxHeight: 250, overflowY: 'auto' }}>
          {tab === 'friends' && (data.friends.length ? data.friends.map(view) : <div className="stat-row">No friends yet — add your first!</div>)}

          {tab === 'requests' && (
            <>
              {data.incoming.map((f) => (
                <div key={f.userId} style={{ padding: '7px 0', borderBottom: '1px solid var(--chip-border)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                      <div style={{ width: 30, height: 30, borderRadius: '50%', background: 'var(--kid-yellow)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15, flexShrink: 0 }}>
                        {f.avatar || '🙂'}
                      </div>
                      <div style={{ fontSize: 12.5, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{f.nickname || f.email}</div>
                    </div>
                    <div className="flex gap-1.5">
                      <div className="gmini" style={{ color: 'var(--kid-green)' }} title="Accept" onClick={() => act('accept', f.userId)}>
                        <UserCheck size={15} />
                      </div>
                      <div className="gmini" style={{ color: 'var(--kid-pink)' }} title="Decline" onClick={() => act('decline', f.userId)}>
                        <UserX size={15} />
                      </div>
                    </div>
                  </div>
                </div>
              ))}
              {!data.incoming.length && <div className="stat-row">No pending requests.</div>}
              {data.outgoing.length > 0 && (
                <>
                  <div style={{ fontSize: 10.5, color: 'var(--text-dim)', fontWeight: 700, margin: '8px 0 2px' }}>Sent</div>
                  {data.outgoing.map((f) => (
                    <div key={f.userId} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '5px 0' }}>
                      <span style={{ fontSize: 12, fontWeight: 600 }}>{f.nickname || f.email}</span>
                      <div className="gmini" title="Cancel" onClick={() => act('cancel', f.userId)}><UserX size={14} /></div>
                    </div>
                  ))}
                </>
              )}
            </>
          )}
        </div>

        {error && <div style={{ fontSize: 11, color: 'var(--kid-pink)', marginTop: 8 }}>{error}</div>}
        {tab === 'friends' && data.friends.length > 0 && (
          <div className="flex gap-1.5 mt-2">
            <div className="gbtn" style={{ flex: 1, justifyContent: 'center', color: 'var(--kid-pink)' }} onClick={() => {
              const f = data.friends[0];
              if (f && confirm(`Unfriend ${f.nickname || 'this user'}?`)) act('remove', f.userId);
            }}>
              <UserX size={14} /> Unfriend
            </div>
          </div>
        )}
      </div>
    </div>
  );
}