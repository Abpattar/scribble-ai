import { useCallback, useEffect, useRef, useState } from 'react';
import { X, Swords, Timer, Trophy, Vote, Check, RefreshCw } from 'lucide-react';
import { useApi } from '../hooks/useApi';
import type { Stroke } from '../lib/engine';
import { renderStrokesToCanvas } from '../lib/strokeRenderer';
import { BATTLE_PROMPTS } from '../lib/battle';

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

function EntryCanvas({ strokes, height = 120 }: { strokes: Stroke[]; height?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (ref.current) renderStrokesToCanvas(ref.current, strokes || []);
  }, [strokes]);
  return <canvas ref={ref} width={160} height={height} style={{ width: 160, height, borderRadius: 8, border: '1px solid var(--chip-border)', background: '#fff' }} />;
}

function fmtLeft(ms: number) {
  if (ms <= 0) return '0:00';
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

const AUTO_SYNC_MS = 5000;

function DrawingStage({ battle, getStrokes, onSubmit }: { battle: CompetitionDetail; getStrokes: () => Stroke[]; onSubmit: () => void }) {
  const api = useApi();
  const [left, setLeft] = useState(Math.max(0, battle.drawEndTime - Date.now()));
  const submitted = Boolean(battle.entries?.find((e) => e.groupId === battle.myGroup)?.submittedAt);

  useEffect(() => {
    const t = setInterval(() => setLeft(Math.max(0, battle.drawEndTime - Date.now())), 1000);
    return () => clearInterval(t);
  }, [battle.drawEndTime]);

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
    <div className="stat-row" style={{ marginTop: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 700, color: submitted ? 'var(--kid-green)' : 'var(--accent)' }}>
        <Timer size={14} /> {submitted ? 'Entry submitted — good luck!' : `Time left: ${fmtLeft(left)}`}
      </div>
      {!submitted && (
        <button className="gbtn" style={{ width: '100%', justifyContent: 'center', marginTop: 8, background: 'var(--accent)', color: '#fff' }} onClick={onSubmit}>
          Submit my group's entry
        </button>
      )}
      <div style={{ fontSize: 10.5, color: 'var(--text-dim)', marginTop: 6 }}>
        Keep drawing on your canvas — strokes auto-sync every ~5s. Once submitted (or when time ends) your entry locks.
      </div>
    </div>
  );
}

