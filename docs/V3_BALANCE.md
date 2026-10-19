# V3 Balance — stun and dodge tuning (Phase C1, 2026-10-19)

**Owner's request:** stun needs revision and dodge needs a buff; find a sweet spot through rigorous testing; use varied play styles, not archetypes.

**Result:** a tuned V3 default, now in `server/src/game/rules.ts` `V3_COMBAT`.

| Setting | Owner's original | Tuned |
|---|---|---|
| Dodge chance | 2% × DEX lead | **10% base + 2% per point of DEX lead** (cap 70%) |
| Stun gain per landed hit | 10–20 | **17.5–35** (base 17.5 + 17.5 × min(1, shaved + mitigation roll + stun boost)) |

Everything else is unchanged: block, counters, the 70% caps, the 100 threshold, extra damage at 25%, and stims.

Reproduce (pure in-memory, no DB):
- `npm run v3:lab -- sweep` (about 7 min)
- `npm run v3:lab -- confirm` (about 2 min)
- `npm run v3:lab -- confirm --seed lab-verify --candidates docs/v3-lab/verify.json`

Reports and JSON: `docs/v3-lab/`.

## 1. Method — a varied population, not archetypes

Code: `server/src/sim/v3-lab.ts`.

**Three game stages** (budget = gold value of gear plus supplies):

| Stage | Level | Stat points | Budget |
|---|---|---|---|
| early | 1 | 2 | 10 g (the new starting gold) |
| mid | 3 | 4 | 60 g |
| late | 6 | 7 | 140 g |

**Builds.** 800–1,500 random legal builds per stage, each with:
- a random stat-point spread, from all-in on one stat to evenly spread;
- a random hand shape: melee, melee + shield, ranged, ranged + shield, hybrid, shield, or unarmed;
- random affordable items in random slot order, armour or not;
- random supplies: no stim, stims, or slot/effectiveness upgrades, paid from the same budget.

**Play styles.** Each build gets random habits on three axes:
- **Defence:** smart (expected-value), always block, always dodge, random, or greedy (higher chance).
- **Healing:** auto, only when below 50%, or never.
- **Ranged vs melee** (hybrids): best, melee, ranged, or random.

**Fights.** 10,000–30,000 random same-stage pairings per stage.
- **Paired:** the same builds, pairings and seeds for every rule variant, including the V2 control.
- **Causal stun test:** each candidate is re-run on the identical fights with stun triggering switched off (`stun.trigger: false`). The win-rate difference is what stun changes.

**Populations.** Three independent ones:
- `lab`: sweep, 800 builds × 10,000 fights per stage;
- `lab-confirm`: 1,500 × 30,000;
- `lab-verify`: 1,500 × 30,000, fresh, to check the result reproduces.

**Uncertainty.** Wilson 95% CIs on all rates. With n ≥ 4,000 appearances per group, CIs are about ±1.5 pp.

**Not included.** The boss policy and the run economy. This is a mechanics lab; boss evaluation is Phase D.

## 2. Sweet-spot targets

These are proposed and used for scoring. Every 5 pp outside a band costs 1 point.

| Target | Band | Why |
|---|---|---|
| Dodge success when chosen | 20–45% | A real option, not a gamble or a guarantee |
| Smart players' dodge share (mid/late) | 30–65% | Both defences get used by good players |
| \|always-dodge style − always-block style\| win rate | ≤ 5 pp | Neither style is a trap |
| Faster fighter's win rate vs V2 | ≤ +1 pp | Dodge must not add DEX dominance |
| Can-stun holder lands ≥ 1 stun (mid/late) | 30–55% | Stun is a threat, not an every-fight event |
| Stun chains (same fighter stunned 2+ times in one round) | ≤ 5% | No stun-lock |
| Stun extra-damage share of all damage | 1–6% | The lost turn is the main effect, not the damage |
| Can-stun gear win rate vs V2 | ≤ +5 pp | Stun weapons must not become dominant |
| Paired stun effect on the holder's win rate | about +2 to +6 pp | Stun matters but does not decide fights alone |

## 3. Diagnosis — the owner's original values

Population `lab-confirm`. Values are early / mid / late.

| Measure | Owner's original |
|---|---|
| Dodge success when chosen | 3% / 12% / 16% |
| Always-dodge style vs always-block style win | 44.7 vs 52.9 / 44.7 vs 48.9 / 48.1 vs 49.8 |
| Smart players choose dodge | 12% / 25% / 22% |
| Can-stun holder lands a stun | — / 9% / 7% |
| Paired stun effect | — / +0.5 pp / +0.3 pp |

- **Dodge was weak.** With 2% per point of *lead*, a fighter who is not faster can never dodge. In round 1 nearly everyone has equal DEX, so dodge was about 0%. The faster fighter already wins about 61%, so dodge only helped those already ahead.
- **Stun was dead.** Fights last 10–15 attacks in total, so a fighter receives about 5–7 hits. At 10–20 stun per hit the meter rarely reaches 100.

## 4. What was tried

