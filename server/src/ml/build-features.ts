/**
 * NEXT-BUILD TASK FEATURES (V4, schema `v4b1`). The V3 feature vector (ml/features.ts, rounds 1..N only) plus what
 * the player chose before, per head: last round's class (one-hot) and the Laplace frequency of each class over the
 * run so far. The persistence baseline's information is therefore available to the model, which must beat it.
 * Leakage boundary unchanged: `records` and `historyHeads` cover rounds 1..N; the label is round N+1's heads.
 */
import { HEAD_CLASSES, HEAD_NAMES, type Heads } from '../boss/build-heads.js';
import { buildFeatures, FEATURE_NAMES, type RoundRecord } from './features.js';

export const BUILD_FEATURE_SCHEMA = 'v4b1';
export const BUILD_FEATURE_NAMES: string[] = [
  ...FEATURE_NAMES,
  ...HEAD_NAMES.flatMap((h) => HEAD_CLASSES[h].flatMap((c) => [`last_${h}_${c}`, `freq_${h}_${c}`])),
];

export function buildTaskFeatures(records: RoundRecord[], historyHeads: Heads[], engineVersion?: string | null): Record<string, number | null> {
  const base = buildFeatures(records, engineVersion) as Record<string, number | null>;
  const out: Record<string, number | null> = { ...base };
  const last = historyHeads[historyHeads.length - 1] ?? null;
  for (const h of HEAD_NAMES) {
    const k = HEAD_CLASSES[h].length;
    for (const c of HEAD_CLASSES[h]) {
      out[`last_${h}_${c}`] = last ? (last[h] === c ? 1 : 0) : null;
      out[`freq_${h}_${c}`] = (historyHeads.filter((x) => x[h] === c).length + 1) / (historyHeads.length + k);
    }
  }
  return out;
}
