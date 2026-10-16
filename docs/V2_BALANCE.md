# V2 Balance Report (engine 2.0.0)

**Date:** 2026-10-16
**Reproduce:** `npm run balance -- --fights 60 --runs 40`. This runs entirely in memory with no DB writes, and takes about 2.5 minutes.
**Raw output:** `artifacts/balance/report.md` and `report.json`.
**Scope (from V2_DEMANDS §11.1):**
- The user delegated the **pierce values** ("buff them so they are a valid weapon and tactic"). I tuned them.
- Everything else (costs, STR/DEF/DEX modifiers, rules) is **reported with proposals but not changed**, because those values need the user's approval.

## How it was measured

| Tool | What it does |
|---|---|
| **Weapon matrix** | Three level tiers matching the V2 economy: T1 (level 2, 30 gold), T2 (level 3, 70 gold), T3 (level 5, 140 gold). Each weapon gets its best *generic* build (stat allocation + armor + shield chosen against all opponents, not as a counter-pick). It then fights five opponent archetypes (turtle, bruiser, duelist, archer, knight) and every other affordable weapon. **Score** = mean HP margin in [−1, 1] (my HP left if I win, minus their HP left if I lose). A weapon is judged against its **price bracket**: ≤15 gold at T1, 16–30 at T2, 31–45 at T3. |
| **Full runs** | 10-round runs against the real boss policy, using the transparent baseline predictor. Covers the 8 simulated agents plus a harness-only **mirror** player that uses the boss's own policy. Mirror isolates *rule fairness* from *how smart the boss is*. |
| **Pierce tuning** (`tuneOne`) | Buff-only grid search with 5% steps, capped at 60% chance and 90% DEF ignored. Target: a weapon's score lands between its bracket's non-pierce median and its non-pierce best. That makes it a valid choice without becoming the new best. |
| **Experiments** | Temporary catalogue changes to test fixes for what pierce cannot solve. |

**Limits of this method:**
- Agents are scripted. The robust build uses an analytic pre-screen before Monte-Carlo.
- Fights are close to deterministic: a given matchup is usually won 0% or 100% of the time, which is why the score uses HP margins.
- No human play data exists yet.

## 1. Pierce values: what changed and why

| Weapon | Bracket | User value | Score | Rank | **Tuned value** | Score | Rank | Verdict |
|---|---|---|---:|---:|---|---:|---:|---|
| Spear | T1 | 10% / 25% | 0.10 | 3/7 | **35% / 35%** | 0.11 | 3/7 | Valid early polearm. Beats the early bruiser more often (72% vs 2%). |
| Bow | T1 | 30% / 30% | −0.19 | 7/7 | **55% / 90%** | 0.08 | 4/7 | Was the worst weapon in its bracket (0% vs bruiser and duelist); now mid-pack. |
| Lance | T2 | 20% / 35% | −0.06 | 5/6 | **60% / 75%** | 0.09 | 5/6 | Much better (vs bruiser 0%→40%), but still below its bracket median. |
| Flail | T2 | 20% / 50% | −0.08 | 6/6 | **45% / 90%** | 0.00 | 6/6 | Much better (vs duelist 32%→78%), but still last. |
| Crossbow | T2 | 25% / 45% | 0.51 | 1/6 | **unchanged** | 0.50 | 1/6 | Already the best mid weapon. A buff would make it worse for balance. |
| Rapier | T3 | 5% / 70% | 0.45 | 1/5 | **unchanged** | 0.40 | 1/5 | Already the best late weapon. |
| Longbow | T3 | 40% / 55% | 0.13 | 4/5 | **45% / 60%** | 0.20 | 3/5 | Valid late ranged pick. |
| Pike | T3 | 35% / 60% | 0.05 | 5/5 | **60% / 90%** | 0.12 | 5/5 | Better, but still last. |

**Result against AC-BAL-1:**
- Bow, Spear and Longbow are now valid.
- Crossbow and Rapier were already above the target.
- **Flail, Lance and Pike cannot reach their bracket median through pierce alone.** Even at 100% chance / 100% DEF ignored, Lance and Flail only reach about 0.25 and Pike about 0.37. I stopped at 60%/90% so pierce stays a chance-based mechanic rather than "ignores armor".

## 2. Why pierce barely matters (root cause)

