import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { X, Swords, Timer, Trophy, Vote, Check, RefreshCw, Send, AlertCircle, ChevronRight, Users, Sparkles } from 'lucide-react';
import { useApi } from '../hooks/useApi';
import type { Stroke } from '../lib/engine';
import { renderStrokesToCanvas } from '../lib/strokeRenderer';
import { BATTLE_PROMPTS, DRAW_WINDOW_MS } from '../lib/battle';

interface GroupInfo {
  id: string;
  name: string;
  emoji: string;
}
interface Group {
  id: string;
  name: string;
  emoji: string;
  wins: number;
  played: number;
  adminId: string;
  members: { userId: string; nickname: string }[];
}
interface CompetitionSummary {
  id: string;
  prompt: string;
  groupA: GroupInfo;
  groupB: GroupInfo;
  status: 'drawing' | 'voting' | 'closed';
  drawEndTime: number;
  voteEndTime: number;
  createdAt: number;
  winner: GroupInfo | null;
  myGroup: string | null;
  hasVoted: boolean;
  votes: { A: number; B: number } | null;
}
interface Entry {
  groupId: string;
  strokes: Stroke[];
  submittedAt: number;
}
interface CompetitionDetail extends CompetitionSummary {
  myGroup: string | null;
  myVote: string | null;
  entries: Entry[] | null;
}

interface Props {
  onClose: () => void;
  sourceGroup?: Group | null;
  getStrokes: () => Stroke[];
  canBattle?: boolean;
}

const AUTO_SYNC_MS = 5000;
const POLL_MS = 8000;

const STATUS_META = {
  drawing: { label: 'Drawing', color: 'var(--accent)', bg: 'rgba(47,155,255,0.12)' },
  voting: { label: 'Voting', color: 'var(--accent2)', bg: 'rgba(255,159,67,0.15)' },
  closed: { label: 'Finished', color: 'var(--text-dim)', bg: 'rgba(23,32,70,0.08)' },
} as const;

function fmtLeft(ms: number) {
  if (ms <= 0) return '0:00';
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function EntryCanvas({ strokes, height = 120 }: { strokes: Stroke[]; height?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (ref.current) renderStrokesToCanvas(ref.current, strokes || []);
  }, [strokes]);
  return <canvas ref={ref} width={160} height={height} style={{ width: 160, height, borderRadius: 10, border: '1px solid var(--chip-border)', background: '#fff' }} />;
}

function StatusPill({ status }: { status: 'drawing' | 'voting' | 'closed' }) {
  const m = STATUS_META[status];
  return (
    <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: 0.4, textTransform: 'uppercase', color: m.color, background: m.bg, padding: '3px 8px', borderRadius: 999, whiteSpace: 'nowrap' }}>
      {m.label}
    </span>
  );
}

