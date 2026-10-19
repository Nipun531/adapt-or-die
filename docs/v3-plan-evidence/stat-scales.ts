import { playInMemoryRun, summarizeRuns } from '../../server/src/sim/balance.ts';
import { STRATEGY_NAMES } from '../../server/src/sim/agents.ts';
const q = (xs: number[], p: number) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
const strategies = [...STRATEGY_NAMES, 'mirror'];
const results = strategies.flatMap((st) => Array.from({ length: 20 }, (_, i) => playInMemoryRun(st, `v3plan:${st}:${i}`, 10)));
const buckets: Record<string, { dex: number[]; netDef: number[]; rawDef: number[]; atk: number[]; hp: number[]; dd: number[]; hits: number[]; mit: number[] }> = {};
for (const r of results) for (const rd of r.rounds) {
  const b = rd.roundNumber <= 2 ? '1-2' : rd.roundNumber <= 5 ? '3-5' : '6-10';
  const B = (buckets[b] ??= { dex: [], netDef: [], rawDef: [], atk: [], hp: [], dd: [], hits: [], mit: [] });
  const ev = rd.events; if (!ev.length) continue;
  B.hits.push(ev.length);
  const seen = new Set<string>();
  for (const e of ev) {
    B.mit.push(e.calc.mitigation);
    if (!seen.has(e.attacker)) { seen.add(e.attacker); B.dex.push(e.calc.attackerDex); B.atk.push(e.calc.attackValueSource === 'netAtk' ? e.calc.attackValue : NaN); }
    if (!seen.has('d' + e.defender)) { seen.add('d' + e.defender); B.netDef.push(e.calc.defenderNetDef); }
  }
  B.dd.push(Math.abs(ev[0].calc.attackerDex - ev[0].calc.defenderDex));
}
for (const [b, B] of Object.entries(buckets).sort()) {
  const f = (xs: number[]) => { const v = xs.filter((x) => !Number.isNaN(x)); return `p10 ${q(v, 0.1).toFixed(1)} p50 ${q(v, 0.5).toFixed(1)} p90 ${q(v, 0.9).toFixed(1)} max ${Math.max(...v).toFixed(1)}`; };
  console.log(`rounds ${b}: effDex ${f(B.dex)} | netDef ${f(B.netDef)} | netAtk ${f(B.atk)} | |dexDelta| ${f(B.dd)} | attacks/round ${f(B.hits)} | mitigation ${f(B.mit)}`);
}
const dmg = results.flatMap((r) => r.rounds.flatMap((rd) => rd.events.map((e) => e.damage)));
console.log('damage per hit', q(dmg, 0.1).toFixed(1), q(dmg, 0.5).toFixed(1), q(dmg, 0.9).toFixed(1));
for (const s of summarizeRuns(results)) console.log(JSON.stringify(s));