Even after the buffs, **pierce adds only 1–3% of all damage dealt** in full runs (0–1% with the user's original values). The reason is the DEX system, not the pierce numbers:

- **Heavy gear sends Effective DEX to the floor.** Examples of Effective DEX at T3:
  - Mace + Great Shield + Heavy Armor turtle: **1**;
  - Warhammer bruiser: **1**;
  - GreatSword knight: **1**;
  - Rapier duelist: 30.
- **A DEX gap of 30 or more gives the faster side +2 extra attacks every turn**, acts first, and lets it mitigate hits by up to 50%.
- **DEF-stacking builds therefore lose to almost everything.** The turtle archetype loses to nearly every weapon, so a weapon whose job is to break armor has no worthwhile target.
- Players and the boss rarely wear heavy gear at all. In full runs, Heavy Armor was equipped in 4 player rounds and 0 boss rounds; Great Shield in 0 and 0.
- With low DEF on the field, A²/(A+D) is dominated by attack, so ignoring DEF adds little.

**Usage in full runs** (rounds equipped, player / boss): Longbow **0 / 0**, Pike **0 / 0**, Flail 5 / 0, Lance 81 / 0. The boss's most used items were Crossbow (1,581), LongSword (1,517) and Leather Armor (2,152).

## 3. Who wins: boss vs players (tuned values, 40 runs per strategy)

| Player | Boss win rate | Boss wins round 1 |
|---|---:|---:|
| melee_bruiser | 93% | 100% |
| archer | 100% | 100% |
| shield_turtle | 100% | 100% |
| hybrid | 94% | 100% |
| adaptive | 94% | 100% |
| piercer | 100% | 100% |
| duelist | 79% | 100% |
| random | 98% | 98% |
| **mirror (same policy as the boss)** | **45%** | **40%** |

- **The rules are roughly fair.** A player with the boss's own intelligence wins about half the time (45% boss wins here; 44–56% across all experiments).
- **The 79–100% boss win rate against agents is an intelligence gap.** The boss counter-builds against the player's last build using Monte-Carlo fights; scripted agents never adapt. Tuning item values will not reach the approved 55–70% target band without breaking fairness for human players.
- **Round 1 is a near-guaranteed boss win** against every scripted agent (it always takes +2 STR; see V2_DEMANDS §6). Because the winner gets more XP and gold, this starts a snowball.

## 4. Areas that need fixing (ranked) — need your decision

| # | Problem | Evidence | Proposed fix | Tested? |
|---|---|---|---|---|
| 1 | **DEX dominates. Heavy gear DEX penalties are fatal**, so DEF builds and armor-breaking are pointless. | Heavy-gear builds sit at Eff. DEX 1; pierce is 1–3% of damage; Heavy Armor and Great Shield are almost never used. | Choose one: (a) raise the DEX bonus-attack thresholds from 15/30 to 25/50; (b) halve the DEX penalties of Heavy Armor, Great Shield and Small Shield; (c) a softer Effective-DEX floor. | (a) ad-hoc run: Lance rose to 3/6 and Pike to 3/5, but ranged collapsed (Crossbow 6/6, Longbow 5/5); mirror 51%. (b) = E3: Lance rose to 2/6, little else changed. **Option (a) needs ranged re-tuning after it. I recommend testing (a) together with a ranged follow-up before choosing.** |
| 2 | **Flail, Lance and Pike are underpowered** even with maxed pierce. | §1 table | Flail STR +4→+6, Lance STR +5→+7 (E1); Pike STR +7→+9 (E4). | E1: Lance moves to **3/6**, Flail to **5/6** (score 0.19 vs LongSword 0.18). E4: Pike moves to **2/5** (0.23, just above Warhammer). These are the smallest changes that make them valid. |
| 3 | **Crossbow is too strong** in the mid game. It is the best weapon in its bracket, and the boss uses it as a DEX accessory next to a melee weapon. | Rank 1/6 (0.50 vs Sabre 0.43); 1,581 boss rounds equipped. | DEX +4→+3 over-corrects (it drops to 6/6, E2). Next candidates to test: cost 28→34, or DEX +4 kept with First Shot only on ranged-only loadouts. | Partly (E2). |
| 4 | **Rapier is too strong** in the late game. It is the only late weapon without a DEX penalty. | Rank 1/5 (0.40 vs 0.22 for the next weapon). DEX +3→+2 alone still leaves it 1/5 (0.35). | Test DEX +3→+2 *and* STR +6→+5 together. | Partly (E2). |
| 5 | **Snowball / boss vs scripted agents.** | §3 | This cannot be fixed with item values. It needs Phase 4 (feasibility-based prediction, scenarios the player can actually reach, controlled diversity), which also removes the fixed round-1 +2 STR, plus smarter agents. Re-measure the 55–70% target after Phase 4. | No (Phase 4) |
| 6 | **Dead or weak items:** Knuckle (worst early weapon), Iron Club and Wooden Club fall off fast, Great Shield and Heavy Armor are unused. | Usage table; T1 ranks | Mostly fixed by #1. Knuckle can stay as a 3-gold starter. | Via #1 |
| 7 | **Late items arrive late for losing players.** | Always-lose path: about 90 gold by round 10 (V2_DEMANDS §3.3). A 42-gold Pike or Longbow costs about half of everything a losing player earns in a run. | Optional: level-up gold back to 25, or a 5–10% cheaper late tier. Only if #2 and #4 are done first. | No |

**What I changed vs what I only propose:**
- **Changed (delegated):** the pierce values in §1.
- **Proposed only (need approval):** #1–#4 and #7, because they change your costs, modifiers or core rules.

## 5. Suggested next balance step

1. Decide on #1 (DEX dominance). It changes everything downstream.
2. Then apply #2 (Flail, Lance, Pike STR) and re-run `npm run balance`. Re-check Crossbow (#3) and Rapier (#4) under the new DEX rule before nerfing them.
3. Do Phase 4 (boss policy), then re-measure the boss win rate against agents and mirror.
