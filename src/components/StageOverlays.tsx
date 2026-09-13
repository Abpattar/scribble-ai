import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

export function NicknameScreen({ onContinue }: { onContinue: (nickname: string) => Promise<void> }) {
  const [nickname, setNickname] = useState('');
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);

  async function go() {
    if (!nickname.trim()) {
      setStatus('Please enter a nickname.');
      return;
    }
    setBusy(true);
    setStatus('Saving…');
    await onContinue(nickname.trim());
    setBusy(false);
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="absolute inset-0 z-[62] bg-[#f2f5ff] flex flex-col items-center justify-center gap-5 px-6"
    >
      <div className="font-display italic text-3xl text-[#1c2440]">One more thing</div>
      <div className="text-[13px] text-[#1c2440]/55 text-center max-w-xs leading-relaxed">
        What should we call you? This is shown instead of your email around the app.
      </div>
      <input
        className="auth-input max-w-[220px] text-center"
        placeholder="Nickname"
        maxLength={24}
        autoComplete="off"
        value={nickname}
        onChange={(e) => setNickname(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && go()}
      />
      <button className="auth-submit max-w-[220px]" onClick={go} disabled={busy}>
        Continue
      </button>
      <div className="text-[11px] text-[#1c2440]/40 min-h-[14px]">{status}</div>
    </motion.div>
  );
}

export function WelcomeScreen({
  nickname,
  isNew,
  onContinue,
}: {
  nickname: string | null;
  isNew: boolean;
  onContinue: () => void;
}) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="absolute inset-0 z-[62] bg-[#f2f5ff] flex flex-col items-center justify-center gap-5 px-6"
    >
      <div className="font-display italic text-3xl text-center text-[#ff6b4a]">
        Welcome to Scribble Air Draw{nickname ? `, ${nickname}` : ''}!
      </div>
      <div className="text-[13px] text-[#1c2440]/55 text-center max-w-xs">
        {isNew
          ? "Your account is set up — let's get drawing in the air."
          : 'Great to see you again — your drawings are right where you left them.'}
      </div>
      <button className="auth-submit max-w-[220px]" onClick={onContinue}>
        Let's Draw ✨
      </button>
    </motion.div>
  );
}

export function LoadOverlay({ pct, msg }: { pct: number; msg: string }) {
  return (
    <AnimatePresence>
      <motion.div
        exit={{ opacity: 0 }}
        transition={{ duration: 0.6 }}
        className="absolute inset-0 z-50 bg-[#e9eeff] flex flex-col items-center justify-center gap-[18px]"
      >
        <div className="w-[42px] h-[42px] rounded-full border-[3px] border-[#1c2440]/10 border-t-[#ff6b4a] animate-spin" />
        <div className="font-display italic text-2xl text-[#ff6b4a]" style={{ textShadow: '0 0 30px rgba(255,107,74,0.35)' }}>
          Scribble Air Draw
        </div>
        <div className="w-[200px] h-[4px] bg-[#1c2440]/10 rounded overflow-hidden">
          <motion.div
            className="h-full rounded bg-[#7c5cf6]"
            style={{ boxShadow: '0 0 8px rgba(124,92,246,0.5)' }}
            animate={{ width: pct + '%' }}
            transition={{ duration: 0.4 }}
          />
        </div>
        <div className="text-[12px] text-[#1c2440]/50 tracking-wide text-center max-w-[280px]">{msg}</div>
      </motion.div>
    </AnimatePresence>
  );
}