**Dodge, 30 settings:**
- Base 5–25%, 1–3% per DEX point.
- Delta in DEX points (owner) or signed: a slower defender dodges below the base.
- An earlier sweep tested a percentage lead. It made DEX dominance worse (faster fighter wins 68–74%) and was rejected.
- Higher per-point values also raise DEX dominance.
- A flat base gives everyone the option without favouring the faster fighter.

**Stun, 30 settings on each of the 4 best dodge settings:**
- Gain scale ×1.5–×2.5.
- Extra damage 25 / 50 / 75%.
- Weapon stun-boost ×1 or ×3.

## 5. Confirmation — paired, population `lab-confirm`

| Candidate | Stun effect mid / late (pp) | Holder lands stun mid / late | Chains mid / late | Stuns per fight |
|---|---|---|---|---|
| Owner original | +0.5 / +0.3 | 9% / 7% | 0% / 0.1% | 0.03 |
| B: stun ×1.5, boost ×3 | +3.3 / +2.3 | 43% / 33% | 2.0% / 2.1% | 0.13 |
| **C: stun ×1.75 (chosen)** | **+4.2 / +2.7** | **48% / 37%** | **4.5% / 3.4%** | 0.15 |
| D: stun ×2, extra 50% | +6.5 / +4.3 | 57% / 46% | 5.1% / 3.6% | 0.18–0.20 |

Dodge at base 10% + 2% per point, early / mid / late:

| Measure | Value |
|---|---|
| Dodge success | 12% / 20% / 24% |
| Always-dodge style win | 50.7% / 47.4% / 50.2% |
| Always-block style win | 48.3% / 46.4% / 48.0% |
| Smart players' dodge share | 92% / 49% / 38% |
| Faster fighter wins | 60.6% / 62.4% / 62.4% (V2: 61.9 / 61.4 / 62.5) |

**Why C:**
- B makes stun too rare; D starts chaining (above 5%).
- C lands a stun in about 4 of 10 stun-weapon fights, changes the holder's win rate by +3–4 pp, keeps chains under 5%, and leaves stun gear at V2's win level (late: 60.6% vs V2 61.1%).

**Reproduces on the fresh population `lab-verify`:**

| Measure | mid | late |
|---|---|---|
| Stun effect | +3.3 pp | +2.9 pp |
| Holder lands stun | 44% | 39% |
| Chains | 3.3% | 5.1% (borderline) |

- Dodge success 12 / 20 / 24%.
- Dodge vs block styles: 50.7 vs 47.9, 49.4 vs 50.2, 46.5 vs 49.0.

**Per stun weapon** (`lab-weapons`, share of fights where the holder lands a stun, mid + late):

| Weapon | Lands a stun |
|---|---|
| Iron Club | 38% |
| Flail | 33% |
| Mace | 31% |
| Warhammer | 22% |
| Wooden Club | 0% (cannot stun; boost only) |

## 6. Findings that need the owner (not changed)

1. **Round stalls (new decision D-19).**
   - Two badly built ranged fighters (Bow + Great Shield + heavy armour: effective DEX 1, so each shot does about 0.004 damage) can never finish a round. With 70% blocks there are 1–3 such fights per 30,000 late-stage fights.
   - V2 survived because unblocked pierce shots added up.
   - In the real game this would hit the safety guard and fail the round.
   - **Proposal:** a turn limit. After turn 30, the fighter with the higher HP share wins.
2. **Warhammer stuns least of the stun weapons**, despite the biggest Stun Boost.
   - The owner formula feeds stun from "attack shaved off", and a huge hit has little shaved off. It also kills quickly and is slow (DEX −3).
   - If the Warhammer should be the stun weapon, options are: the boost added after the min(1, …) cap, or a can-stun weapon bonus.
3. **Early game defences are thin.**
   - Block at level 1 is 5% (raw DEF 10 × 0.5%) plus 10% with a Wood Shield.
   - Dodge is 10% with the new base.
   - That is acceptable for round 1, which is meant to be fast, but early fights are still mostly damage races.
4. **Big imbalances that are not stun/dodge.** Late-stage win rate vs the population:

   | Group | V2 | V3 |
   |---|---|---|
   | Hybrid (ranged + melee) | 70.9% | 68.9% |
   | Ranged only | 29% | 35% |
   | Ranged + shield | 17% | 20% |
   | Heavy armour | 35% | 34% |
   | Shield only | 15.1% | 18.0% |
   | Unarmed | 12.4% | 11.0% |

   - Builds that put most points into DEX still win about 57% vs 48%.
   - These are gear/DEX balance (V2_BALANCE §4 #1–#6). V3 mechanics narrowed them only slightly.
5. **Selection bias warning.** "A stunner wins 93–98% of fights where it lands a stun" is true but misleading: landing a stun requires landing many hits. Only the paired on/off effect measures what stun changes, and that is what was scored.

## 7. Next

- **Phase C1 continues:**
  - shared `playRound`;
  - V3 defence/stim policies for the run agents and the boss;
  - paired V2/V3 full runs against the boss;
  - DEX-benefit ablation.
- Then Phase C2 (catalogue live, starting gold 10, DB/API).
