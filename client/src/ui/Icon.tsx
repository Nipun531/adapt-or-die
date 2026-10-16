/**
 * Authored SVG icon set (one stroke/fill language). Suits stand for stats everywhere:
 * ♥ heart = HP, ♠ spade = STR, ♦ diamond = DEF, ♣ club = DEX. Red suits print red, black suits print ink.
 */
import type { StatKey } from '../api';

const PATHS = {
  heart: 'M12 21s-8.5-5.4-8.5-11.2A4.6 4.6 0 0 1 12 7.1a4.6 4.6 0 0 1 8.5 2.7C20.5 15.6 12 21 12 21z',
  spade: 'M12 2.5C9.2 6.3 3.8 9.2 3.8 13.4a4.1 4.1 0 0 0 7.1 2.8c-.2 2.1-1 3.9-2.6 5.3h7.4c-1.6-1.4-2.4-3.2-2.6-5.3a4.1 4.1 0 0 0 7.1-2.8C20.2 9.2 14.8 6.3 12 2.5z',
  diamond: 'M12 2.2l7.4 9.8L12 21.8 4.6 12z',
  club: 'M12 2.8a3.9 3.9 0 0 0-3.6 5.4 3.9 3.9 0 1 0 2.6 6.6c-.2 2.6-1 4.6-2.7 6.7h7.4c-1.7-2.1-2.5-4.1-2.7-6.7a3.9 3.9 0 1 0 2.6-6.6A3.9 3.9 0 0 0 12 2.8z',
} as const;

export type Suit = keyof typeof PATHS;
export const SUIT_OF: Record<StatKey, Suit> = { hp: 'heart', str: 'spade', def: 'diamond', dex: 'club' };
export const STAT_LABEL: Record<StatKey, string> = { hp: 'HP', str: 'STR', def: 'DEF', dex: 'DEX' };

export function SuitIcon({ suit, size = 16, title }: { suit: Suit; size?: number; title?: string }) {
  const red = suit === 'heart' || suit === 'diamond';
  return (
    <svg className={`suit ${red ? 'suit-red' : 'suit-ink'}`} width={size} height={size} viewBox="0 0 24 24" aria-hidden={title ? undefined : true} role={title ? 'img' : undefined}>
      {title && <title>{title}</title>}
      <path d={PATHS[suit]} fill="currentColor" />
    </svg>
  );
}

/** Stat pip: suit + label (label kept for the first read and for screen readers). */
export function StatPip({ stat, size = 16, hideLabel = false }: { stat: StatKey; size?: number; hideLabel?: boolean }) {
  return (
    <span className="pip">
      <SuitIcon suit={SUIT_OF[stat]} size={size} />
      <span className={hideLabel ? 'visually-hidden' : 'pip-label'}>{STAT_LABEL[stat]}</span>
    </span>
  );
}

const UI = {
  chevron: 'M6 9l6 6 6-6',
  close: 'M6 6l12 12M18 6L6 18',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  alert: 'M12 4l9 16H3zM12 10v4M12 17.5v.5',
  play: 'M8 5l11 7-11 7z',
  arrow: 'M5 12h14M13 6l6 6-6 6',
  crown: 'M3 8l4.5 4L12 5l4.5 7L21 8l-2 10H5z',
  undo: 'M9 14L4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3',
} as const;
export type UiIcon = keyof typeof UI;

export function Icon({ name, size = 18 }: { name: UiIcon; size?: number }) {
  const filled = name === 'play' || name === 'crown';
  return (
    <svg className="icon" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true"
      fill={filled ? 'currentColor' : 'none'} stroke={filled ? 'none' : 'currentColor'} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d={UI[name]} />
    </svg>
  );
}
