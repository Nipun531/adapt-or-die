# V3 Baseline — the V2 control (Phase A, 2026-10-19)

**What this is.** The reference every V3 change is compared against, on the same seed lists.

**Setup:**
- Engine 2.0.0, boss policy `v2-diverse`, `sim-2.2.0`, baseline predictor.
- Code at `8ab0229`, plus Phase A's behaviour-neutral chooser redaction (proven identical below).
- Pure in-memory harness: no DB.

**Reproduce:** `npm run v3:baseline`. Defaults: `--runs 100 --rounds 10 --seed v3-baseline --mirror-r1 2000`; 265 s.
- Output: `artifacts/balance/v3-baseline-v3-baseline-100x10.json` (copy committed in `docs/v3-baseline/`).
- Results sha256 `7b3dacfa2a4e7d1322233dfebf63be7d2a6234852e8911c7e8f6d15b36d5d541`.
- Seeds: `v3-baseline:<agent>:<i>`. Mirror round-1 seeds: `v3-baseline:mirror-r1:<i>`.

**Method** (plan §H.4):
- The unit is the **run**. Win rates and margins get a run-level bootstrap 95% CI (2,000 resamples, seeded).
- Single proportions get a Wilson 95% CI.
- Stages: rounds 1–2, 3–5, 6–10.

**Agents.** 11 scripted agents, none of which search. Plus **mirror**: the player uses the boss's own policy, with the same information.

## 1. Boss results by opponent

| Agent | Boss win (95% CI) | Round 1 | r1–2 | r3–5 | r6–10 | Player comeback* | Round-1 winner wins the run |
|---|---|---|---|---|---|---|---|
| melee_bruiser | 100% [100–100] | 100% [96.3–100] | 100% | 100% | 100% | 0% | 100% |
| archer | 100% [100–100] | 100% [96.3–100] | 100% | 100% | 100% | 0% | 100% |
| shield_turtle | 100% [100–100] | 100% [96.3–100] | 100% | 100% | 100% | 0% | 100% |
| hybrid | 100% [100–100] | 100% [96.3–100] | 100% | 100% | 100% | 0% | 100% |
| adaptive | 100% [100–100] | 100% [96.3–100] | 100% | 100% | 100% | 0% | 100% |
| piercer | 100% [100–100] | 100% [96.3–100] | 100% | 100% | 100% | 0% | 100% |
| duelist | 98.5% [97.8–99.1] | 99.0% [94.6–99.8] | 99.5% | 95.3% | 100% | 1.6% [0.9–2.4] | 99% |
| opportunist | 100% [100–100] | 100% [96.3–100] | 100% | 100% | 100% | 0% | 100% |
| switcher | 100% [100–100] | 100% [96.3–100] | 100% | 100% | 100% | 0% | 100% |
| reactive | 100% [100–100] | 100% [96.3–100] | 100% | 100% | 100% | 0% | 100% |
| random | 98.0% [97.0–98.9] | 83.0% [74.5–89.1] | 91.0% | 99.3% | 100% | 0.1% [0–0.3] | 83% |
| **mirror** | **45.2% [35.4–55.0]** | 45.0% [35.6–54.8] | 45.0% | 45.3% | 45.2% | 0.5% [0–1.5] | **100%** |

\* Player comeback = P(the player wins round n+1 | the player lost round n). For mirror, the boss comeback is 0.4% [0–1.2].

## 2. Findings

### F1. Round 1 is a coin flip, not a boss edge (plan D-16 resolved)
- Mirror round 1 over 2,000 seeds: the boss wins **49.8% [47.6–51.9]**. The earlier "60%" came from 20 runs (CI ±22 pp) and was noise.
- In **1,986 of 2,000** round-1 fights both fighters had equal effective DEX.
- **The first mover won 100% [99.8–100] of them.**
- The initiative coin flip itself is fair (boss first 49.9%).
- Why: with equal DEX the mitigation is exactly 0, and round-1 fighters are unarmed (0 gold), so there is no pierce. The fight has **no randomness**: identical fighters, and whoever strikes first wins.
- In the 14 fights where one side invested in DEX, the faster side lost all 14. Small n, but it means a DEX point in round 1 is worth less than STR/HP.

