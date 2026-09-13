import { motion } from 'framer-motion';
import { Hand, Cloud, Sticker, Play, History, Palette, Check, Minus } from 'lucide-react';
import AnimatedShaderBackground from './Animatedshaderbackground';
import { DEFAULT_FREE_PLAN, DEFAULT_PLAN_PAYLOAD, FEATURE_CATALOG, galleryLabel } from '../lib/plans';

interface Props {
  onGetStarted: () => void;
}

const STEPS = [
  { emoji: '👉', title: 'Point to draw', text: 'Point your finger at the screen and trace your drawing in the air.' },
  { emoji: '✌️', title: 'Peace sign to move', text: 'Hold up two fingers to pan and move your drawing around.' },
  { emoji: '🖼️', title: 'Save & revisit', text: 'Every drawing is saved to your account so you always come back to it.' },
];

const FEATURES = [
  { Icon: Hand, title: 'Draw in the air', text: 'No mouse, no stylus — just your hand and your imagination.', bg: 'var(--kid-blue)' },
  { Icon: Cloud, title: 'Auto-save to you', text: 'Log in anywhere and all your drawings are right where you left them.', bg: 'var(--kid-green)' },
  { Icon: Sticker, title: 'Trace templates', text: 'Pick an outline — planets, fruit, cartoons — and colour it in by tracing.', bg: 'var(--kid-pink)' },
  { Icon: Play, title: 'Replay your art', text: 'Watch your masterpiece replay stroke by stroke, ready to share.', bg: 'var(--accent)' },
  { Icon: History, title: 'Version history', text: 'Saved checkpoints let you hop back to any earlier version.', bg: 'var(--accent2)' },
  { Icon: Palette, title: 'Bright & kid-friendly', text: 'Big buttons, fun colours, one-tap controls — no confusing menus.', bg: 'var(--kid-yellow)' },
];

const fadeUp = {
  initial: { opacity: 0, y: 16 },
  animate: { opacity: 1, y: 0 },
};