type BattleTab = 'live' | 'create' | 'results';
function SegTabs({ tabs, active, onSelect }: { tabs: { key: BattleTab; label: string; badge?: number }[]; active: BattleTab; onSelect: (k: BattleTab) => void }) {
  return (
    <div style={{ display: 'flex', background: 'rgba(23,32,70,0.06)', borderRadius: 12, padding: 3, gap: 2, marginBottom: 12 }}>
      {tabs.map((t) => (
        <button
          key={t.key}
          onClick={() => onSelect(t.key)}
          style={{
            flex: 1,
            border: 'none',
            padding: '8px 6px',
            borderRadius: 9,
            fontSize: 12.5,
            fontWeight: 700,
            cursor: 'pointer',
            background: active === t.key ? '#fff' : 'transparent',
            color: active === t.key ? 'var(--text)' : 'var(--text-dim)',
            boxShadow: active === t.key ? '0 1px 4px rgba(23,32,70,0.12)' : 'none',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 6,
          }}
        >
          <span>{t.label}</span>
          {typeof t.badge === 'number' && t.badge > 0 && (
            <span style={{ fontSize: 9.5, fontWeight: 800, color: 'var(--accent)', background: 'rgba(47,155,255,0.14)', borderRadius: 999, padding: '1px 6px' }}>
              {t.badge}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

function TimeBar({ end, windowMs, color }: { end: number; windowMs: number; color: string }) {
  const [left, setLeft] = useState(Math.max(0, end - Date.now()));
  useEffect(() => {
    const t = setInterval(() => setLeft(Math.max(0, end - Date.now())), 1000);
    return () => clearInterval(t);
  }, [end]);
  const pct = windowMs > 0 ? Math.max(0, Math.min(1, left / windowMs)) : 0;
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '4px 0 4px' }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text)' }}><Timer size={12} style={{ verticalAlign: -1 }} /> {fmtLeft(left)} left</span>
      </div>
      <div style={{ height: 5, background: 'rgba(23,32,70,0.08)', borderRadius: 99, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${pct * 100}%`, background: color, borderRadius: 99, transition: 'width 1s linear' }} />
      </div>
    </div>
  );
}

function InfoTip({ children, icon }: { children: React.ReactNode; icon?: React.ReactNode }) {
  return (
    <div style={{ fontSize: 10.5, color: 'var(--text-dim)', background: 'rgba(47,155,255,0.07)', border: '1px solid rgba(47,155,255,0.2)', borderRadius: 10, padding: '7px 9px', marginTop: 10, lineHeight: 1.5 }}>
      {icon && <span style={{ marginRight: 5, verticalAlign: -2 }}>{icon}</span>}
      {children}
    </div>
  );
}

function DrawingStage({ battle, getStrokes, onSubmit }: { battle: CompetitionDetail; getStrokes: () => Stroke[]; onSubmit: () => void }) {
  const api = useApi();
  const submitted = Boolean(battle.entries?.find((e) => String(e.groupId) === String(battle.myGroup))?.submittedAt);

  useEffect(() => {
    if (Date.now() >= battle.drawEndTime) return;
    const timer = setInterval(async () => {
      if (Date.now() >= battle.drawEndTime) return;
      try {
        await api.post(`/api/competitions/${battle.id}`, { action: 'sync', strokes: getStrokes() });
      } catch {
        /* ignore sync errors */
      }
    }, AUTO_SYNC_MS);
    return () => clearInterval(timer);
  }, [api, battle.id, battle.drawEndTime, getStrokes]);

  if (!battle.myGroup) return null;

  return (
    <div style={{ marginTop: 10 }}>
      <div style={{ border: '1px solid var(--chip-border)', borderRadius: 12, padding: 12, background: '#fff' }}>
        {submitted ? (
          <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--kid-green)', display: 'flex', alignItems: 'center', gap: 6 }}>
            <Check size={16} /> Entry submitted — good luck!
          </div>
        ) : (
          <>
            <div style={{ fontSize: 13, fontWeight: 800 }}><Sparkles size={14} style={{ color: 'var(--kid-yellow)', verticalAlign: -2 }} /> Drawing window open</div>
            <TimeBar end={battle.drawEndTime} windowMs={DRAW_WINDOW_MS} color="var(--accent)" />
            <button className="gbtn" style={{ width: '100%', justifyContent: 'center', marginTop: 10, background: 'var(--kid-green)', color: '#fff', fontWeight: 800 }} onClick={onSubmit}>
              <Send size={14} /> Submit my group's entry
            </button>
          </>
        )}
      </div>
      <InfoTip icon={<Sparkles size={11} />}>
        Draw the prompt on your main canvas — strokes auto-sync to the battle every ~5s. Press <b>Submit</b> when your team is happy; your entry locks once submitted (or when time runs out). Everyone in both groups draws the same prompt.
      </InfoTip>
    </div>
  );
}

function VotingStage({ battle, onVoted }: { battle: CompetitionDetail; onVoted: () => void }) {
  const api = useApi();
  const entries = battle.entries || [];

  async function vote(groupId: string) {
    try {
      await api.post(`/api/competitions/${battle.id}`, { action: 'vote', groupId });
      onVoted();
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Vote failed');
    }
  }

  const total = (battle.votes?.A || 0) + (battle.votes?.B || 0);
  const voteCard = (e: Entry, isA: boolean) => {
    const votes = isA ? battle.votes?.A || 0 : battle.votes?.B || 0;
    const pct = total ? Math.round((votes / total) * 100) : 0;
    return (
      <div key={e.groupId} style={{ textAlign: 'center' }}>
        <EntryCanvas strokes={e.strokes} />
        <div style={{ fontSize: 12, fontWeight: 800, margin: '6px 0 2px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 160 }}>
          {isA ? battle.groupA.name : battle.groupB.name}
        </div>
        <div style={{ fontSize: 10.5, color: 'var(--text-dim)', marginBottom: 4 }}>
          {votes} vote{votes === 1 ? '' : 's'} · {pct}%
        </div>
        <div style={{ height: 4, background: 'rgba(23,32,70,0.08)', borderRadius: 99, overflow: 'hidden', marginBottom: 8 }}>
          <div style={{ height: '100%', width: `${pct}%`, background: 'var(--accent2)', borderRadius: 99 }} />
        </div>
        {!battle.hasVoted ? (
          <button className="gbtn" style={{ width: '100%', justifyContent: 'center', background: 'var(--accent2)', color: '#fff', fontWeight: 700 }} onClick={() => vote(e.groupId)}>
            <Vote size={13} /> Vote {isA ? 'A' : 'B'}
          </button>
        ) : (
          <div style={{ fontSize: 11, color: 'var(--kid-green)', fontWeight: 700 }}><Check size={12} /> Vote locked in</div>
        )}
      </div>
    );
  };

  return (
    <div style={{ marginTop: 10 }}>
      <div style={{ border: '1px solid var(--chip-border)', borderRadius: 12, padding: 12, background: '#fff' }}>
        <div style={{ fontSize: 13, fontWeight: 800 }}>
          <Vote size={14} style={{ color: 'var(--accent2)', verticalAlign: -2 }} /> Voting is open
        </div>
        <TimeBar end={battle.voteEndTime} windowMs={battle.voteEndTime - battle.drawEndTime} color="var(--accent2)" />
        <div className="flex gap-2 mt-3 justify-center" style={{ gap: 10 }}>
          {entries.map((e) => voteCard(e, String(e.groupId) === String(battle.groupA.id)))}
        </div>
      </div>
      <InfoTip icon={<Vote size={11} />}>
        One vote per person. Pick the drawing you like most — when voting closes the winning group is decided automatically and its group card gets a tally.
      </InfoTip>
    </div>
  );
}

function ClosedStage({ battle }: { battle: CompetitionDetail }) {
  const entries = battle.entries || [];
  return (
    <div style={{ marginTop: 10 }}>
      <div style={{ border: '1px solid var(--chip-border)', borderRadius: 12, padding: 14, background: '#fff', textAlign: 'center' }}>
        <div style={{ fontSize: 15, fontWeight: 800 }}>
          <Trophy size={17} style={{ color: 'var(--kid-yellow)', verticalAlign: -3 }} />
          {battle.winner ? `${battle.winner.name} wins!` : "It's a tie!"}
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 3 }}>
          {battle.groupA.name} {battle.votes?.A || 0} · {battle.groupB.name} {battle.votes?.B || 0} votes
        </div>
      </div>
      <div className="flex gap-2 mt-3 justify-center" style={{ gap: 10 }}>
        {entries.map((e) => {
          const isA = String(e.groupId) === String(battle.groupA.id);
          return (
            <div key={e.groupId} style={{ textAlign: 'center' }}>
              <EntryCanvas strokes={e.strokes} />
              <div style={{ fontSize: 12, fontWeight: 800, margin: '6px 0 2px' }}>{isA ? battle.groupA.name : battle.groupB.name}</div>
              <div style={{ fontSize: 10.5, color: 'var(--text-dim)' }}>{isA ? battle.votes?.A || 0 : battle.votes?.B || 0} votes</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function BattleView({ id, getStrokes, onBack }: { id: string; getStrokes: () => Stroke[]; onBack: () => void }) {
  const api = useApi();
  const [battle, setBattle] = useState<CompetitionDetail | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const d = await api.get(`/api/competitions/${id}`);
      setBattle(d);
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load battle.');
    }
  }, [api, id]);

  useEffect(() => {
    load();
    const poll = setInterval(load, POLL_MS);
    return () => clearInterval(poll);
  }, [load]);

  if (!battle) {
    return (
      <div>
        {error ? (
          <div style={{ background: 'rgba(235,87,138,0.08)', border: '1px solid rgba(235,87,138,0.3)', borderRadius: 10, padding: 10, fontSize: 11.5, color: 'var(--kid-pink)', marginTop: 8 }}>
            <AlertCircle size={13} style={{ verticalAlign: -2 }} /> {error}
            <button className="gbtn" style={{ width: '100%', justifyContent: 'center', marginTop: 8 }} onClick={load}>Retry</button>
          </div>
        ) : (
          <div className="stat-row" style={{ marginTop: 8 }}>Loading battle… <RefreshCw size={12} /></div>
        )}
      </div>
    );
  }

  return (
    <div style={{ marginTop: 8 }}>
      <div className="gbtn" style={{ width: 'auto', padding: '5px 10px', marginBottom: 8 }} onClick={onBack}>← Back to battles</div>

      <div style={{ border: '1px solid var(--chip-border)', borderRadius: 12, padding: 12, background: '#fff' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <div style={{ fontSize: 13, fontWeight: 800, lineHeight: 1.35 }}>“{battle.prompt}”</div>
          <StatusPill status={battle.status} />
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 6 }}>
          {battle.groupA.emoji} {battle.groupA.name} <b style={{ color: 'var(--text)' }}>vs</b> {battle.groupB.emoji} {battle.groupB.name}
        </div>
      </div>

      {battle.status === 'drawing' && <DrawingStage battle={battle} getStrokes={getStrokes} onSubmit={load} />}
      {battle.status === 'voting' && <VotingStage battle={battle} onVoted={load} />}
      {battle.status === 'closed' && <ClosedStage battle={battle} />}
    </div>
  );
}

export default function CompetitionsModal({ onClose, sourceGroup, getStrokes, canBattle = true }: Props) {
  const api = useApi();
  const [active, setActive] = useState<CompetitionSummary[]>([]);
  const [recent, setRecent] = useState<CompetitionSummary[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [tab, setTab] = useState<'live' | 'create' | 'results'>('live');
  const [openId, setOpenId] = useState<string | null>(null);
  const [srcId, setSrcId] = useState('');
  const [tgtId, setTgtId] = useState('');
  const [prompt, setPrompt] = useState(BATTLE_PROMPTS[0]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    try {
      const d = await api.get('/api/competitions');
      setActive(d.active || []);
      setRecent(d.recent || []);
      const g = await api.get('/api/groups');
      setGroups(g.groups || []);
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load battles.');
    } finally {
      setLoaded(true);
    }
  }, [api]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (sourceGroup?.id) {
      setTab('create');
      setSrcId(sourceGroup.id);
    } else if (groups.length && !srcId) {
      setSrcId(groups[0].id);
    }
  }, [sourceGroup, groups]); // eslint-disable-line react-hooks/exhaustive-deps

  function randomPrompt() {
    setPrompt(BATTLE_PROMPTS[Math.floor(Math.random() * BATTLE_PROMPTS.length)]);
  }

  async function createBattle() {
    setError('');
    if (!srcId || !tgtId) return setError('Pick your group and a challenger to start.');
    setBusy(true);
    try {
      const d = await api.post('/api/competitions', { sourceGroupId: srcId, targetGroupId: tgtId, prompt });
      setTab('live');
      setOpenId(d.id);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create battle.');
    } finally {
      setBusy(false);
    }
  }

  if (openId) {
    return (
      <div className="modal-overlay" style={{ zIndex: 90 }}>
        <div className="modal-box" style={{ width: 380, maxWidth: '94vw' }}>
          <div className="close-btn" onClick={() => setOpenId(null)} title="Back"><X size={16} /></div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <div style={{ width: 30, height: 30, borderRadius: 8, background: 'var(--accent)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Swords size={16} />
            </div>
            <h3 style={{ margin: 0 }}>Battle</h3>
          </div>
          <BattleView id={openId} getStrokes={getStrokes} onBack={() => setOpenId(null)} />
        </div>
      </div>
    );
  }

  const selectStyle: CSSProperties = { width: '100%' };

  return (
    <div className="modal-overlay" style={{ zIndex: 90 }}>
      <div className="modal-box" style={{ width: 400, maxWidth: '94vw' }}>
        <div className="close-btn" onClick={onClose} title="Close"><X size={16} /></div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
          <div style={{ width: 30, height: 30, borderRadius: 8, background: 'var(--accent)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Swords size={16} />
          </div>
          <h3 style={{ margin: 0 }}>Battles</h3>
        </div>
        <div style={{ fontSize: 10.5, color: 'var(--text-dim)', marginBottom: 10 }}>
          Your groups duel on the same prompt — then everyone votes.
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 4 }}>
          <div className="gmini" title="Refresh" onClick={() => { setLoaded(false); void load(); }}><RefreshCw size={13} /></div>
        </div>

        <SegTabs
          tabs={[
            { key: 'live', label: 'Live', badge: active.length },
            { key: 'create', label: 'New Battle' },
            { key: 'results', label: 'Results' },
          ]}
          active={tab}
          onSelect={setTab}
        />

        {error && (
          <div style={{ background: 'rgba(235,87,138,0.08)', border: '1px solid rgba(235,87,138,0.3)', borderRadius: 10, padding: 9, fontSize: 11.5, color: 'var(--kid-pink)', marginBottom: 8 }}>
            <AlertCircle size={13} style={{ verticalAlign: -2 }} /> {error}
            <button className="gbtn" style={{ width: '100%', justifyContent: 'center', marginTop: 7 }} onClick={() => { setLoaded(false); void load(); }}>Retry</button>
          </div>
        )}

        {tab === 'live' && (
          <>
            {!loaded && <div className="stat-row">Loading battles…</div>}
            <div style={{ maxHeight: 300, overflowY: 'auto' }}>
              {active.map((b) => {
                const m = STATUS_META[b.status];
                const remaining = b.status === 'voting' ? b.voteEndTime - Date.now() : b.drawEndTime - Date.now();
                return (
                  <div
                    key={b.id}
                    onClick={() => setOpenId(b.id)}
                    style={{ border: '1px solid var(--chip-border)', borderRadius: 12, padding: 10, marginBottom: 8, background: '#fff', cursor: 'pointer' }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 800, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {b.groupA.emoji} {b.groupA.name} <span style={{ color: 'var(--text-dim)', fontWeight: 600 }}>vs</span> {b.groupB.emoji} {b.groupB.name}
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          “{b.prompt}”
                        </div>
                        {b.myGroup && (
                          <div style={{ fontSize: 9.5, fontWeight: 800, color: 'var(--accent)', background: m.bg, borderRadius: 999, padding: '2px 7px', display: 'inline-block', marginTop: 5 }}>
                            You're in this battle
                          </div>
                        )}
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4, flexShrink: 0 }}>
                        <StatusPill status={b.status} />
                        {b.status !== 'closed' && (
                          <span style={{ fontSize: 10, color: m.color, fontWeight: 700 }}>
                            {remaining > 0 ? `${fmtLeft(remaining)} left` : 'finalising…'}
                          </span>
                        )}
                        <span style={{ fontSize: 10, color: 'var(--accent)', fontWeight: 800 }}>View battle <ChevronRight size={11} style={{ verticalAlign: -2 }} /></span>
                      </div>
                    </div>
                  </div>
                );
              })}
              {loaded && !active.length && (
                <div style={{ textAlign: 'center', padding: '18px 10px' }}>
                  <div style={{ fontSize: 13, fontWeight: 700 }}>No live battles</div>
                  <div style={{ fontSize: 11, color: 'var(--text-dim)', margin: '4px 0 10px' }}>Challenge another group and the duel shows up here.</div>
                  {canBattle ? (
                    <button className="gbtn" style={{ justifyContent: 'center', background: 'var(--accent)', color: '#fff' }} onClick={() => setTab('create')}>Start your first battle</button>
                  ) : (
                    <div style={{ fontSize: 10.5, color: 'var(--text-dim)' }}>Starting battles is not in your current plan.</div>
                  )}
                </div>
              )}
            </div>
          </>
        )}

        {tab === 'create' && (
          <>
            {!canBattle && (
              <div className="stat-row" style={{ marginBottom: 8, color: 'var(--text-dim)' }}>
                Starting battles is not included on your current plan.
              </div>
            )}

            <div style={{ display: 'flex', gap: 6, marginBottom: 10, flexWrap: 'wrap' }}>
              {[
                { n: 1, t: 'Pick your group' },
                { n: 2, t: 'Pick a rival' },
                { n: 3, t: 'Set prompt' },
                { n: 4, t: 'Start' },
              ].map((s, i, arr) => (
                <div key={s.n} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 9.5, fontWeight: 700, color: 'var(--text-dim)' }}>
                  <span style={{ width: 16, height: 16, borderRadius: 99, background: i === 0 && tab === 'create' ? 'var(--accent)' : 'rgba(23,32,70,0.08)', color: i === 0 ? '#fff' : 'var(--text-dim)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 9 }}>
                    {s.n}
                  </span>
                  {s.t}
                  {i < arr.length - 1 && <span style={{ width: 10, height: 1, background: 'rgba(23,32,70,0.15)' }} />}
                </div>
              ))}
            </div>

            {!groups.length ? (
              <div style={{ textAlign: 'center', padding: '16px 10px', border: '1px dashed var(--chip-border)', borderRadius: 12 }}>
                <Users size={20} style={{ color: 'var(--text-dim)' }} />
                <div style={{ fontSize: 12.5, fontWeight: 700, margin: '6px 0 2px' }}>You need a group first</div>
                <div style={{ fontSize: 10.5, color: 'var(--text-dim)' }}>
                  Create a group (friend → group → battle) and it will show up here so you can challenge with it.
                </div>
              </div>
            ) : (
              <>
                <div style={{ fontSize: 10.5, color: 'var(--text-dim)', fontWeight: 700, marginBottom: 4, opacity: canBattle ? 1 : 0.5 }}>1 · Your group <span style={{ fontWeight: 400 }}>(the one you draw for)</span></div>
                <select className="field-input" style={selectStyle} value={srcId} onChange={(e) => setSrcId(e.target.value)} disabled={!canBattle}>
                  <option value="">Choose…</option>
                  {groups.map((g) => <option key={g.id} value={g.id}>{g.emoji} {g.name}</option>)}
                </select>

                <div style={{ fontSize: 10.5, color: 'var(--text-dim)', fontWeight: 700, margin: '10px 0 4px', opacity: canBattle ? 1 : 0.5 }}>2 · Challenger <span style={{ fontWeight: 400 }}>(another group you're in)</span></div>
                <select className="field-input" style={selectStyle} value={tgtId} onChange={(e) => setTgtId(e.target.value)} disabled={!canBattle}>
                  <option value="">Choose…</option>
                  {groups.filter((g) => g.id !== srcId).map((g) => <option key={g.id} value={g.id}>{g.emoji} {g.name}</option>)}
                </select>
                {groups.length > 1 ? (
                  <div style={{ fontSize: 9.5, color: 'var(--text-dim)', marginTop: 3 }}>You can only challenge groups you're a member of.</div>
                ) : (
                  <div style={{ fontSize: 9.5, color: 'var(--text-dim)', marginTop: 3 }}>You're in only one group — join or create another to challenge.</div>
                )}

                <div style={{ fontSize: 10.5, color: 'var(--text-dim)', fontWeight: 700, margin: '10px 0 4px', opacity: canBattle ? 1 : 0.5 }}>3 · Battle prompt <span style={{ fontWeight: 400 }}>(same prompt for both groups)</span></div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <input className="field-input" value={prompt} onChange={(e) => setPrompt(e.target.value)} autoComplete="off" disabled={!canBattle} />
                  <div className="gmini" title="Random prompt" onClick={canBattle ? randomPrompt : undefined}><RefreshCw size={14} /></div>
                </div>

                <button className="gbtn" style={{ width: '100%', justifyContent: 'center', marginTop: 12, background: 'var(--accent)', color: '#fff', fontWeight: 800 }} onClick={createBattle} disabled={busy || !canBattle}>
                  {busy ? 'Starting…' : '⚡ Start battle'}
                </button>
              </>
            )}

            <InfoTip icon={<Swords size={11} />}>
              <b>How battles work:</b> both groups get the same prompt and <b>5 minutes</b> to draw it (entries auto-sync). Then <b>3 minutes</b> of voting — one vote each. Winner is decided automatically and shown here + in results.
            </InfoTip>
          </>
        )}

        {tab === 'results' && (
          <div style={{ maxHeight: 300, overflowY: 'auto' }}>
            {recent.map((b) => (
              <div
                key={b.id}
                onClick={() => setOpenId(b.id)}
                style={{ border: '1px solid var(--chip-border)', borderRadius: 12, padding: 10, marginBottom: 8, background: '#fff', cursor: 'pointer' }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {b.groupA.emoji} {b.groupA.name} <span style={{ color: 'var(--text-dim)' }}>vs</span> {b.groupB.emoji} {b.groupB.name}
                    </div>
                    <div style={{ fontSize: 10.5, color: 'var(--text-dim)', marginTop: 2 }}>{b.votes ? `${b.votes.A} · ${b.votes.B} votes` : ''}</div>
                  </div>
                  <span style={{ fontSize: 11, color: 'var(--kid-green)', fontWeight: 800, flexShrink: 0 }}>
                    {b.winner ? `${b.winner.emoji} ${b.winner.name} 🏆` : 'Tie'}
                  </span>
                </div>
              </div>
            ))}
            {loaded && !recent.length && <div className="stat-row">No finished battles yet.</div>}
          </div>
        )}
      </div>
    </div>
  );
}