### F2. The snowball decides the run
- In the mirror (equal intelligence), the round-1 winner **won the run in 100% of runs**, and comebacks happen 0.4–0.5% of the time.
- Against agents, player comeback is 0–1.6%.
- Causes: the winner gets more XP and gold (50/10 vs 30/5), levels up first (+20 gold, +stats) and buys better gear first. The gap compounds.
- So **one coin flip in round 1 decides a 10-round run between equal players.**
- V3 mechanics alone may not fix this. Economy/comeback is a separate lever (plan D-17), to be measured in Phase C1/D.

### F3. One boss archetype dominates late game
- In rounds 6–10 the boss picks the **hybrid** archetype (ranged weapon + melee weapon, usually Crossbow + Leather + Rapier/Sabre/LongSword) in **94–100% of rounds against every opponent**, the mirror included (99%).
- Builds vary inside the archetype (build entropy about 2.4–3.8 bits), but the strategy does not.
- This fails the plan's diversity criterion (no build/archetype > 40%).

### F4. Late rounds are one-sided
- Mean boss HP margin in rounds 6–10 is 0.76–1.00 against agents; 1.00 means the boss ends at full HP.
- Rounds last 3.0–3.8 attacks; the boss's median DEX lead is 10–35.
- The boss usually wins **without taking a hit**: the DEX lead gives it the First Shot plus the first action plus bonus attacks.
- Pierce is 0.6–6.4% of damage.

### F5. What this means for "is the boss overpowered?"
- Against scripted agents the boss is overwhelming: 98–100%, with zero comebacks.
- Against an equal opponent (mirror) it is **not** stronger: 45% [35–55].
- The dominance therefore comes from four sources:
  - agent quality (agents don't search);
  - a determinism and first-mover problem (F1);
  - the snowball (F2);
  - a single dominant archetype that the rules allow (F3, F4, DEX stacking).
- It does not come from hidden information. Chooser redaction is in place; see §3.
- V3 must be judged on all four. A lower boss win rate alone is not success.

## 3. Phase A changes and their proof

| Change | Proof |
|---|---|
| Chooser redaction: `ChoiceContext.view` (`ChooserView`: fighters, hp, initiative, seq) replaces the full `CombatState`, so no chooser can read `rngState`, the seed or the opponent's `autoMode` (`game/combat.ts`; boss `policy.ts` and agents `agents.ts` updated) | New tests in `combat.test.ts`. A 240-run in-memory batch (seeds `v3plan:*`, `docs/v3-plan-evidence/stat-scales.ts`) gives **byte-identical** output before and after the change |
| `npm run v3:baseline` (`sim/v3-baseline.ts` lib + `v3-baseline-cli.ts`) | `tests/unit/v3-baseline.test.ts` (Wilson, cluster bootstrap, entropy, reproducibility) |
| Dev DB backup `artifacts/backups/pre-v3-2026-10-19.sql`: 273,142,347 bytes, sha256 `8561d22deed41e67228c34eae677daa78ee76b4421746f3d52953f1b89adc528` | Restored into a scratch DB (then dropped). Row counts identical: runs 1,364 · rounds 13,566 · combat_events 72,429 · training_examples 17,242 · model_versions 5 |

Restore (into an empty DB):
```bash
docker exec -i boss-remembers-db psql -U boss boss_remembers < artifacts/backups/pre-v3-2026-10-19.sql
```

**Not done in Phase A (moved to Phase C1):** the DEX-benefit ablation (mitigation / bonus attacks / turn order / First Shot off one at a time). It needs the RuleSet switch from Phase B, and adding toggles to the live engine now would change the code path that this baseline is meant to freeze.
