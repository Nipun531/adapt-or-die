/**
 * Authored SVG icon set — one 24-grid, 1.75 stroke, round joins. Stat glyphs stand for stats everywhere:
 * heart = HP, sword = STR (attack), shield = DEF (defence), feather = DEX (speed); plus vial (stim) and star (stun).
 */
import type { StatKey } from '../api';

const GLYPHS = {
  heart: 'M12 20s-7.5-4.8-7.5-10.1A4.2 4.2 0 0 1 12 7.3a4.2 4.2 0 0 1 7.5 2.6C19.5 15.2 12 20 12 20z',
  sword: 'M14.5 4.5H19.5V9.5L9.5 19.5 4.5 14.5zM7 17l-3 3M8.5 12.5l3 3',
  shield: 'M12 3.5l7 2.5v5.5c0 4.4-3 7.8-7 9-4-1.2-7-4.6-7-9V6z',
  feather: 'M19.5 4.5c-6 .5-11 4.5-12.5 11L5 20M9 15.5h5.5M11 12h5.5c1.6-2.4 2.7-4.8 3-7.5',
  vial: 'M9.5 3.5h5M10.5 3.5v5L6 17.5a2.3 2.3 0 0 0 2 3.3h8a2.3 2.3 0 0 0 2-3.3L13.5 8.5v-5M7.8 14h8.4',
  star: 'M12 3.5l2.4 5.6 6 .5-4.6 4 1.4 5.9L12 16.4l-5.2 3.1 1.4-5.9-4.6-4 6-.5z',
  bow: 'M7 3.5c7 2.5 9.5 6 9.5 8.5S14 18 7 20.5M7 3.5v17M4 12h14.5M16 9.5l2.5 2.5-2.5 2.5',
  armour: 'M8 4l4 2 4-2 4 3-2 4v9H6v-9L4 7zM12 6v14M6 11h12',
} as const;
export type Glyph = keyof typeof GLYPHS;
export const GLYPH_OF: Record<StatKey, Glyph> = { hp: 'heart', str: 'sword', def: 'shield', dex: 'feather' };
/** Plain-language stat names (the server's Net ATK / Net DEF / effective DEX are Attack / Defence / Speed in the UI). */
export const STAT_LABEL: Record<StatKey, string> = { hp: 'HP', str: 'STR', def: 'DEF', dex: 'DEX' };
export const STAT_MEANING: Record<StatKey, string> = {
  hp: 'Health: how much damage you can take',
  str: 'Strength: melee damage',
  def: 'Defence: less damage taken, better blocks',
  dex: 'Speed: acts first, dodges, ranged damage',
};

export function GlyphIcon({ glyph, size = 16, title }: { glyph: Glyph; size?: number; title?: string }) {
  return (
    <svg className={`glyph glyph-${glyph}`} width={size} height={size} viewBox="0 0 24 24" aria-hidden={title ? undefined : true} role={title ? 'img' : undefined}
      fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
      {title && <title>{title}</title>}
      <path d={GLYPHS[glyph]} />
    </svg>
  );
}

/** Stat pip: glyph + label (the label stays for the first read and for screen readers). */
export function StatPip({ stat, size = 16, hideLabel = false }: { stat: StatKey; size?: number; hideLabel?: boolean }) {
  return (
    <span className={`pip pip-${stat}`} title={STAT_MEANING[stat]}>
      <GlyphIcon glyph={GLYPH_OF[stat]} size={size} />
      <span className={hideLabel ? 'visually-hidden' : 'pip-label'}>{STAT_LABEL[stat]}</span>
    </span>
  );
}

const UI = {
  chevron: 'M6 9l6 6 6-6',
  close: 'M6 6l12 12M18 6L6 18',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  alert: 'M12 4l9 16H3zM12 10v4M12 17.5v.5',
  arrow: 'M5 12h14M13 6l6 6-6 6',
  undo: 'M9 14L4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3',
  book: 'M5 4.5h5.5a2 2 0 0 1 1.5.7 2 2 0 0 1 1.5-.7H19v14h-5.5a2 2 0 0 0-1.5.7 2 2 0 0 0-1.5-.7H5zM12 5.2v14.2',
  lancet: 'M12 3c3.6 2.4 5.5 5.6 5.5 9.5V21h-11v-8.5C6.5 8.6 8.4 5.4 12 3zM12 3v18M6.5 13h11',
  crown: 'M4 8l4 3.5L12 5l4 6.5L20 8l-1.5 10h-13z',
} as const;
export type UiIcon = keyof typeof UI;

export function Icon({ name, size = 18 }: { name: UiIcon; size?: number }) {
  return (
    <svg className="icon" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true"
      fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
      <path d={UI[name]} />
    </svg>
  );
}
