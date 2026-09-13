// Shared constants for group battles (mirrored server-side in
// api/lib/battle.js — keep both copies in sync).

export const DRAW_WINDOW_MS = 5 * 60 * 1000;
export const VOTE_WINDOW_MS = 3 * 60 * 1000;

export const BATTLE_PROMPTS = [
  'Draw a dragon made of clouds',
  'Draw a carnival in space',
  'Draw a friendly alien café',
  'Draw a city inside a bubble',
  "Draw a robot's best friend",
  'Draw a flying pizza delivery',
  'Draw an underwater sky',
  'Draw a house built from books',
  'Draw a superpowered snack',
  "Draw the rainbow's source",
  'Draw a time-traveling bus',
  'Draw a garden of talking plants',
  'Draw a castle on a comet',
  'Draw a giant friendly whale in the sky',
  'Draw a portal to your dream world',
];

// Emoji avatars users + groups can pick.
export const AVATARS = ['🦊', '🐼', '🦄', '🐸', '🐙', '🐯', '🐨', '🐝', '🦋', '🚀', '🎨', '🌟', '🌈', '🍉', '⚡', '😎'];

export type CompetitionStatus = 'drawing' | 'voting' | 'closed';

export function competitionStatus<T extends { drawEndTime: number; voteEndTime: number }>(
  c: T
): CompetitionStatus {
  const now = Date.now();
  if (now < c.drawEndTime) return 'drawing';
  if (now < c.voteEndTime) return 'voting';
  return 'closed';
}