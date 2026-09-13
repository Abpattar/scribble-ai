import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import type { Stroke } from '../lib/engine';
import type { HistorySnap } from '../hooks/useProfile';

export function StatsModal({
  onClose,
  currentName,
  strokes,
  drawStartTime,
  totalDrawings,
}: {
  onClose: () => void;
  currentName: string;
  strokes: Stroke[];
  drawStartTime: number;
  totalDrawings: number;
}) {
  const counts: Record<string, number> = {};
  let totalPts = 0;
  const colorsUsed = new Set<string>();
  strokes.forEach((s) => {
    counts[s.type || 'freehand'] = (counts[s.type || 'freehand'] || 0) + 1;
    totalPts += (s.pts || []).length;
    colorsUsed.add(s.col ? `${s.col.r},${s.col.g},${s.col.b}` : '');
  });
  const minutes = Math.max(1, Math.round((Date.now() - drawStartTime) / 60000));
  const rows: [string, string | number][] = [
    ['Drawing', currentName],
    ['Total strokes', strokes.length],
    ['Freehand', counts.freehand || 0],
    ['Lines', counts.line || 0],
    ['Circles', counts.circle || 0],
    ['Rectangles', counts.rect || 0],
    ['Colours used', colorsUsed.size],
    ['Points drawn', totalPts],
    ['Session time', minutes + ' min'],
    ['Total drawings', totalDrawings],
  ];
  return (
    <div className="modal-overlay">
      <div className="modal-box">
        <div className="close-btn" onClick={onClose} title="Close"><X size={16} /></div>
        <h3>Drawing Statistics</h3>
        <div>
          {rows.map(([k, v]) => (
            <div className="stat-row" key={k}>
              <span>{k}</span>
              <b>{v}</b>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function HistoryModal({
  onClose,
  history,
  onRestore,
}: {
  onClose: () => void;
  history: HistorySnap[];
  onRestore: (snap: HistorySnap) => void;
}) {
  return (
    <div className="modal-overlay">
      <div className="modal-box">
        <div className="close-btn" onClick={onClose} title="Close"><X size={16} /></div>
        <h3>Version History</h3>
        <div>
          {!history.length && <div className="stat-row">No saved versions yet</div>}
          {[...history].reverse().map((snap) => (
            <div className="hist-item" key={snap.ts} onClick={() => onRestore(snap)}>
              {new Date(snap.ts).toLocaleString()} — {snap.strokes.length} strokes
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function ProfileModal({
  onClose,
  nickname,
  bio,
  email,
  drawingCount,
  onSave,
}: {
  onClose: () => void;
  nickname: string | null;
  bio: string;
  email: string | null | undefined;
  drawingCount: number;
  onSave: (name: string, bio: string) => Promise<void>;
}) {
  const [name, setName] = useState(nickname || '');
  const [about, setAbout] = useState(bio || '');
  const [status, setStatus] = useState('');
  useEffect(() => {
    setName(nickname || '');
    setAbout(bio || '');
  }, [nickname, bio]);

  async function save() {
    if (!name.trim()) {
      setStatus("Name can't be empty.");
      return;
    }
    setStatus('Saving…');
    try {
      await onSave(name.trim(), about.trim());
      setStatus('Saved ✓');
      setTimeout(() => setStatus((s) => (s === 'Saved ✓' ? '' : s)), 1500);
    } catch {
      setStatus('Save failed — try again.');
    }
  }

  return (
    <div className="modal-overlay">
      <div className="modal-box">
        <div className="close-btn" onClick={onClose} title="Close"><X size={16} /></div>
        <h3>My Profile</h3>
        <div className="profile-field-label">Name</div>
        <input className="auth-input" style={{ fontSize: 12 }} maxLength={24} value={name} onChange={(e) => setName(e.target.value)} />
        <div className="profile-field-label">About you <span style={{ opacity: 0.6 }}>(optional)</span></div>
        <textarea
          className="auth-input"
          style={{ fontSize: 12, resize: 'vertical' }}
          maxLength={200}
          rows={3}
          value={about}
          onChange={(e) => setAbout(e.target.value)}
        />
        <div className="profile-field-label">Email</div>
        <div style={{ fontSize: 11.5, color: 'var(--text-dim)', padding: '4px 2px' }}>{email}</div>
        <div style={{ fontSize: 11.5, color: 'var(--text-dim)', padding: '4px 2px' }}>
          {drawingCount} {drawingCount === 1 ? 'drawing saved to this account' : 'drawings saved to this account'}
        </div>
        <div style={{ fontSize: 11, color: 'var(--kid-green)', marginTop: 4, minHeight: 14 }}>{status}</div>
        <div className="auth-submit mt-2 text-center" onClick={save}>Save Changes</div>
      </div>
    </div>
  );
}
