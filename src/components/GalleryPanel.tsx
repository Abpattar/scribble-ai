import { useState } from 'react';
import {
  Search,
  Star,
  Pencil,
  Copy,
  Trash2,
  Plus,
  Sticker,
  User,
  BarChart3,
  History,
  LogOut,
  Cloud,
  Users,
  Swords,
  CreditCard,
  Shield,
} from 'lucide-react';

interface Props {
  hidden: boolean;
  profileLabel: string;
  names: string[];
  favorites: Record<string, boolean>;
  currentName: string;
  saveStatus: string;
  isPro: boolean;
  showAdmin: boolean;
  friendRequests: number;
  onSwitch: (name: string) => void;
  onToggleFavorite: (name: string) => void;
  onRename: (name: string) => void;
  onDuplicate: (name: string) => void;
  onDelete: (name: string) => void;
  onNew: (name: string) => void;
  onTemplates: () => void;
  onStats: () => void;
  onHistory: () => void;
  onProfile: () => void;
  onFriends: () => void;
  onGroups: () => void;
  onBattles: () => void;
  onPlan: () => void;
  onAdmin: () => void;
  onLogout: () => void;
}

export default function GalleryPanel(p: Props) {
  const [query, setQuery] = useState('');
  const [showSearch, setShowSearch] = useState(false);
  const [newName, setNewName] = useState('');

  const names = p.names
    .filter((n) => n.toLowerCase().includes(query.toLowerCase()))
    .sort((a, b) => (p.favorites[b] ? 1 : 0) - (p.favorites[a] ? 1 : 0));

  return (
    <div className={'gallery-panel' + (p.hidden ? ' hidden' : '')} style={{ display: p.hidden ? 'none' : 'flex' }}>
      <div className="flex items-center justify-between gap-1.5">
        <div className="panel-label text-left" style={{ fontSize: 9 }}>
          Account: <span style={{ color: 'var(--accent)', fontWeight: 600 }}>{p.profileLabel}</span>
        </div>
        <div className="gmini" title="Search drawings" onClick={() => setShowSearch((s) => !s)}>
          <Search size={15} />
        </div>
      </div>
      {showSearch && (
        <input
          className="field-input"
          placeholder="Search drawings…"
          autoComplete="off"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      )}
      <div className="flex flex-col gap-1 max-h-[130px] overflow-y-auto my-1">
        {names.map((name) => (
          <div key={name} className={'gallery-item' + (name === p.currentName ? ' active' : '')}>
            <span
              className={'gmini star' + (p.favorites[name] ? ' fav' : '')}
              title="Favorite"
              onClick={(e) => { e.stopPropagation(); p.onToggleFavorite(name); }}
            >
              <Star size={15} fill={p.favorites[name] ? 'currentColor' : 'none'} />
            </span>
            <span className="gname" onClick={() => p.onSwitch(name)}>{name}</span>
            <span className="gmini" title="Rename" onClick={(e) => { e.stopPropagation(); p.onRename(name); }}>
              <Pencil size={14} />
            </span>
            <span className="gmini" title="Duplicate" onClick={(e) => { e.stopPropagation(); p.onDuplicate(name); }}>
              <Copy size={14} />
            </span>
            <span className="gmini" title="Delete" onClick={(e) => { e.stopPropagation(); p.onDelete(name); }}>
              <Trash2 size={14} />
            </span>
          </div>
        ))}
      </div>
      <input
        className="field-input"
        placeholder="New drawing name"
        autoComplete="off"
        value={newName}
        onChange={(e) => setNewName(e.target.value)}
      />
      <div className="gbtn" onClick={() => { p.onNew(newName); setNewName(''); }}>
        <Plus size={14} style={{ color: 'var(--kid-green)' }} /> New Drawing
      </div>
      <div className="gbtn" onClick={p.onTemplates}>
        <Sticker size={15} style={{ color: 'var(--kid-blue)' }} /> Trace Templates
      </div>
      <div className="gallery-row">
<div className="gbtn" onClick={p.onFriends} style={{ position: 'relative' }}>
            <Users size={15} style={{ color: 'var(--kid-blue)' }} /> Friends
            {p.friendRequests > 0 && (
              <span
                className="friend-badge"
                style={{
                  position: 'absolute',
                  top: -5,
                  right: -5,
                  minWidth: 18,
                  height: 18,
                  borderRadius: 9,
                  background: 'var(--kid-pink)',
                  color: '#fff',
                  fontSize: 10.5,
                  fontWeight: 800,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: '0 4px',
                  pointerEvents: 'none',
                }}
              >
                {p.friendRequests > 9 ? '9+' : p.friendRequests}
              </span>
            )}
          </div>
        <div className="gbtn" onClick={p.onPlan}>
          <CreditCard size={15} style={{ color: 'var(--kid-yellow)' }} /> {p.isPro ? 'Pro ✓' : 'My Plan'}
        </div>
      </div>
      <div className="gallery-row">
        <div className="gbtn" onClick={p.onGroups}>
          <Users size={15} style={{ color: 'var(--kid-green)' }} /> Groups
        </div>
        <div className="gbtn" onClick={p.onBattles}>
          <Swords size={15} style={{ color: 'var(--accent)' }} /> Battles
        </div>
      </div>
      <div className="gbtn" onClick={p.onProfile}>
        <User size={15} style={{ color: 'var(--kid-pink)' }} /> My Profile
      </div>
      {p.showAdmin && (
        <div className="gbtn" onClick={p.onAdmin}>
          <Shield size={15} style={{ color: 'var(--accent2)' }} /> Admin Panel
        </div>
      )}
      <div className="gallery-row">
        <div className="gbtn" onClick={p.onStats}>
          <BarChart3 size={15} style={{ color: 'var(--kid-yellow)' }} /> Stats
        </div>
        <div className="gbtn" onClick={p.onHistory}>
          <History size={15} style={{ color: 'var(--accent2)' }} /> History
        </div>
      </div>
      <div className="gbtn" onClick={p.onLogout}>
        <LogOut size={15} /> Log Out
      </div>
      <div style={{ fontSize: 10, color: 'var(--kid-green)', height: 12, textAlign: 'center' }}>{p.saveStatus}</div>
      <div style={{ fontSize: 8.5, color: 'var(--text-dim)', textAlign: 'center', lineHeight: 1.3, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
        <Cloud size={11} /> Saved to your account — log in anywhere to access it
      </div>
    </div>
  );
}