function VotingStage({ battle, onVoted }: { battle: CompetitionDetail; onVoted: () => void }) {
  const api = useApi();
  const [left, setLeft] = useState(Math.max(0, battle.voteEndTime - Date.now()));
  const entries = battle.entries || [];

  useEffect(() => {
    const t = setInterval(() => setLeft(Math.max(0, battle.voteEndTime - Date.now())), 1000);
    return () => clearInterval(t);
  }, [battle.voteEndTime]);

  async function vote(groupId: string) {
    try {
      await api.post(`/api/competitions/${battle.id}`, { action: 'vote', groupId });
      onVoted();
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Vote failed');
    }
  }

  const total = (battle.votes?.A || 0) + (battle.votes?.B || 0);

  return (
    <div className="stat-row" style={{ marginTop: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 700, color: 'var(--accent2)' }}>
        <Vote size={14} /> Voting closes in {fmtLeft(left)}
      </div>
      <div className="flex gap-2 mt-3 justify-center">
        {entries.map((e) => {
          const isA = e.groupId === battle.groupA.id;
          const votes = isA ? battle.votes?.A || 0 : battle.votes?.B || 0;
          const pct = total ? Math.round((votes / total) * 100) : 0;
          return (
            <div key={e.groupId} style={{ textAlign: 'center', width: 160 }}>
              <EntryCanvas strokes={e.strokes} />
              <div style={{ fontSize: 11.5, fontWeight: 700, margin: '4px 0' }}>{isA ? battle.groupA.name : battle.groupB.name}</div>
              <div style={{ fontSize: 10, color: 'var(--text-dim)', marginBottom: 4 }}>{votes} vote{votes === 1 ? '' : 's'} ({pct}%)</div>
              {!battle.hasVoted ? (
                <button className="gbtn" style={{ width: '100%', justifyContent: 'center', background: 'var(--accent2)', color: '#fff' }} onClick={() => vote(e.groupId)}>
                  Vote
                </button>
              ) : (
                <div style={{ fontSize: 11, color: 'var(--kid-green)' }}><Check size={12} /> voted</div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ClosedStage({ battle }: { battle: CompetitionDetail }) {
  const entries = battle.entries || [];
  return (
    <div className="stat-row" style={{ marginTop: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 800 }}>
        <Trophy size={16} style={{ color: 'var(--kid-yellow)' }} />
        {battle.winner ? `${battle.winner.name} wins!` : "It's a tie!"}
      </div>
      <div className="flex gap-2 mt-3 justify-center">
        {entries.map((e) => {
          const isA = e.groupId === battle.groupA.id;
          const votes = isA ? battle.votes?.A || 0 : battle.votes?.B || 0;
          return (
            <div key={e.groupId} style={{ textAlign: 'center', width: 160 }}>
              <EntryCanvas strokes={e.strokes} />
              <div style={{ fontSize: 11.5, fontWeight: 700, margin: '4px 0' }}>{isA ? battle.groupA.name : battle.groupB.name}</div>
              <div style={{ fontSize: 10, color: 'var(--text-dim)' }}>{votes} votes</div>
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
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load battle.');
    }
  }, [api, id]);

  useEffect(() => {
    load();
    const poll = setInterval(load, 8000);
    return () => clearInterval(poll);
  }, [load]);

  if (error) return <div className="stat-row" style={{ marginTop: 8 }}>{error}</div>;
  if (!battle) return <div className="stat-row" style={{ marginTop: 8 }}>Loading battle…</div>;

  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ fontSize: 12.5, color: 'var(--text)' }}><b>🧨 {battle.prompt}</b></div>
      <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 2 }}>
        {battle.groupA.emoji} {battle.groupA.name} <b>vs</b> {battle.groupB.emoji} {battle.groupB.name}
      </div>

      {battle.status === 'drawing' && <DrawingStage battle={battle} getStrokes={getStrokes} onSubmit={load} />}
      {battle.status === 'voting' && <VotingStage battle={battle} onVoted={load} />}
      {battle.status === 'closed' && <ClosedStage battle={battle} />}

      <div className="gbtn" style={{ marginTop: 10, justifyContent: 'center' }} onClick={onBack}>← Back to battles</div>
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

  const load = useCallback(async () => {
    try {
      const d = await api.get('/api/competitions');
      setActive(d.active || []);
      setRecent(d.recent || []);
      const g = await api.get('/api/groups');
      setGroups(g.groups || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load battles.');
    }
  }, [api]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (sourceGroup?.id) {
      setTab('create');
      setSrcId(sourceGroup.id);
    } else if (groups.length) {
      setSrcId(groups[0].id);
    }
  }, [sourceGroup, groups]);

  function randomPrompt() {
    setPrompt(BATTLE_PROMPTS[Math.floor(Math.random() * BATTLE_PROMPTS.length)]);
  }

  async function createBattle() {
    setError('');
    if (!srcId || !tgtId) return setError('Pick the two groups.');
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
        <div className="modal-box" style={{ width: 360, maxWidth: '92vw' }}>
          <div className="close-btn" onClick={() => setOpenId(null)} title="Back"><X size={16} /></div>
          <h3>Battle</h3>
          <BattleView id={openId} getStrokes={getStrokes} onBack={() => setOpenId(null)} />
        </div>
      </div>
    );
  }

  const battleable = groups;

  return (
    <div className="modal-overlay" style={{ zIndex: 90 }}>
      <div className="modal-box" style={{ width: 380, maxWidth: '94vw' }}>
        <div className="close-btn" onClick={onClose} title="Close"><X size={16} /></div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
          <div style={{ width: 30, height: 30, borderRadius: 8, background: 'var(--accent)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Swords size={16} />
          </div>
          <h3 style={{ margin: 0 }}>Battles</h3>
        </div>

        <div className="flex gap-1.5 mb-2">
          {(['live', 'create', 'results'] as const).map((t) => (
            <div key={t} className="gbtn" style={{ flex: 1, justifyContent: 'center', textTransform: 'capitalize' }} onClick={() => setTab(t)}>
              {t === 'live' && active.length ? `live (${active.length})` : t}
            </div>
          ))}
        </div>

        {tab === 'create' && (
          <>
            {!canBattle && (
              <div className="stat-row" style={{ marginBottom: 8, color: 'var(--text-dim)' }}>
                Starting battles is not included on your current plan.
              </div>
            )}
            <div style={{ fontSize: 10.5, color: 'var(--text-dim)', fontWeight: 600, marginTop: 4, opacity: canBattle ? 1 : 0.5 }}>Your group</div>
            <select className="field-input" value={srcId} onChange={(e) => setSrcId(e.target.value)} disabled={!canBattle}>
              <option value="">Choose…</option>
              {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
            <div style={{ fontSize: 10.5, color: 'var(--text-dim)', fontWeight: 600, marginTop: 8, opacity: canBattle ? 1 : 0.5 }}>Challenge group</div>
            <select className="field-input" value={tgtId} onChange={(e) => setTgtId(e.target.value)} disabled={!canBattle}>
              <option value="">Choose…</option>
              {battleable.filter((g) => g.id !== srcId).map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
            <div style={{ fontSize: 10.5, color: 'var(--text-dim)', fontWeight: 600, marginTop: 8, opacity: canBattle ? 1 : 0.5 }}>Prompt</div>
            <div style={{ display: 'flex', gap: 6 }}>
              <input className="field-input" value={prompt} onChange={(e) => setPrompt(e.target.value)} autoComplete="off" disabled={!canBattle} />
              <div className="gmini" title="Random prompt" onClick={canBattle ? randomPrompt : undefined}><RefreshCw size={14} /></div>
            </div>
            <button className="gbtn" style={{ width: '100%', justifyContent: 'center', marginTop: 10, background: 'var(--accent)', color: '#fff' }} onClick={createBattle} disabled={busy || !canBattle}>
              {busy ? 'Starting…' : 'Start battle'}
            </button>
            <div style={{ fontSize: 10.5, color: 'var(--text-dim)', marginTop: 8 }}>
              Both groups draw the same prompt on their own canvas for 5 minutes. Then everyone votes — winner hits the leaderboard.
            </div>
          </>
        )}

        {tab === 'live' && (
          <div style={{ maxHeight: 300, overflowY: 'auto' }}>
            {active.map((b) => (
              <div key={b.id} className="gbtn" style={{ justifyContent: 'space-between', marginBottom: 6 }} onClick={() => setOpenId(b.id)}>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {b.groupA.emoji} {b.groupA.name} <b>vs</b> {b.groupB.emoji} {b.groupB.name}
                </span>
                <span style={{ fontSize: 10, color: b.status === 'voting' ? 'var(--accent2)' : 'var(--accent)', flexShrink: 0 }}>
                  {b.status}
                </span>
              </div>
            ))}
            {!active.length && <div className="stat-row">No battles happening right now. Start one!</div>}
          </div>
        )}

        {tab === 'results' && (
          <div style={{ maxHeight: 300, overflowY: 'auto' }}>
            {recent.map((b) => (
              <div key={b.id} className="gbtn" style={{ justifyContent: 'space-between', marginBottom: 6 }} onClick={() => setOpenId(b.id)}>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 12 }}>
                  {b.groupA.name} vs {b.groupB.name}
                </span>
                <span style={{ fontSize: 10.5, color: 'var(--kid-green)', flexShrink: 0 }}>
                  {b.winner ? `${b.winner.name} 🏆` : 'Tie'}
                </span>
              </div>
            ))}
            {!recent.length && <div className="stat-row">No finished battles yet.</div>}
          </div>
        )}

        {error && <div style={{ fontSize: 11, color: 'var(--kid-pink)', marginTop: 8 }}>{error}</div>}
      </div>
    </div>
  );
}