export default function LandingScreen({ onGetStarted }: Props) {
  return (
    <div className="absolute inset-0 z-[70] overflow-y-auto bg-[var(--bg)]">
      {/* ── hero ── */}
      <section className="relative min-h-[92vh] flex items-center justify-center overflow-hidden py-14">
        <AnimatedShaderBackground className="opacity-70" />
        <div className="pointer-events-none absolute inset-0 bg-white/25" />

        <div className="relative z-10 flex flex-col items-center text-center px-6 max-w-2xl">
          <motion.div
            initial={{ opacity: 0, scale: 0.7, y: -10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            transition={{ type: 'spring', stiffness: 200, damping: 14 }}
            className="w-24 h-24 rounded-[26px] flex items-center justify-center text-5xl mb-8"
            style={{ background: 'var(--kid-blue)', boxShadow: '0 14px 30px -10px rgba(var(--kid-blue-rgb),0.5)' }}
          >
            ✏️
          </motion.div>

          <motion.h1
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15, duration: 0.5 }}
            className="font-display text-[clamp(2.4rem,6vw,3.6rem)] leading-tight text-[#1c2440]"
          >
            Scribble <span style={{ color: 'var(--accent)' }}>Air</span> Draw
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3, duration: 0.5 }}
            className="mt-5 text-[16px] leading-relaxed text-[#1c2440]/60 max-w-xl"
          >
            Wave your hand in the air and watch your drawing come to life — no crayons, no mess,
            just your webcam and your imagination.
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.45, duration: 0.5 }}
            className="mt-9 w-full max-w-lg"
          >
            <button className="landing-cta" onClick={onGetStarted}>
              Get Started 🚀
            </button>
          </motion.div>
        </div>
      </section>

      {/* ── how it works ── */}
      <section className="px-6 py-20 bg-[var(--bg)]">
        <div className="max-w-5xl mx-auto">
          <motion.h2
            {...fadeUp}
            transition={{ duration: 0.5 }}
            className="text-center font-display text-3xl text-[#1c2440]"
          >
            How it works
          </motion.h2>
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.15, duration: 0.5 }}
            className="text-center text-[13.5px] text-[#1c2440]/55 mt-2"
          >
            Three simple hand signs — that's it.
          </motion.p>

          <div className="grid md:grid-cols-3 gap-6 mt-12">
            {STEPS.map((s, i) => (
              <motion.div
                key={s.title}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.1 + i * 0.12, duration: 0.5 }}
                className="bg-white rounded-3xl border border-[rgba(23,32,70,0.1)] p-8 flex flex-col items-center text-center"
                style={{ boxShadow: '0 18px 40px -24px rgba(23,32,70,0.35)' }}
              >
                <div className="text-5xl mb-5 select-none">{s.emoji}</div>
                <div className="text-[15px] font-semibold text-[#1c2440]">{s.title}</div>
                <div className="text-[13px] text-[#1c2440]/55 mt-2 leading-relaxed">{s.text}</div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ── features ── */}
      <section className="px-6 pb-20 bg-[var(--bg)]">
        <div className="max-w-5xl mx-auto">
          <motion.h2
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5 }}
            className="text-center font-display text-3xl text-[#1c2440]"
          >
            Made for little artists
          </motion.h2>
          <motion.p
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            viewport={{ once: true }}
            transition={{ delay: 0.15, duration: 0.5 }}
            className="text-center text-[13.5px] text-[#1c2440]/55 mt-2"
          >
            Everything is big, bright and easy to use.
          </motion.p>

          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6 mt-12">
            {FEATURES.map((f, i) => (
              <motion.div
                key={f.title}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: (i % 3) * 0.1, duration: 0.5 }}
                className="bg-white rounded-3xl border border-[rgba(23,32,70,0.1)] p-8"
                style={{ boxShadow: '0 18px 40px -24px rgba(23,32,70,0.35)' }}
              >
                <div
                  className="w-12 h-12 rounded-2xl flex items-center justify-center mb-5 text-white"
                  style={{ background: f.bg }}
                >
                  <f.Icon size={22} />
                </div>
                <div className="text-[15px] font-semibold text-[#1c2440]">{f.title}</div>
                <div className="text-[13px] text-[#1c2440]/55 mt-2 leading-relaxed">{f.text}</div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ── pricing / plans ── */}
      <section className="px-6 pb-20 bg-[var(--bg)]">
        <div className="max-w-5xl mx-auto">
          <motion.h2
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5 }}
            className="text-center font-display text-3xl text-[#1c2440]"
          >
            Simple plans, no surprises
          </motion.h2>
          <motion.p
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            viewport={{ once: true }}
            transition={{ delay: 0.15, duration: 0.5 }}
            className="text-center text-[13.5px] text-[#1c2440]/55 mt-2"
          >
            Start free on the Free plan — upgrade any time to unlock every feature.
          </motion.p>

          <div className="grid md:grid-cols-3 gap-5 mt-12 items-stretch">
            {[DEFAULT_FREE_PLAN, ...DEFAULT_PLAN_PAYLOAD.plans].map((plan, i) => (
              <motion.div
                key={plan.id}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.1, duration: 0.5 }}
                className="bg-white rounded-3xl border border-[rgba(23,32,70,0.1)] p-7 flex flex-col"
                style={{ boxShadow: '0 18px 40px -24px rgba(23,32,70,0.35)' }}
              >
                <div className="flex items-center justify-between">
                  <div className="text-[15px] font-semibold text-[#1c2440]">{plan.label}</div>
                  {plan.free && (
                    <span className="text-[9px] px-2 py-0.5 rounded-full text-white font-bold" style={{ background: 'var(--kid-green)' }}>
                      FREE
                    </span>
                  )}
                </div>

                <div className="mt-3 mb-1">
                  <span className="text-[30px] font-extrabold text-[#1c2440]">₹{plan.amount}</span>
                  <span className="text-[12px] text-[#1c2440]/50 ml-1">/ {plan.id === 'monthly' ? 'month' : 'year'}</span>
                </div>
                <div className="text-[11.5px] text-[#1c2440]/55 mb-4">{plan.description}</div>

                <div className="flex flex-col gap-2 mb-5">
                  {FEATURE_CATALOG.map((f) => {
                    const on = plan.features[f.key];
                    return (
                      <div key={f.key} className="flex items-center gap-2.5 text-[12.5px]" style={{ color: on ? '#1c2440' : '#1c244055' }}>
                        {on ? (
                          <Check size={15} style={{ color: 'var(--kid-green)', flexShrink: 0 }} />
                        ) : (
                          <Minus size={15} style={{ color: '#1c244022', flexShrink: 0 }} />
                        )}
                        <span style={{ textDecoration: on ? 'none' : 'line-through' }}>{f.label}</span>
                      </div>
                    );
                  })}
                  <div className="flex items-center gap-2.5 text-[12.5px]" style={{ color: plan.galleryLimit === -1 ? '#1c2440' : '#1c244055' }}>
                    {plan.galleryLimit === -1 ? (
                      <Check size={15} style={{ color: 'var(--kid-green)', flexShrink: 0 }} />
                    ) : (
                      <Minus size={15} style={{ color: '#1c244022', flexShrink: 0 }} />
                    )}
                    <span style={{ textDecoration: plan.galleryLimit === -1 ? 'none' : 'line-through' }}>{galleryLabel(plan.galleryLimit)}</span>
                  </div>
                </div>

                <button
                  className="mt-auto py-3 rounded-2xl text-[13.5px] font-semibold transition-transform hover:scale-[1.02] active:scale-[0.98]"
                  style={{
                    background: plan.free ? 'rgba(47,155,255,0.14)' : 'var(--accent)',
                    color: plan.free ? '#2f9bff' : '#fff',
                    border: plan.free ? '1.5px solid rgba(47,155,255,0.5)' : '1.5px solid transparent',
                  }}
                  onClick={onGetStarted}
                >
                  {plan.free ? 'Start free' : 'Get Pro'}
                </button>
              </motion.div>
            ))}
          </div>

          <motion.p
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5 }}
            className="text-center text-[11.5px] text-[#1c2440]/45 mt-6"
          >
            Cancel anytime · Paid securely via Razorpay · Plans rights-manageable by the admin.
          </motion.p>
        </div>
      </section>

      {/* ── CTA banner ── */}
      <section className="px-6 pb-20 bg-[var(--bg)]">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
          className="max-w-5xl mx-auto rounded-[32px] px-8 py-16 text-center"
          style={{ background: 'var(--kid-green)', boxShadow: '0 20px 50px -20px rgba(var(--kid-green-rgb),0.55)' }}
        >
          <div className="font-display text-3xl text-white">Ready to start drawing?</div>
          <div className="text-[14px] text-white/85 mt-3 max-w-md mx-auto leading-relaxed">
            Grab your webcam and get drawing — it's free, safe and mess-free fun for kids.
          </div>
          <button className="landing-cta on-dark mt-8" onClick={onGetStarted}>
            Get Started 🚀
          </button>
        </motion.div>
      </section>
    </div>
  );
}