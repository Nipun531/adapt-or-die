# The Boss Remembers — Version 3 Implementation Plan (Phase 1: audit + plan)

**Status (2026-10-19): V3 in progress (Phases A, B and C1 part 1 done).** The owner answered §I on 2026-10-19; the answers and their exact formulas are in **`docs/V3_DEMANDS.md`**, which supersedes the recommendations in §I where they differ. Q-1…Q-4 were answered as well, so no blocking decision is open. **Phase A DONE 2026-10-19** (`docs/V3_BASELINE.md`). **Phase B DONE 2026-10-19** (engine behind RuleSet v3; notes in V3_DEMANDS §11). **Phase C1 part 1 2026-10-19:** stun/dodge sweet spot tuned with the mechanics lab (`docs/V3_BALANCE.md`). **Phase C1 DONE 2026-10-20:** turn limit, the boss and agents under V3, paired V2/V3 runs, symmetric mirror, DEX ablation (`docs/V3_BALANCE.md` §7–§9). **Phase C2 DONE 2026-10-20:** engine 3.0.0 live (V3 catalogue, 10 gold, stims, migration 003, API, minimal client prompts, live = harness parity test). Next: Phase D.
Design input: `context/The_Boss_Remembers_V3_Combat_Redesign_Plan_1.3.docx` (found in the repo, read in full; 148 text blocks, 3 tables).
Its "Plan 1.3" text is quoted as **[DOC]**. Code observations are **[CODE]**, measured numbers **[DATA]**, my proposals **[REC]**, and open owner decisions **[DECIDE D-n]**.

Session safety: no production code, balance values, migrations, datasets or models were changed. Read-only work only:
- read-only SQL (`SET default_transaction_read_only = on`) on the dev DB;
- one in-memory harness run (no DB) from a scratch script;
- two isolated Impeccable critique reviews (design review + detector).

---

## A. Executive summary

**Where the game is.** Engine 2.0.0 and boss policy `v2-diverse` are live. Combat is a simple loop:
- An attack hits automatically.
- Damage = `A²/(A+DEF)`, then DEX mitigation.
- DEX also decides turn order, the First Shot and bonus attacks.

There is no defensive decision, no stun, no healing and no consumables. The only in-fight player choice is Ranged vs Melee, and only when holding a bow and a melee weapon.

**Why V3 is needed — the evidence.**

Boss win rate, engine 2.0.0 [DATA]:

