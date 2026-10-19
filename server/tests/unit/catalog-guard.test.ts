/**
 * AC-CAT-2: item ids and costs live in the catalogue, not scattered through the code.
 * Allowed exceptions: the catalogues themselves, tests, the scripted simulation agents, the balance harness and the V3 mechanics lab
 * (their wishlists ARE item choices), and the frozen policy-v1 rollback path in boss/policy.ts (buildScenarios).
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ITEMS, ITEMS_V1 } from '../../src/game/catalog.js';

const ROOTS = [path.resolve(__dirname, '../../src'), path.resolve(__dirname, '../../../client/src')];
const ALLOWED = [/[\\/]catalogs[\\/]/, /\.test\.tsx?$/, /[\\/]sim[\\/]agents\.ts$/, /[\\/]sim[\\/]balance(-cli)?\.ts$/, /[\\/]sim[\\/]v3-lab(-cli)?\.ts$/];
const V1_ROLLBACK = /[\\/]boss[\\/]policy\.ts$/;
const FAMILY_WORDS = new Set(['bow', 'shield', 'armour']); // also family names, allowed as such

function files(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? files(p) : /\.tsx?$/.test(e.name) ? [p] : [];
  });
}

describe('catalogue guard', () => {
  it('no item id literals outside the catalogue (except the documented exceptions)', () => {
    const ids = [...new Set([...ITEMS, ...ITEMS_V1].map((i) => i.id))].filter((id) => !FAMILY_WORDS.has(id));
    const hits: string[] = [];
    for (const f of ROOTS.flatMap(files)) {
      if (ALLOWED.some((r) => r.test(f))) continue;
      const src = fs.readFileSync(f, 'utf8');
      for (const id of ids) if (src.includes(`'${id}'`) && !(V1_ROLLBACK.test(f) && id === 'sword')) hits.push(`${path.basename(f)}: '${id}'`);
      if (!V1_ROLLBACK.test(f) && /\b(hand1|ranged):\s*'bow'/.test(src)) hits.push(`${path.basename(f)}: 'bow' as an item`);
    }
    expect(hits).toEqual([]);
  });
});
