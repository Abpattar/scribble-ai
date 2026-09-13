import { motion } from 'framer-motion';
import { SignIn } from '@clerk/clerk-react';
import AnimatedShaderBackground from './Animatedshaderbackground';

const clerkAppearance = {
  variables: {
    colorPrimary: '#ff6b4a',
    colorBackground: 'transparent',
    colorInputBackground: 'rgba(23,32,70,0.05)',
    colorInputText: '#1c2440',
    colorText: '#1c2440',
    colorTextSecondary: 'rgba(40,52,96,0.55)',
    colorInputBorder: 'rgba(23,32,70,0.12)',
    borderRadius: '14px',
    fontSize: '13.5px',
  },
  elements: {
    rootBox: { width: '100%' },
    card: { background: 'transparent', boxShadow: 'none', width: '100%' },
    formButtonPrimary: {
      background: '#ff6b4a',
      fontWeight: 700,
    },
    socialButtonsBlockButton: { background: '#fff', fontWeight: 700, border: '1px solid rgba(23,32,70,0.1)' },
    socialButtonsBlockButtonText: { color: '#1c2440' },
    footerActionLink: { color: '#ff6b4a' },
    footerActionText: { color: 'rgba(40,52,96,0.55)' },
  },
};

export default function LoginScreen() {
  return (
    <div className="absolute inset-0 z-[60] overflow-hidden flex items-center justify-center">
      <AnimatedShaderBackground className="opacity-90" />
      <div className="pointer-events-none absolute inset-0 bg-black/10" />

      <div className="relative z-10 w-full max-w-4xl px-6 md:px-10 py-8 grid md:grid-cols-[1fr_1fr] gap-10 items-center">
        <div className="flex flex-col items-center md:items-start text-center md:text-left">
          <motion.div
            initial={{ opacity: 0, scale: 0.7 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ type: 'spring', stiffness: 200, damping: 12 }}
            className="w-20 h-20 rounded-[22px] flex items-center justify-center text-4xl mb-6"
            style={{ background: 'var(--kid-blue)', boxShadow: '0 12px 26px -12px rgba(var(--kid-blue-rgb),0.5)' }}
          >
            ✏️
          </motion.div>

          <motion.h1
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15, duration: 0.5 }}
            className="font-display text-[clamp(2rem,4.6vw,3.2rem)] leading-tight text-[#1c2440]"
          >
            Scribble <span style={{ color: 'var(--accent)' }}>Air</span> Draw
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3, duration: 0.5 }}
            className="mt-4 max-w-sm text-[14.5px] leading-relaxed text-[#1c2440]/60"
          >
            Wave your hand in the air and watch your drawing come to life. No crayons needed.
          </motion.p>

          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.5, duration: 0.5 }}
            className="mt-6 flex flex-col gap-2 text-[12.5px] text-[#1c2440]/55 font-medium"
          >
            <span>👉 Point your finger to draw</span>
            <span>✌️ Show a peace sign to move around</span>
          </motion.div>
        </div>

        <motion.div
          initial={{ opacity: 0, y: 20, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ delay: 0.2, duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
          className="auth-card w-full"
        >
          <SignIn routing="virtual" appearance={clerkAppearance} />
        </motion.div>
      </div>
    </div>
  );
}