| Opponent | Source | Boss wins |
|---|---|---|
| All 11 scripted agents | dev DB, 8,600 simulated rounds | **99.8%** (lowest single agent 97.9%) |
| Manual play | dev DB | 9 of 9 rounds |
| All 11 scripted agents | fresh in-memory batch, 20 runs × 10 rounds each | 98.5–100%; **round 1: 100% against every agent** |
| **Mirror** (the player uses the boss's own policy) | same in-memory batch | **59.5%** (round 1: 60%) |

Three things drive the gap:
1. **Fights are short.** Median 4 attacks per round; the median hit takes 23% of max HP.
2. **DEX stacks.** Turn order, the First Shot, bonus attacks and mitigation all go to the faster fighter.
3. **Snowball economy.** The winner earns more XP and gold. By rounds 6–10 the boss's median effective DEX is 38.5 against the player's 16.5.

The boss's Monte-Carlo policy finds the strongest affordable build every round. Scripted agents never adapt.

**This evidence does NOT show the boss is "too smart."** The mirror result says the rules are fairly symmetric: about 60/40, with a residual round-1 edge to investigate. The near-100% result mostly measures:
- agent weakness;
- a thin decision space;
- the snowball.

V3 is the right lever because it adds real decisions: block/dodge, counters, stun and healing. Measurement must separate the three causes above.

**Biggest risks:**
1. **The formula scales do not match the engine's numbers.**
   - "Dodge = 2 × dodge delta" gives 30% at the median DEX gap, 59% at the 90th percentile, and over 100% at the maximum.
   - "Block = 0.5 × DEF" gives 5–48% from Net DEF alone, or about 83% with Great Shield + Heavy Armor. If it uses the raw DEF stat instead, it gives only 5–6.5%.
   - Caps and the DEF definition are blocking decisions.
2. **Stun may be dead or degenerate.**
   - At 10–20 stun per attack and about 2 hits received per round, a fighter rarely reaches 100 in a round.
   - Any carry-over across rounds, or many counters, could instead create stun chains.
3. **Counter rules needed definitions** (now answered, V3_DEMANDS §1, §4).
   - "Attack shaved off" is measured on the hypothetical hit, as if the defender had been hit (owner clarification). It was not a contradiction with all-or-nothing block.
   - A counter is a mini move with the normal attack formula.
4. **Dodge adds a fifth DEX benefit**, on top of the measured V2 problem #1 (DEX dominance).
5. **Defender choices multiply prompts.** One prompt per incoming attack means 3–11 extra clicks per round. The engine must pause on the defender, not just the attacker.
6. **The UI cannot carry V3.**
   - The Impeccable design review scored the current UI 23/40, with Help = 1/4.
   - The fight screen has no live HP or stun state and no "incoming attack" surface.
   - The current visual world ("Court Deck", bright baize and card stock) explicitly refuses the dark-fantasy register you now ask for.

---

## B. Repository audit

Legend: ✅ implemented + verified · 🟡 implemented, test gaps · 🟠 partial · ⬜ not implemented · ❌ broken/inconsistent · ❔ unknown.

| Subsystem | Authoritative files | State | Evidence / notes |
|---|---|---|---|
| Formulas | `server/src/game/formulas.ts`, `constants.ts` | ✅ | Pure functions; constants are centralised. Net ATK = STR·(1+0.25·ΣSTRmods), Net DEF = DEF·(1+0.5·ΣDEFmods), Net DEX = DEX·(1+0.25·ΣDEXmods), effDex ≥ 1. `rules.test.ts` (34 tests). |
| Derived stats | `game/derive.ts` | ✅ | Mods sum over both hands + armour; `attackModes` = ranged/melee/both/unarmed. |
| Combat engine | `game/combat.ts` (409 lines) | ✅ for V2 | Resumable state machine: `CombatState` holds a JSON-serialisable RNG (mulberry32) and a cursor (opening → turns), and pauses via `pending` for the ATTACKER only. No defender decision, no event kinds beyond attacks. `combat.test.ts` (21 tests). |
| Turn order / First Shot / bonus attacks | `combat.ts` `startCombat`, `openingShooters`; `formulas.ts` `dexBonusAttacks` | ✅ | Higher effDex acts first; DEX thresholds 15/30 → +1/+2 attacks every turn; one opening shot, decided by DEX. |
| DEX mitigation | `formulas.ts` | ✅ | Roll 0.20–0.50 × (1 − 1/ratio), clamped at 0. **[DATA]** Non-zero on only 17% of attacks; mean 2.1%. |
| Pierce | `combat.ts resolveAttack`, `catalogs/v2.ts` | ✅ | Chance + DEF ignore on any weapon with a spec. **[DATA]** Pierce is 0.6–3.6% of damage. |
| Catalogue | `game/catalogs/{v1,v2}.ts`, `catalog.ts` | ✅ | Versioned (`catalogFor`). `Item` has only `mods {str,def,dex}` and `pierce`; no block/stun/counter fields. Guard test `catalog-guard.test.ts`. |
| Equipment / economy | `game/equipment.ts`, `progression.ts` | ✅ | Items are owned once (no stacking, no consumables). Rewards: win 50 XP / 10 g, loss 30 XP / 5 g, level-up +20 g. |
| Persistence | `db/migrations/001,002`, `services/{runs,rounds,history}.ts` | ✅ | `combat_events` CHECKs only allow phase ∈ {opening, regular, dex_bonus} and mode ∈ {melee, ranged, unarmed}. `combatants` has no consumable state. `progression_events.kind` CHECK lists the allowed kinds. |
| Round lifecycle / API | `services/rounds.ts`, `api/app.ts` | ✅ | `POST /api/rounds/:id/choice {mode, repeat}`; `pending_choice` = `{side, options, phase, turn}`. Legacy runs are view-only (`assertCurrentEngine`). |
| Boss post-round analysis | `boss/analysis.ts`, `game/summary.ts` | ✅ | Weakness codes (ranged_pressure, pierce_exposure, …). No defence/stun/heal evidence. |
| Boss preparation policy | `boss/policy.ts` (473), `boss/prepare.ts` | ✅ | Enumerates legal plans, scores them against reachable player scenarios with a cheap pre-score, then Monte-Carlo with the real engine. Controlled-diversity band 0.03. |
| Boss in-fight chooser | `policy.ts bossChooser` | ✅ | Ranged/melee by expected damage. 🟠 **Information-symmetry risk [CODE]:** choosers receive the whole `CombatState` (`ctx.state`), including `rngState` (future rolls) and the opponent's `autoMode`. The current boss does not read them, but nothing prevents it. V3 defence choices make this exploitable (§D-E). |
| Sim agents | `sim/agents.ts` | 🟡 | 11 agents, all scripted. Several are reactive (adaptive, opportunist, reactive, switcher), but none search or best-respond. |
| Sim runner (DB) | `sim/runner.ts`, `sim/cli.ts` | ✅ | Appends to the DB through the same services as play. |
| Balance harness (in-memory) | `sim/balance.ts`, `balance-cli.ts` | 🟡 | `playInMemoryRun` re-implements the `rounds.ts` round step by hand. That is a **drift risk** that V3 multiplies. It has a weapon matrix, `withItems`/`withPierce` overrides and a mirror agent. No confidence intervals, no paired seeds across rule variants, no per-stage tables. |
| Boss bench | `boss/bench.ts` | 🟡 | Exists; small. |
| ML features / labels | `ml/features.ts` (schema v3), `examples.ts`, `dataset.ts` | ✅ | Task: P(next round mostly ranged). Leakage test exists. No defence/stun/heal features. |
| ML training / eligibility | `ml/train.py`, `ml/training.ts`, `decision-check.ts`, `predictor.ts` | ✅ | Strict eligibility (held-out, leave-one-strategy-out, ensemble rule, decision-outcome check). Current state: no eligible model, so the boss uses the baseline. Stale active flag on `m20261010-200001-s2`; it falls back automatically. |
| Client duel | `client/src/views/DuelView.tsx`, `duel/{Versus,Armory,Fight,Aftermath,loadout}.tsx`, `ui/*`, `styles/{tokens,base,app}.css`, `api.ts` | ✅ for V2 | Court Deck UI (DESIGN.md). Fight shows a dealt log plus a ChoicePrompt (R/M). No live HP/stun plates, no defence prompt, no supplies UI. |
| Client tests | `client/src/duel/loadout.test.ts` | 🟠 | 5 tests, loadout logic only. No component tests. |
| Docs | `docs/*.md`, `client/PRODUCT.md`, `client/DESIGN.md`, `PROGRESS.md`, `docs/HANDOFF.md` | ✅ | Accurate for V2 (verified in V2 Phase 8). |

**Test baseline [DATA]:** `npm test` 160 server + 5 client pass; typecheck and build are clean (2026-10-17, commit `8ab0229`).

### Measured stat scales (dev DB, engine 2.0.0, 8,609 completed rounds) [DATA]

| Rounds | Side | effDex p10/p50/p90 | raw DEF p50 | Net DEF p10/p50/p90/max | Net ATK p50/p90 | max HP p50 |
|---|---|---|---|---|---|---|
| 1–2 | boss | 10 / 10 / 10 | 10 | 10 / 10 / 15 / 15 | 30 / 52 | 100 |
| 1–2 | player | 10 / 10 / 15 | 10 | 10 / 10 / 12 / 15 | 23 / 29 | 105 |
| 3–5 | boss | 11 / 26 / 32.5 | 11 | 16.5 / 27.5 / 38.5 / 58.5 | 56 / 77 | 105 |
| 3–5 | player | 10 / 15 / 19.5 | 10 | 10 / 15 / 27.5 / 60 | 29 / 50 | 105 |
| 6–10 | boss | 28 / 38.5 / 46.8 | 13 | 19.5 / 32.5 / 42.5 / 60 | 80 / 91 | 115 |
| 6–10 | player | 9 / 16.5 / 28 | 11 | 22 / 27.5 / 40 / 96 | 49 / 77 | 110 |

Other measurements from the same rounds:
- **|effDex difference| per round:** p50 15, p90 29.3, max 51.3. A difference of 15 or more occurs in 51% of rounds.
- **Attacks per round:** mean 4.8, p50 4, p90 11. In the in-memory batch: rounds 1–2 p50 11, rounds 6–10 p50 3.
- **Damage per hit as a share of the defender's max HP:** p50 22.6%, p90 54%.

Reproduce (evidence files in `docs/v3-plan-evidence/`):
- DB numbers: `stat-scales.sql`, run with psql read-only (`SET default_transaction_read_only = on`).
- In-memory numbers: `stat-scales.ts`, run with `npx tsx ../docs/v3-plan-evidence/stat-scales.ts` from `server/` (seed prefix `v3plan`). Output: `stat-scales.output.txt`.

The method is in §H.5. Phase A turns both into a committed script, `npm run v3:baseline`.

---

## C. V3 requirements matrix

Status: **Def** = defined by the doc · **Prov** = defined but provisional values · **Unres** = unresolved in the doc.

### C.1 Combat mechanics

| # | Mechanic | Exact [DOC] rule | Existing code | Change | Tests | Depends on | Status | Decision |
|---|---|---|---|---|---|---|---|---|
| M1 | Attack-then-defend flow | Attacker chooses; defender sees attack/weapon, chooses block or dodge; resolve; fail → existing damage; success → outcome + counter check | `combat.ts advanceCombat` (attacker-only pause), `ChoiceContext` | New attack sub-steps (announce → defence → resolve → counter → stun) in the cursor; `pending` gains `kind` (`attack_mode`/`defense`/`stim`) and can belong to the defender | Step-order unit tests; pause/resume on defender; RNG order snapshot | M2–M6 | Def | D-12 (prompt UX) |
| M2 | Counter timing | Counter resolves immediately after the defence, inside the original attacker's sequence | none | Counter is a child event of the attack; cursor does not advance to the defender's turn | "counter never consumes the defender's turn" test; bonus-attack interplay | M1 | Def | D-10 (can counters be defended/countered?) |
| M3 | Ranged no-counter | Ranged may be blocked or dodged, never countered | mode `ranged` exists | `canCounter = mode !== 'ranged'` (incl. opening shot) | unit + integration | M1 | Def | — |
| M4 | Dodge | Chance = 2 × dodge delta, capped | effDex in `derive.ts` | `dodgeChance(defEffDex, attEffDex)` in a V3 rules module | boundary/cap tests | DEX rules | Prov | **D-2** (delta unit, cap) |
| M5 | Dodge counter | Long weapons with modifier + favourable delta; chance = delta + weapon mod; 75% of final damage; no stun | none (Flail/Spear/Lance/Pike have no field) | `dodgeCounter` field on items; eligibility predicate | eligibility, damage, no-stun | M4, M7 | Prov | D-2, **D-1**, D-10 |
| M6 | Block | Chance = 0.5 × DEF + gear block mods; shields primary, armour small; ranged weapons no bonus; all-or-nothing | `netDef` exists | `blockChance(…)`, `blockBonus` field | stacking, cap, all-or-nothing | catalogue | Prov | **D-3** (raw vs Net DEF, cap) |
| M7 | Block counter | 150% of "final damage", +20 stun; chance from % of the attack shaved off | none | `counterChance(…)`, `counterDamage(…)` | formula tests incl. edge values | M6 | Unres | **D-1**, **D-4** |
| M8 | Heavy-block stun | Blocking a very heavy attack adds stun to the blocker | none | `heavyBlockStun(…)` | threshold tests | M9 | Unres | **D-6** |
| M9 | Stun meter | Both fighters; threshold 100; 10–20 per attack from shaved-off damage, DEX mitigation (0.20–0.50) and weapon stun mods; counter +20; dodge counter 0 | none | `stun` in `CombatState`; `stunGain(…)` | accumulation; per-weapon | M7, catalogue | Unres | **D-5** |
| M10 | Stun trigger | Some weapons/conditions trigger at a full meter; extra damage; stunned fighter misses 1 defensive + 1 attack turn; reset to 0 | none | `canStun` field; skip flags on the fighter; `stun` event | trigger/reset/skip/chain tests | M9 | Unres | **D-5** |
| M11 | Healing stims | Limited uses per round; slots + effectiveness upgradable; no auto-replenish, bought each round; usable before each personal attack round | none (no consumables) | `supplies` on `CombatantState`; `stim` decision before the fighter's turn; heal event | buy/upgrade costs, use, cap at max HP, persistence | economy | Unres | **D-7** |
| M12 | DEX audit | Audit dodge + mitigation + ranged + order + bonus thresholds together | all in `formulas.ts`/`combat.ts` | RuleSet flags so each DEX benefit can be toggled in the harness | ablation runs | M4 | Unres | **D-8** |

### C.2 Catalogue — doc vs live code (all 24 items)

Columns: cost, STR, DEF, DEX, other. "Same" = identical to `catalogs/v2.ts`. New V3 fields are not in the code yet: `blockBonus`, `stunBoost`, `canStun`, `dodgeCounter`.

| Item | [DOC] V3 1.3 | Live V2 code | Discrepancy |
|---|---|---|---|
| Knuckle | 3 · +1 · — · +2 | same | — |
| Knife | 5 · +2 · — · +2 | same | — |
| Sword | 10 · +4 · +1 · — | same | — |
| LongSword | 20 · +7 · +2 · — | same | — |
| Sabre | 20 · +5 · +1 · +2 | same | — |
| GreatSword | 40 · +10 · +3 · −2 | same | — |
| Rapier | 40 · +6 · +1 · +3 · Pierce 5%/70% | same | — |
| Wooden Club | 7 · +3 · +1 · — · Stun Boost +4% | stats same | stun boost missing |
| Iron Club | 15 · +5 · +2 · −1 · Stun Boost +8%, can stun | stats same | stun fields missing |
| Mace | 25 · +8 · +2 · −1 · Stun Boost +12%, can stun | stats same | stun fields missing |
| Flail | 30 · +4 · +1 · — · Pierce **20%/50%**, Dodge Counter +5%, can stun | Pierce **45%/90%** (V2-tuned) | **pierce differs**; counter + stun missing |
| Warhammer | **45** · +12 · +2 · −3 · Stun Boost +20%, can stun | cost **40** | **cost differs**; stun missing |
| Bow | 15 · — · — · +2 · First Shot, Pierce **30%/30%** | Pierce **55%/90%** | **pierce differs** |
| Crossbow | 28 · — · — · +4 · First Shot, Pierce 25%/45% | same | — |
| Longbow | 42 · — · — · +3 · First Shot, Pierce **40%/55%** | Pierce **45%/60%** | **pierce differs** |
| Spear | 15 · +3 · — · +1 · Pierce **10%/25%**, Dodge Counter +10% | Pierce **35%/35%** | **pierce differs**; counter missing |
| Lance | 28 · +5 · — · — · Pierce **20%/35%**, Dodge Counter +20% | Pierce **60%/75%** | **pierce differs**; counter missing |
| Pike | 42 · +7 · — · −1 · Pierce **35%/60%**, Dodge Counter +30% | Pierce **60%/90%** | **pierce differs**; counter missing |
| Leather Armor | 10 · — · +2 · — | same | — |
| Light Armor | 25 · — · +4 · −1 · Block +2% | stats same | block missing |
| Heavy Armor | 45 · — · +8 · −4 · Block +5% | stats same | block missing |
| Wood Shield | 8 · — · +3 · −1 · Block +10% | stats same | block missing |
| Small Shield | 20 · — · +5 · −2 · Block +20% | stats same | block missing |
| Great Shield | 42 · +1 · +8 · −5 · Block +30% | stats same | block missing |

Two findings from this comparison:
- **Pierce.** The doc's pierce values are your **original** V2 values, before the delegated Phase 3 tuning. The live tuned values differ for six weapons: Bow, Longbow, Spear, Lance, Pike and Flail. Which set is the V3 starting point is **D-9**.
- **Warhammer** costs 45 in the doc and 40 in the code. Also **D-9**.

Representation [REC]: add a new frozen `catalogs/v3.ts`, keeping v1 and v2 for history. Extend `Item` with:
```ts
combat?: {
  blockBonus?: number;   // e.g. 0.10
  stunBoost?: number;    // unit per D-5
  canStun?: boolean;
  dodgeCounter?: number; // e.g. 0.10
}
```
Then:
- `catalogFor('3.x')` → v3.
- Extend the guard test.
- Item descriptions for the UI come from these fields, never hand-written.

### C.3 Economy

| # | Rule [DOC] | Code | Change | Status | Decision |
|---|---|---|---|---|---|
| E1 | Buy health stim: 10 gold ("one use or refill all slots?") | none | `buyStim` in `equipment.ts`, `/api/runs/:id/supplies/buy` | Unres | **D-7a** |
| E2 | Upgrade Slots: 25, +5 per upgrade ("one use per upgrade?") | none | `upgradeSlots`; cost = 25 + 5·n | Prov | **D-7b** |
| E3 | Upgrade Effectiveness: 25, +5 per upgrade | none | `upgradeEffectiveness`; heal formula | Prov | **D-7c** |
| E4 | No auto replenish; buy at round start | none | rounds service: stims persist or expire per D-7d | Unres | **D-7d** |
| E5 | Use before each personal attack round; while stunned? | none | `stim` decision at the start of the fighter's action | Unres | **D-7e** |
| E6 | Rewards unchanged (implied) | `constants.ts` | none unless approved | Def (V2) | D-17 |

**[DATA] Income context.** A win pays 10 g and a loss 5 g; a level-up adds 20 g. One stim (10 g) costs a whole win's gold. A losing player (about 90 g over 10 rounds, from V2_DEMANDS §3.3) could fund almost nothing else.

---

## D. Boss difficulty and fairness assessment

### D.1 What the current evidence can and cannot establish

| Question | Current evidence | What it supports | What it cannot support |
|---|---|---|---|
| A. Stronger than the player population? | 97.9–100% vs all 11 scripted agents; 9/9 manual rounds | The boss is far stronger than **scripted, non-searching** players | Anything about humans (9 rounds, 1 player) or about strong adaptive players |
| B. Exploiting rules? | Round 1: 100% vs every agent; mirror round 1: 60%; late-game boss effDex 38.5 vs 16.5 | A systematic early edge plus a snowball. Mirror's 60% in round 1, with identical information and policy, means a **residual structural asymmetry** that is not explained yet | Which rule causes it: candidates are the boss acting after seeing the player's last state, the tie-break, or turn order. Phase A must find it |
| C. Adapts meaningfully? | V2 Phase 4: varied builds within a band; vs mirror v2 58% (v1: 13%) | Adaptation improves outcomes against an equal opponent | Whether it adapts to *different* opponents differently (no per-opponent build-distribution test yet) |
| D. Fair across skill? | No skill tiers among the agents | — | Everything |
| E. Hidden information? | [CODE] boss prep sees only the player's last-round post-state (`prepare.ts`); its MC uses public rules. **Risk:** choosers receive full `CombatState` incl. `rngState` and the opponent's `autoMode` | No current exploit found in code | Future-proofing for V3: the defender/attacker choosers must get a **redacted view** (D.3) |
| F. One build beats everything? | V2 usage: Rapier/Crossbow dominate late (V2_BALANCE §4 #3–4) | V2 has dominant items | V3 dominance (not built yet) |

**Conclusion today.** The boss is overpowered **against the current agent suite**. The available evidence points to a **combination**:
1. Agent quality (agents don't search).
2. Mechanics (thin decision space, DEX stacking).
3. Economy (the snowball).
4. A residual round-1 asymmetry.

It does **not** establish that the boss is overpowered against competent humans.

### D.2 Benchmark opponent suite (V3) [REC]

| Tier | Agents | Purpose |
|---|---|---|
| T0 Baseline | `random`, existing fixed builds (`melee_bruiser`, `archer`, `shield_turtle`, `duelist`, `piercer`, `hybrid`) updated with V3 defence/stim policies | Beginner proxies; regression continuity |
| T1 Heuristic | `blocker` (shield + block), `dodger` (high DEX + polearm counters), `stunner` (mace/warhammer), `healer` (stim-heavy economy), `counter_puncher` (blocks melee, counters) | Each V3 mechanic has a champion; a mechanic with no viable champion is dead |
| T2 Adaptive | existing `adaptive`, `opportunist`, `reactive`, `switcher`, plus a defence-adaptive agent (switches block/dodge from the boss's observed weapon) | Intermediate proxies |
| T3 Best-response | `mirror` (boss policy for the player), plus `exploiter`: searches the player's affordable builds against the boss's **last observed** build with the real engine (same info as the boss) | Advanced proxy; "is there counterplay?" |
| T4 Adversarial fixtures | Fixed duels: max-dodge vs melee, max-block turtle, stun-lock attempts, stim-stall, counter farming | Exploit detection (pass/fail thresholds) |
| T5 Human | Manual runs, labelled `source=manual` | Ground truth when available; reported separately, never pooled with sims |

### D.3 Required boss metrics

Per opponent tier and agent, per game stage (rounds 1–2 / 3–5 / 6–10), each with a 95% CI (§H):
- **Outcome:** boss win rate, round-1 win rate, HP margin, comeback rate (boss wins round N+1 after losing round N).
- **Builds:** distribution of boss builds (archetype × key items), entropy, top-build share.
- **Adaptation:** per-opponent build distance. The adaptation test asks whether the build distribution differs between opponents: JS divergence, plus a permutation test.
- **Counterplay:** the best player counter-build win rate found by `exploiter`. A counterplay gap is flagged when no player build reaches 35% against the boss's chosen build.
- **Mechanic shares:** block/dodge/counter/stun/heal share of damage and HP, overall and by stage.
- **Before/after:** each metric under V2 rules vs V3 rules on paired seeds. That shows whether V3 increased or reduced dominance.
- **Fairness vs weakening:** a change counts as *fairness* if it lowers the boss's win rate against T0/T1 **without** lowering mirror/exploiter stability (mirror stays 45–60%). A change that lowers every tier equally is *weakening*, and is reported as such.

### D.4 Proposed boss acceptance criteria [REC] — approve or edit (**D-13**)

| Area | Criterion | Auto? |
|---|---|---|
| Mechanical correctness | All V3 unit/integration tests pass; sim and live engines produce identical events for the same seed (golden test) | Auto |
| Competitive fairness | Mirror boss win 45–60% overall **and** in round 1 (today: 59.5% / 60%) | Auto |
| Difficulty by skill | Boss win vs T0 70–90%, T1/T2 55–75%, T3 exploiter 35–60% | Auto |
| Counterplay | For every T1 archetype, at least one affordable player build reaches ≥ 35% vs the boss's policy in rounds 3–10 | Auto |
| Strategic diversity | No single boss build is > 40% of boss picks in rounds 3–10 across all tiers; ≥ 3 boss archetypes each ≥ 10% | Auto |
| Adaptation | Boss build distribution differs significantly between at least 4 of 5 T1 opponents (p < 0.01) | Auto |
| No exploits | T4 fixtures: max dodge rate per fight ≤ cap; no fighter loses > 1 consecutive action to stun in > 2% of rounds; no round with 0 actions for a fighter; heal share ≤ 25% of HP lost | Auto |
| Feel / fairness perception | 5+ human sessions: players can name why they lost; they can see a counter | **Human** |

---

## E. UI/UX audit and redesign proposal

Sources:
- the Impeccable critique, run as two isolated reviews: design review A, and detector + browser evidence B (B's results are in §E.6);
- the 13 committed review screenshots (`client/.impeccable/review/`);
- the source files.

### E.1 Current problems (evidence)

| # | Problem | Where |
|---|---|---|
| U1 | **No live combat state.** Versus cards show max HP and prep stats during the fight: `desktop-fight.png` reads "YOU 100 HP" while the log shows a KO. | `duel/Versus.tsx` |
| U2 | **The player is a spectator.** Most rounds have zero player decisions; the log auto-deals at 260 ms per row. The KO is a small tag on a log row. | `duel/Fight.tsx` |
| U3 | **No surface for a defensive decision.** `ChoicePrompt` is a paragraph plus buttons appended under the log. | `Fight.tsx ChoicePrompt` |
| U4 | **Jargon and spreadsheet numbers:** "Net ATK · base 23" under an "STR" label, "Eff. DEX", "margin +0.36", "Pierce 5% · ignores 70% DEF", two-decimal damage (56.68). | Versus, Armory, Aftermath |
| U5 | **Prepare is a wall.** 9 filter chips + 24 equal cards + 4 steppers + boss hand + 2 Begin buttons in one view. The ♠/♣ pips are confusable at 13 px. | `duel/Armory.tsx`, `desktop-prepare-hand.png` |
| U6 | **No onboarding.** The first screen asks a "Rounds in this run" number. Help lives in `title` tooltips (invisible on touch) and a rules footnote. | `views/DuelView.tsx` StartScreen |
| U7 | **The loop ends on homework.** Aftermath leads to analysis tables; the boss's fan clips its own labels. | `duel/Aftermath.tsx`, `mobile-prepare-end.png` |
| U8 | **Developer leakage:** seed/engine footer on every fight; "Workshop" as top-level nav; API-down error tells players to run npm/Docker, and shows twice. | `Fight.tsx`, `App.tsx`, `state-api-down.png` |
| U9 | **World conflict.** Court Deck's bright baize, white stock and primary inks cannot carry restrained dark fantasy. Its contract explicitly refuses the darker register. | `client/DESIGN.md`, `.impeccable/surfaces/src-app-tsx.md` |

Heuristic score from design review A: **23/40**. Visibility 2, Match 2, Control 2, Consistency 3, Error prevention 3, Recognition 2, Efficiency 3, Minimalism 2, Recovery 3, Help 1.

### E.2 Keep / redesign / remove

- **Keep:**
  - the two-sided exchange log (player left, boss right);
  - fixed side colours (desaturated);
  - big tabular numerals for compared values;
  - Atkinson Hyperlegible for reading text;
  - the honest boss-memory model (evidence → weakness → plan);
  - the expandable per-attack calculation;
  - keyboard shortcuts;
  - empty/error/loading state components (`ui/states.tsx`).
- **Redesign:**
  - Versus → separate **Build plates** (prep) and **Live plates** (fight: HP, stun, stims, status);
  - Fight → **combat stage** (§E.4);
  - Armory → role-organised (Offence / Block / Dodge & counter / Stun / Supplies) with an "affordable now" default;
  - Aftermath → boss line + next threat first, evidence behind "How it decided".
- **Remove from the player view:**
  - the seed footer and engine string (move to the calculation view or Workshop);
  - the duplicate Begin/Prepare buttons;
  - the developer error copy (keep it in Workshop);
  - "Workshop" as a peer of Duel (move to a quiet secondary entry).

### E.3 Design direction [REC] (**D-14**)

**Replace the Court Deck world; keep the structure.** Run Impeccable `new-work` in Phase E to pick the world; these are constraints for it, not a finished design:
- **Ground:** cold near-black stone/iron with low saturation. A single warm **ember** accent is reserved for "now" and danger: the incoming attack, stun ≥ 80, your decision.
- **Sides:** muted steel-blue (player) and oxblood (boss), both AA on the ground.
- **Type:** a restrained display face for headings/numerals (condensed, not blackletter) + Atkinson Hyperlegible for body. 4-step type scale; numerals tabular.
- **Surfaces:** at most 3 elevation levels. Panels only where content groups; the fight is a **stage**, not a stack of cards.
- **Motifs:** small line icons (sword, shield, dodge arrow, counter arc, stun star, vial) as one SVG set in `ui/Icon.tsx`. No parchment, no filigree, no glows, no particles.
- **Motion:** at most 150 ms state fades; `prefers-reduced-motion` respected. Animation is never needed to understand state.
- **Product doc:** update `client/PRODUCT.md` ("Court Deck" → the new world; add the V3 mechanics) and replace `client/DESIGN.md` and the surface brief once the world is chosen.

### E.4 Combat screen information hierarchy (text wireframe)

```
┌──────────────────────────────────────────────────────────────────────┐
│ Round 3 · Turn 2                         [? Rules]   [Auto-defend ▾]  │
├───────────────────────────────┬──────────────────────────────────────┤
│ YOU  Lv2                      │                         THE BOSS Lv3 │
│ ♥ 72 / 105  ███████████░░░    │    ░░░░████████████  88 / 115 ♥      │
│ ✶ Stun 40/100 ████░░░░░░      │       ░░░░░░██████  Stun 60/100 ✶    │
│ ⚗ Stims 1 left (+25 HP)       │       Mace · Small Shield · Leather  │
├───────────────────────────────┴──────────────────────────────────────┤
│                 ▼ INCOMING — The Boss swings MACE (melee)            │  ← focal point, ember
│        heavy · can stun · can be countered                           │
│  ┌──────────────────────────┐   ┌──────────────────────────┐         │
│  │ [B] BLOCK      38%       │   │ [D] DODGE      22%       │         │
│  │ success: no damage,      │   │ success: no damage,      │         │
│  │ counter chance 24% (×1.5)│   │ counter chance 0% (no    │         │
│  │ heavy: +15 stun to you   │   │ long weapon)             │         │
│  └──────────────────────────┘   └──────────────────────────┘         │
├──────────────────────────────────────────────────────────────────────┤
│ Last exchange: You BLOCKED · COUNTER 21 dmg · Boss stun +20 → 60     │  ← one-line result
├──────────────────────────────────────────────────────────────────────┤
│ Fight log (calm; expandable rows; calculation behind ▸)              │
│  T2  Boss  Mace → blocked by you · counter 21 · boss stun 60         │
│  T1  You   Sword → dodged by boss                                    │
│  T1  Boss  Mace → hit 18 · your stun 40                              │
└──────────────────────────────────────────────────────────────────────┘
```

When the player attacks, the focal card shows the player's attack choice (Strike/Shoot/Use stim). The boss's defence result then appears in the one-line result.

**Mobile:** live plates collapse to two rows (HP + stun bars); the focal card becomes full width; the log sits below the fold.

### E.5 Onboarding and contextual help (progressive disclosure)

1. **Start:** one sentence on the goal, plus "Start your first duel". Round count moves to "More options".
2. **First run, 3 coach beats:**
   - equip a starter (pre-selected suggestion);
   - Begin;
   - first incoming attack: explain Block vs Dodge in one sentence each.
   - Beats are dismissible and stored in `localStorage`, wrapped in try/catch.
3. **Just-in-time hints:**
   - the first time stun reaches 50 ("At 100 you lose your next defence and attack");
   - the first counter;
   - the first time stims are affordable.
4. **Labels:**
   - Every pip gets a word ("+2 DEX").
   - Renames: Net ATK → **Attack**, Eff. DEX → **Speed**, Net DEF → **Defence**. Formulas live in the expandable calculation.
   - Damage shows as integers in headline numbers, with full precision in the calculation.
5. **Help drawer** (`?`): rules by topic (Attack · Defence · Counters · Stun · Stims · Gear). It is generated from the same server constants, via `/api/catalog` + a new `/api/rules` endpoint, so the text can never drift from the rules.
6. **Costs and consequences before acting:**
   - every buy and upgrade shows price, the gold after buying, and the effect;
   - stat spends get an Undo before Begin. This needs a server endpoint: `POST /runs/:id/allocate/undo`, allowed only before the round starts.

### E.6 Detector and browser evidence (Impeccable Assessment B)

- **CLI detector** (`impeccable detect --json client/src`): exit 0, 22 advisory findings, no blocking anti-patterns.
  - 11 off-scale radii (6px ×7, 4px, 9px, 11px, 16px; mostly `app.css`).
  - 11 off-ramp font sizes (1.05/1.1/1.35rem, and the mobile step-downs).
  - The 9px/11px radii are deliberate concentric radii, so false positives. The rest is small token drift. It becomes moot with the new world's token set (E2), which must define the scale before components.
- **Browser overlay** (detect.js injected into Home, Runs, Simulations, ML Lab; mobile at 375 px):
  - Home: *gray-on-color* on the hero lede. A false positive: `on-baize-2` is about 6:1, which passes AA.
  - Home: *dark-glow* on the primary button. Documented in DESIGN.md as "Primary glow", but it contradicts DESIGN.md's own "colour is printed, not lit". It matches design review A's note that the red glow is the loudest thing on every screen. **U10:** drop glows in V3.
  - Workshop pages: *nested-cards* on 8 `.table-wrap` elements. A false positive: no background or shadow, just a scroll frame.
  - Mobile: no horizontal scroll at 375 px.
- **Net:** the detector finds no structural defects. The real V3 UI problems (U1–U9) are about hierarchy, discoverability and the world, which only the design review catches.

### E.7 UI acceptance criteria

- **Usability test.** 5 first-time players (or recorded walkthroughs) each answer 5 questions without help:
  - What can I do now?
  - Who attacks next?
  - What happened in the last exchange?
  - Why did I lose?
  - What does Block cost me versus Dodge?
  - Target: ≥ 4 of 5 players answer every question. **Human.**
- **Clicks.** A round needs ≤ 1 click per real decision. Auto-defend/stance means routine defences need no clicks. **Auto:** count prompts in an e2e test.
- **No visual-only state.** Every HP, stun, stim and status value is in text and ARIA, with a live-region announcement for each exchange. **Auto.**
- **Contrast and targets.** AA contrast on every token pair; focus visible; touch targets ≥ 44 px; no horizontal scroll at 360 px. **Auto** (contrast script + capture at 390 and 1440).
- **Detector.** The Impeccable detector shows no P0/P1 findings. The finish review returns "ship".
- **Accuracy.** The UI shows only server-provided outcomes; the client never recomputes results. **Auto:** component tests render fixtures of authoritative events.

---

## F. Technical architecture and migration impact

### F.1 Engine (server/src/game)

1. **`RuleSet` instead of version branches [REC].** New `game/rules/{v2,v3}.ts` export a frozen config: formulas toggles plus numbers.
   - `combat.ts` takes `state.rules`, a RuleSet id that is stored in `CombatState`.
   - V2 stays runnable for **paired baseline comparisons**, and nothing is deleted.
   - Every V3 constant lives in `rules/v3.ts`:
     ```ts
     {
       dodge: { perDexPoint: 0.02, cap },
       block: { defFactor: 0.005, source: 'raw' | 'net', cap },
       counter: { blockMult: 1.5, dodgeMult: 0.75, blockStun: 20, … },
       stun: { threshold: 100, perAttack: [10, 20], … },
       stim: { … },
       dexBenefits: { mitigation, bonusAttacks, turnOrder, firstShot },
     }
     ```
   - Values come from the doc; the open ones are marked `provisional: true`.
2. **Attack sequence as explicit sub-steps.** The cursor gains `step: 'stim' | 'announce' | 'defend' | 'resolve' | 'counter' | 'stun'` plus an `incoming` record (attacker, mode, weapon), so the engine can pause on the **defender** and resume exactly.
3. **Decisions generalised.** `Chooser` gets `{ kind: 'attack_mode' | 'defense' | 'stim', … }` and a **redacted `ChooserView`**:
   - own state;
   - the opponent's public state;
   - the announced incoming attack;
   - meters;
   - no `rngState`, no opponent `autoMode`/stance.
   - A unit test proves the redaction.
4. **RNG order fixed and documented.** Per attack: defence roll → counter roll → pierce roll (on a hit) → mitigation roll → stun roll(s).
   - [REC] Always draw a fixed number of uniforms per attack, even when unused, so a defence choice does not shift later rolls. This is the same idea as the always-drawn tie-break.
   - Golden-seed tests lock it.
5. **Events.** `CombatEvent` gains:
   - `kind: 'attack' | 'counter' | 'stun' | 'skip' | 'stim'`;
   - `defense?: { action, chance, roll, success, counterChance?, counterRoll? }`;
   - `stunBefore`, `stunAfter` per side;
   - `parentSeq` (counter → attack).
   - Every value the UI shows is in the event.
6. **One round step for live and sim.** Extract the round step: prepare → snapshot → combat → rewards. It becomes a pure `playRound()` used by `services/rounds.ts` (with DB I/O around it) and `sim/balance.ts`, which removes the drift risk (§B). A golden test runs the same seed through both and compares events.

### F.2 Persistence — migration `003_v3_combat.sql` (additive only)

- `combat_events`:
  - `ADD COLUMN kind TEXT NOT NULL DEFAULT 'attack'`;
  - `ADD COLUMN detail JSONB`;
  - widen the `phase` CHECK to add `'counter'`.
  - Old rows stay valid.
- `combatants`: `ADD COLUMN supplies JSONB NOT NULL DEFAULT '{"stims":0,"slots":1,"effectiveness":0}'`. The defaults depend on D-7.
- `progression_events`: widen the kind CHECK with `stim_purchase`, `stim_slot_upgrade`, `stim_eff_upgrade`.
- `rounds.pending_choice`: JSON shape gains `kind`; no schema change.
- **Safety:**
  - `pg_dump` backup before migrating dev (same procedure as V2 Phase 0);
  - migration tested on the test DB first;
  - an idempotency test;
  - no UPDATE or DELETE of existing rows;
  - V1/V2 runs remain view-only (`assertCurrentEngine` → `3.0.0`).
- **Engine version** `3.0.0`; `SIMULATOR_VERSION` `sim-3.0.0`; a new `FEATURE_SCHEMA_VERSION` `v4`.

### F.3 API (`server/src/api/app.ts`, `services/*`)

- `POST /api/rounds/:id/choice` accepts:
  - `{ kind:'attack_mode', mode, repeat }` — the old shape is still accepted;
  - `{ kind:'defense', action:'block'|'dodge', stance? }`;
  - `{ kind:'stim', use:boolean }`.
- `POST /api/runs/:id/supplies { action:'buy'|'upgrade_slots'|'upgrade_effectiveness' }`.
- `GET /api/rules`: rule text and numbers for the help drawer.
- `POST /api/runs/:id/preview` extended with block/dodge/counter chances for the planned build against the boss's last build.
- The client types in `client/src/api.ts` mirror all of this.

### F.4 Boss

- **`bossChooser`:**
  - defence choice from expected value (block vs dodge chance × outcome), using the view only;
  - stim use rule: heal when HP lost ≥ heal amount, and before a predicted lethal hit.
- **`choosePlan`:** the plan space adds stim purchases/upgrades. Cost control:
  - enumerate supplies only as {none, buy k, upgrade} with k ≤ slots;
  - keep the analytic pre-score + MC verification.
  - Re-measure the policy runtime: the budget today is about 40 fights per plan.
- **Scenarios:** player scenarios need a defence stance (block-leaning / dodge-leaning), weighted by observed history. This is the main new prediction need (§F.5).
- **`analysis.ts`:** new weakness codes: `stun_pressure`, `counter_exposure`, `dodge_exposure`, `heal_stall`, `block_wall`.

### F.5 ML

- **V3 makes old data unrepresentative**: new actions and outcomes, new engine. Keep the v1–v3 datasets untouched. They are append-only and engine-filtered: training already filters by engine and schema.
- **Schema v4** adds history features:
  - player block share and dodge share;
  - block/dodge success;
  - counters dealt and received;
  - stun taken and stuns suffered;
  - stims bought and used;
  - heal HP.
- **Possible second task:** P(player blocks melee next round), which feeds the scenario weights. It is evaluated only with the same strict eligibility, ensemble rule and decision-outcome check. **No activation without your OK.**
- **Order:** ML comes **after** mechanics balance (Phase D). If a dominant build exists, prediction has no leverage (V2_BALANCE #9).
- **"ML is useful" evidence:**
  - held-out and leave-one-strategy-out log loss below the baseline;
  - **and** a decision-outcome improvement on paired seeds (`decision-check.ts`), vs T2/T3 agents, with a CI excluding 0.
  - Simulated-only data is labelled; the human slice is reported separately.

### F.6 Client

The new and changed pieces:
- `duel/Stage.tsx` (incoming card + choices);
- `duel/LivePlates.tsx`;
- `duel/Supplies.tsx`;
- the Armory reorganised;
- `ui/Help.tsx` (drawer);
- `ui/Coach.tsx`;
- a new token set in `styles/tokens.css` (world change);
- `Icon.tsx` extended.

No new runtime dependencies. Add Vitest + @testing-library/react for component tests — the one dev dependency, **ask first**.

### F.7 Tests that V3 invalidates

Tests that assume every attack hits or that combat is attacker-only:
- `combat.test.ts` (damage per event; opening rules);
- `balance.test.ts`;
- `policy.test.ts` expectations (MC numbers);
- `sim.test.ts` counts;
- `features.test.ts` (schema).

Plan: keep them running under `rules: v2`, which must stay green, and add V3 counterparts. Don't rewrite the V2 tests.

---

## G. Phased implementation roadmap

The order is adjusted to the repo: balance tooling comes **right after** the engine, so every later phase is measured.

### Phase A — Decisions, baseline, symmetry (no gameplay change) — DONE 2026-10-19

> Result: `docs/V3_BASELINE.md`.
> - The mirror round-1 "60%" was noise: 49.8% over 2,000 seeds.
> - The real problems are a deterministic first-mover win when DEX is equal, a 100% snowball, and a dominant hybrid archetype.
> - The DEX ablation moved to Phase C1 (it needs the RuleSet).

- **Objective:** freeze the V2 control, resolve the §I decisions, fix the tooling gaps.
- **Files:**
  - new `server/src/sim/v3-baseline.ts` + `npm run v3:baseline`;
  - `game/combat.ts` (redacted `ChooserView` only; behaviour identical);
  - `docs/V3_DEMANDS.md` (spec with your answers).
- **Tasks:**
  1. Record your decisions in `V3_DEMANDS.md`.
  2. Baseline report on fixed seeds:
     - per agent and stage: win rate + CI, round-1 rate, margins, build entropy, DEX-benefit ablation (mitigation/bonus/turn order/First Shot off one at a time);
     - store as `artifacts/balance/v3-baseline-*.json`.
  3. Investigate the mirror round-1 60% asymmetry.
  4. Chooser redaction plus a test.
  5. DB backup.
- **Tests:** all 160 + 5 still pass; the redaction test; baseline reproducible (same seed → same JSON hash).
- **Deliverables:** `V3_DEMANDS.md`, `V3_BASELINE.md`, the backup.
- **Risks:** decisions drag on. Mitigation: non-blocking values stay configurable.
- **Acceptance:** every **blocking** decision in §I is answered; baseline committed.
- **Approval:** §I; any rule change found by the asymmetry investigation.

### Phase B — Combat foundation (engine only, pure) — DONE 2026-10-19

> Result: RuleSet v2/v3 (`game/rules.ts`), V3 formulas, `catalogs/v3.ts`, and the V3 attack sequence in `combat.ts`.
> - 22 V3 tests.
> - The v2 path is byte-identical (240-run diff).
> - The DEX-benefit toggles are in place for the C1 ablation.
> - Not live yet: no persistence or API (Phase C2).

- **Objective:** V3 attack sequence per the approved rules.
- **Files:**
  - `game/rules/{v2,v3}.ts`;
  - `game/formulas.ts` (new pure functions: `dodgeChance`, `blockChance`, `counterChance`, `counterDamage`, `stunGain`, `stimHeal`);
  - `game/combat.ts` (sub-steps, defender pause, events, stun/skip, stim decision);
  - `game/types.ts`;
  - `game/expected.ts` (expected values incl. defence);
  - `game/summary.ts`.
- **Prerequisite:** Phase A decisions D-1…D-8, D-10, D-12.
- **Tests:** unit tests per §H.1; RNG-order golden tests; V2 RuleSet regression (identical events to engine 2.0.0 on stored seeds).
- **Deliverable:** engine 3.0.0 behind RuleSet `v3`; nothing persisted yet.
- **Risks:**
  - cursor complexity: one flat sub-step machine, exhaustively tested;
  - counter recursion: forbidden by rule D-10, asserted.
- **Acceptance:** all mechanics tests pass; `v2` replay identical; `MAX_ATTACKS_PER_ROUND` never hit across 10k random fights; no fighter ever acts 0 times in a round unless KO'd in the opening.

### Phase C1 — Balance harness v3 + agents (pure, no DB)

- **Objective:** measure mechanics before building UI or persistence.
- **Files:**
  - the shared `playRound()` extraction;
  - `sim/balance.ts` (RuleSet param, paired seeds, CIs, matchup matrices, per-stage tables, mechanic shares, exploit fixtures);
  - `sim/agents.ts` (defence/stim policies for all agents; the new T1/T3 agents);
  - `balance-cli.ts` (`v3` subcommands).
- **Tests:**
  - harness unit tests (CI math; pairing gives identical seeds);
  - golden: `playRound` live vs sim give identical events.
- **Deliverable:** `docs/V3_BALANCE.md` first pass. This is the first answer to "does V3 widen the strategy space?"
- **Acceptance:** report reproducible; every T4 fixture runs; each mechanic's contribution is measured.
- **Approval:** any change to **your** values found necessary (pierce/costs/mods/formulas). Provisional values flagged `provisional` may be tuned with your OK per change set.

### Phase C2 — Catalogue, economy, persistence, API

- **Objective:** make V3 playable and persisted.
- **Files:**
  - `catalogs/v3.ts`, `catalog.ts`, catalogue guard;
  - `equipment.ts` (supplies);
  - `progression.ts`;
  - `db/migrations/003_v3_combat.sql`;
  - `services/{runs,rounds,history}.ts`;
  - `api/app.ts`;
  - `boss/{policy,prepare,analysis}.ts` (defence/stim);
  - `sim/runner.ts`.
- **Tests:**
  - lifecycle integration: defender pause/resume via the API, stim buy/upgrade/use, round transitions, legacy view-only;
  - migration test on the test DB; DB-sim vs harness event equality.
- **Acceptance:**
  - `npm test` green;
  - the migration is additive and verified on a dev-DB copy;
  - a full manual run playable through the old client (API compatibility for attack choices).

### Phase D — Boss evaluation and tuning

- **Objective:** answer §D with V3; fix root causes.
- **Tasks:**
  - the full opponent suite × stages × V2-vs-V3 paired;
  - the dominance search (best response per build);
  - stun-chain/heal-stall fixtures;
  - snowball analysis (with and without the economy tweaks proposed in V2_BALANCE #7, as experiments only).
  - Root-cause classification per finding: policy / mechanics / agents / economy.
- **Files:** `sim/*`, `boss/policy.ts` (config only unless approved), `docs/V3_BALANCE.md`.
- **Acceptance:** §D.4 criteria evaluated with CIs; every failure has a classified cause and a proposed change.
- **Approval:** all material balance changes (tuning sets, rule changes, target band).

### Phase E — UI/UX redesign

- **Objective:** the V3 client per §E.
- **Steps:**
  - E1: Impeccable `shape` + `new-work` for the new world. Update PRODUCT.md / DESIGN.md / the surface brief, with your approval of the direction.
  - E2: tokens + icon set + base components.
  - E3: combat stage + live plates + defence/stim decisions + one-line results + log.
  - E4: Prepare reorganisation + Supplies + build preview with chances.
  - E5: onboarding (start, coach beats, hints, help drawer from `/api/rules`).
  - E6: Aftermath (boss line first).
  - E7: Workshop moved and its visual pass.
  - E8: Impeccable finish review + detector + captures (`capture-review.py`).
- **Prerequisites:** the C2 API. E1 can start after Phase A.
- **Tests:** component tests on event fixtures; e2e click count; contrast script; captures at 390/1440; manual usability (§E.7).
- **Acceptance:** §E.7.
- **Approval:** the world direction (E1); the component-testing dev dependency.

### Phase F — Final verification

- **Tasks:**
  - full test/typecheck/build;
  - DB sim smoke on the test DB;
  - V3 vs V2 report;
  - ML evaluation under schema v4 (no activation without OK);
  - docs:
    - `GAME_MECHANICS.md`, `ARCHITECTURE.md`, `SIMULATIONS.md`, `ML_WALKTHROUGH.md`, `DATABASE_WALKTHROUGH.md`, `FILE_GUIDE.md`;
    - README, `PROGRESS.md`, `HANDOFF.md`.
- **The final balance report answers the 6 questions:**
  1. Is the boss overpowered?
  2. Against whom?
  3. What is the evidence?
  4. What is the root cause?
  5. Which change fixed it?
  6. Did fairness improve without destroying the challenge?

---

## H. Testing and measurement strategy

### H.1 Unit (`server/tests/unit/v3-*.test.ts`)

- dodge/block chance incl. caps and clamps at 0;
- stacking (shield + armour; ranged adds 0);
- all-or-nothing block;
- counter eligibility (ranged never; opening never; per D-10 weapon requirement) and damage per D-1;
- dodge counter has no stun;
- stun gain per D-5; trigger only with `canStun`; reset to 0; skip of exactly one defence + one attack; chain behaviour per D-5;
- stim buy/upgrade cost progression (25, 30, 35…), use, max-HP cap, stunned rule;
- RNG order golden;
- chooser redaction.

### H.2 Integration (`server/tests/integration/v3-*.test.ts`)

- API flow: attack → defender pause → `choice{defense}` → result → counter → stun;
- ranged blocked/dodged with no counter;
- skipped turns visible in events;
- stims across round transitions;
- buy/upgrade through the API;
- boss decisions persisted with V3 evidence;
- legacy runs view-only;
- migration up on a populated test DB.

### H.3 Simulation and balance

- **Matrices:** weapon × weapon and archetype × archetype per stage tier (existing `TIERS`), with the best robust build per weapon (`robustBuildFor`, extended to block/dodge gear).
- **Value per cost:** score ÷ cost, with rank inside the price bracket.
- **Run suites:**
  - every agent tier × 200 runs × 10 rounds;
  - paired V2 vs V3 on identical seed lists;
  - winning and losing economy paths (forced-win and forced-loss income scripts).
- **Metrics:**
  - win rate, HP margin, damage dealt/received;
  - block/dodge attempts and success;
  - counter rate and damage share;
  - stun gain/rounds-to-stun/stuns per round/turns lost;
  - heals used and effective HP healed;
  - gold earned/spent, affordability of the next tier;
  - build entropy, top-build share;
  - per-opponent build divergence.

### H.4 Statistical reliability

- **Unit of analysis = the run**, not the round: rounds in a run are correlated through progression. CIs use a run-level bootstrap (2,000 resamples). Single-fight matrices use Wilson intervals.
- **Sample size reasoning:**
  - a 95% CI half-width for a proportion near 0.5 is about ±1/√n: n = 400 → ±5 pp, n = 1,000 → ±3 pp;
  - screening matrices: 200 fights/cell (±7 pp) to rank;
  - confirmation: 1,000 fights for any cell used in a decision;
  - run suites: 200 runs per agent (about ±7 pp per agent on the run-level rate, tighter on pooled rounds).
- **Runtime:** measured in Phase A. The MC boss costs about 40 fights per plan per round, so 200 runs × 10 rounds × agents is a minutes-scale CLI job; the DB runner is not used for this.
- **Pairing (common random numbers):** baseline and candidate use identical seed lists. Report paired differences with a CI, which removes most seed noise.
- **Alerts (regression thresholds):**
  - any agent's boss win rate moves > 10 pp with a CI excluding 0 → flag;
  - any item's usage share > 40% in its tier → flag;
  - any mechanic damage share > 50% or < 2% → flag ("dominant" / "dead");
  - stun-lock fixture > 2% → fail;
  - mirror outside 45–60% → flag.
- **Reproducibility:** every report stores the seed list, git SHA, RuleSet id and the JSON of results.

### H.5 Baseline comparison and regression

- The V2 RuleSet stays runnable; the `v3:baseline` artifact is committed.
- Golden events for 20 fixed seeds under v2 must never change.
- Live-vs-sim equality is tested per release.
- ML safeguards are unchanged and tested (`ensemble.test.ts`, `ml.test.ts`).

### H.6 UI

- component tests on fixtures (HP/stun/stims display; log ordering; unavailable-action messages; victory/defeat/empty/loading/error states);
- e2e prompt count;
- capture script at 390/1440;
- contrast script;
- Impeccable detector + finish review;
- 5-person usability script (§E.7).

---

## I. Unresolved decisions requiring your approval

> **Answered 2026-10-19.** See `docs/V3_DEMANDS.md`. Owner choices:
> - D-1: a counter is a mini move with the attack formula.
> - D-2: delta = effDex difference.
> - D-3: simulate raw vs Net DEF; cap 70%.
> - D-4: shaved % of the hypothetical hit.
> - D-5: stun gain = shaved % + mitigation roll % + Stun Boost %.
> - D-7: 10 g = 1 stim, heal 20%, 1 slot; used slots refill only by buying.
> - D-9: tuned V2 pierce.
> - D-10: counters can't be defended.
> - D-12: prompt on every incoming attack.
> - D-14: design delegated.
> - New rule: starting gold 10.
>
> The table below is kept as the record of the original options.

Ordered by architectural impact. **Blocking** = Phase B cannot start without it.

| ID | Decision | Why it matters | Recommendation | Alternatives | Blocks |
|---|---|---|---|---|---|
| **D-1** | What "final damage" means for counter multipliers | Decides whose stats a counter uses; changes every counter number | **Recalculate the counterer's own attack** (their Net ATK + melee weapon vs the attacker's Net DEF, normal pierce roll, normal DEX mitigation) × 1.5 (block) / × 0.75 (dodge). Matches "counter damage is influenced by STR" | (b) × the incoming attack's would-be final damage, which rewards blocking big hitters and ignores the counterer's stats | **Yes** |
| **D-2** | Dodge delta and cap | 2 × delta reaches 100%+ at measured gaps | delta = defender effDex − attacker effDex, floored at 0; dodge = min(cap, 2% × delta) with **cap 40%**; dodge-counter chance = min(cap₂, (delta + mod) %) with cap₂ 35%, applied only after a successful dodge | Cap 30/50%; raw-DEX delta; ratio-based delta | **Yes** |
| **D-3** | Which DEF in "0.5 × DEF", and the block cap | Net DEF makes DEF dominate shields (and double-counts shield DEF); raw DEF gives 5–6.5% | **Raw DEF stat** (base + level + allocation): block = min(cap, 0.5% × DEF + Σ gear block bonus), **cap 60%**. Keeps "shields primary, DEF smaller" | Net DEF with a lower factor (e.g. 0.25%); cap 50/70% | **Yes** |
| **D-4** | Block-counter chance ("% shaved off" vs all-or-nothing block) | A block always shaves 100%, so the doc's rule is undefined | Shaved % = the share of the attack value the defender's DEF + DEX mitigation would have removed **had it hit**: `1 − wouldBeFinal / attackValue`. Counter chance = min(cap, k × shaved) with k = 0.5, cap 50% (provisional, tuned) | Flat block-counter chance per weapon; DEF-based; shaved measured before mitigation only | **Yes** |
| **D-5** | Stun details: (a) how 10–20 is chosen; (b) the "Stun Boost +4%" unit; (c) builds vs triggers; (d) full meter without a trigger weapon; (e) extra damage; (f) what is skipped; (g) carry-over between rounds; (h) chains | Measured fights are 3–11 attacks; stun is either dead or a lock depending on these | (a) gain = 10 + 10 × shaved% (same shaved as D-4) on every hit by any weapon; (b) boost multiplies gain (+4% → ×1.04); (c) all weapons **build**, only `canStun` weapons **trigger**; (d) the meter caps at 100 and waits for a trigger hit; (e) +25% of that hit's damage; (f) the stunned fighter's next whole action (regular + bonus attacks) and the next incoming attack's defence (auto-hit); (g) **reset each round**; (h) after a stun, the meter can't gain until the stunned fighter has acted once (measure first; only adopt if the fixtures show chains) | Boost as +points; stun on any weapon; extra damage flat; carry-over | **Yes** |
| **D-6** | "Very heavy attack" for block stun | Decides whether blocking warhammers is safe | Heavy = would-be final damage ≥ 25% of the blocker's max HP → blocker gains the normal stun gain; shields do not reduce it in v1 of V3 (measure) | Weapon-tagged heavy (Warhammer, GreatSword, Mace); STR threshold | Partly (B can use config) |
| **D-7** | Stims: (a) what 10 g buys; (b) slots per upgrade and base; (c) heal amount and scaling; (d) do unused stims carry over; (e) use while stunned; (f) timing; (g) boss uses stims | Economy and persistence shape | (a) 1 stim, up to the slot count; (b) base 1 slot, +1 per upgrade; (c) heal 20% max HP, +5 pp per effectiveness level; (d) unused stims **expire at round end** (matches "purchased at the start of each round"); (e) no; (f) before the fighter's own action each turn, at most 1 per turn; (g) yes, same rules | Refill-all for 10 g; carry-over; flat HP heal | **Yes** (persistence) |
| **D-8** | Which old DEX benefits remain | Dodge adds a fifth DEX benefit; V2 already shows DEX dominance | Keep all in RuleSet v3 at first, measure the ablations in Phase A/C1, then decide with data (likely candidates: bonus-attack thresholds or mitigation) | Drop bonus attacks now; drop mitigation now | No (configurable) |
| **D-9** | Catalogue fixed vs tunable; pierce source; Warhammer cost | The doc lists your original pierce values and Warhammer 45; the code has tuned pierce and 40 | Start from the **doc** values (your V3 spec, Warhammer 45, original pierce), since block/dodge change pierce's value anyway. Mark pierce / stun boosts / counter mods / block bonuses as tunable-with-approval; costs and STR/DEF/DEX fixed | Start from the V2-tuned pierce | **Yes** (catalogue) |
| **D-10** | Counter scope | Recursion and loops | Counters cannot be blocked, dodged or countered. Block counter needs a melee weapon or unarmed; a bow-only defender can't counter. Dodge counter needs a weapon with `dodgeCounter` | Counters defendable (no counter-counter) | **Yes** |
| D-11 | Pierce vs block | Interaction | Pierce applies only on a hit; no effect on block chance | Pierce reduces block chance | No |
| **D-12** | Defence prompt UX | Each incoming attack = a decision; 3–11 per round | Per-attack prompt with B/D keys **plus** a stance ("Auto: best chance" / "Always block" / "Always dodge") that answers routine attacks; prompt only on heavy/stun-capable attacks or stun ≥ 80 when a stance is set | Always prompt; stance only | **Yes** (engine pause semantics) |
| D-13 | Boss difficulty targets | Defines "balanced" | §D.4 bands (T0 70–90, T1/T2 55–75, T3 35–60, mirror 45–60) | Single band 55–70 (the V2 Q-3 band) | No (needed by Phase D) |
| **D-14** | UI world | The current world refuses dark fantasy | Replace Court Deck with a restrained dark-fantasy world (§E.3); keep the structure | Refine Court Deck darker | Blocks Phase E only |
| D-15 | Opening shot defendable? | The doc says ranged can be blocked/dodged | Yes, block/dodge allowed, never countered | Undefendable opening | No |
| D-16 | Mirror round-1 60% asymmetry | Possible structural edge | **Resolved (Phase A):** no boss edge (49.8% [47.6–51.9], n = 2,000). Round 1 is decided by the initiative coin flip, because equal-DEX unarmed fights have no randomness (V3_BASELINE F1) | — | No |
| D-17 | Rewards/economy unchanged? | Stims compete with gear for scarce gold | Keep rewards; measure; propose only with data | Raise loss gold | No |
| D-18 | Component-test dev dependency (@testing-library/react, jsdom) | UI tests | Add it (dev only) | Fixture snapshot tests without the DOM | Phase E only |

---

## J. Risks and failure modes

| Risk | How it would show | Guard |
|---|---|---|
| DEX dominance worsens (dodge + order + bonus + mitigation + First Shot) | High-DEX builds top every matrix; heavy gear unused | D-2 cap, D-8 ablations, matrix alert > 40% usage |
| Counter loops / counter farming | Counter share > 40% of damage; turtles win by never attacking | D-10 no recursion; counter-share alert; turtle fixture |
| Stun chains | A fighter loses ≥ 2 actions in a row; 0-action rounds | D-5h, per-round reset, chain fixture (fail > 2%) |
| Dead stun | Stun rate < 5% of rounds even for mace builds | Stun share alert < 2%; tune gain only with approval |
| Healing stall | Fights lengthen without a winner; heal share > 25% | Stim per-turn limit, expire per round, `MAX_ATTACKS` guard, stall fixture |
| Dominant hybrid (Bow + melee + small shield) | One loadout tops all tiers; ML loses leverage again | Dominance search; usage alert |
| Unfair boss | Boss reads RNG or stances; boss wins T3 > 60% | Chooser redaction test; T3 suite |
| Misleading simulations | Agents too weak, so 100% boss; sim and live drift | T1–T3 agents; shared `playRound`; golden equality |
| Snowball | Round-1 winner wins the run > 90% | Report it; propose economy experiments with approval |
| Combinatorial policy slowdown | Boss prep > 2 s per round | Bounded supply options; MC budget; timing test |
| Data corruption | Migration breaks legacy views | Additive migration, backup, legacy test, test DB first |
| Polished but confusing UI | Usability questions fail; prompts per round high | §E.7 human test; click count; one focal point rule |
| Scope creep | Mechanics multiply decisions without trade-offs (DOC §13) | Every mechanic must show a champion (T1) and a counter in the matrices; otherwise flag it as decoration |

---

## K. Definition of done

1. **Combat:**
   - every approved rule is implemented in RuleSet v3, with the unit/integration tests in §H.1–H.2;
   - v2 golden events unchanged;
   - live = sim events on the same seed;
   - `npm test`, typecheck and build green.
2. **Balance validation:**
   - `docs/V3_BALANCE.md` with paired V2/V3 tables and CIs per weapon, archetype, stage and mechanic;
   - no open alert without a documented, approved disposition;
   - reproducible from a committed command.
3. **Boss fairness:** §D.4 criteria met, or failures explained with root cause and owner decision; the six final questions answered with evidence.
4. **ML:** schema v4 evaluated under unchanged safeguards; activation only with explicit OK; the limitation (sim-only data) stated.
5. **UI/UX:**
   - §E.7 met: human checks ≥ 4/5, ≤ 1 click per real decision, AA, no horizontal scroll at 360 px;
   - Impeccable finish review "ship";
   - PRODUCT.md and DESIGN.md updated.
6. **Data safety:** backup taken; the migration additive; no dataset or baseline overwritten; legacy runs view-only and tested.
7. **Docs:** all docs listed in Phase F updated; `PROGRESS.md` + `HANDOFF.md` current.

---

## L. Recommended next action

1. **Answer the blocking decisions:**
   - combat rules: **D-1, D-2, D-3, D-4, D-5, D-7, D-9, D-10, D-12**;
   - D-14 for the UI direction.
   - Recommendations are given for each. "Use your recommendation" is a valid answer per item.
2. Then start **Phase A**: write `V3_DEMANDS.md` with your answers, commit the V2 control baseline (`npm run v3:baseline`), investigate the mirror round-1 asymmetry, add chooser redaction, back up the DB.
3. Phase B follows only after A's acceptance.
