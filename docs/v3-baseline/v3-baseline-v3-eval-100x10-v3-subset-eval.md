# V3 boss evaluation — v3-baseline (rules v3)

Source: `artifacts/balance/v3-baseline-v3-eval-100x10-v3-subset.json` ({"runs":100,"rounds":10,"seed":"v3-eval","seedPattern":"v3-eval:<strategy>:<i>","mirrorR1":1000,"mirrorR1Pattern":"v3-eval:mirror-r1:<i>","bootstrap":2000})

| Area | Criterion | Result | Pass |
|---|---|---|---|
| Competitive fairness | mirror: boss win 45–60% overall and in round 1 | 49.3% [40.6%–57.1%]; round 1 44.0% [34.7%–53.8%] | ✓ |
| Competitive fairness | mirror_sym: boss win 45–60% overall and in round 1 | 48.8% [40.6%–56.9%]; round 1 45.0% [35.6%–54.8%] | ✓ |
| Difficulty by opponent tier | T0 melee_bruiser: boss win 70.0%–90.0% | 95.5% [93.7%–97.1%] | ✗ |
| Difficulty by opponent tier | T0 archer: boss win 70.0%–90.0% | 99.4% [98.9%–99.8%] | ✗ |
| Difficulty by opponent tier | T0 shield_turtle: boss win 70.0%–90.0% | 98.6% [97.6%–99.5%] | ✗ |
| Difficulty by opponent tier | T0 hybrid: boss win 70.0%–90.0% | 96.7% [93.4%–99.4%] | ✗ |
| Difficulty by opponent tier | T0 piercer: boss win 70.0%–90.0% | 95.0% [93.1%–96.7%] | ✗ |
| Difficulty by opponent tier | T0 duelist: boss win 70.0%–90.0% | 76.5% [71.5%–81.4%] | ✓ |
| Difficulty by opponent tier | T0 random: boss win 70.0%–90.0% | 97.7% [95.9%–99.0%] | ✗ |
| Difficulty by opponent tier | T1 blocker: boss win 55.0%–75.0% | 99.5% [99.1%–99.9%] | ✗ |
| Difficulty by opponent tier | T1 dodger: boss win 55.0%–75.0% | 97.6% [96.4%–98.7%] | ✗ |
| Difficulty by opponent tier | T1 stunner: boss win 55.0%–75.0% | 97.7% [96.6%–98.7%] | ✗ |
| Difficulty by opponent tier | T1 healer: boss win 55.0%–75.0% | 88.8% [85.1%–92.2%] | ✗ |
| Difficulty by opponent tier | T1 counter_puncher: boss win 55.0%–75.0% | 86.4% [82.8%–89.7%] | ✗ |
| Difficulty by opponent tier | T2 adaptive: boss win 55.0%–75.0% | 95.4% [93.5%–97.0%] | ✗ |
| Difficulty by opponent tier | T2 opportunist: boss win 55.0%–75.0% | 94.4% [91.9%–96.5%] | ✗ |
| Difficulty by opponent tier | T2 switcher: boss win 55.0%–75.0% | 95.8% [94.2%–97.2%] | ✗ |
| Difficulty by opponent tier | T2 reactive: boss win 55.0%–75.0% | 96.4% [94.3%–98.1%] | ✗ |
| Difficulty by opponent tier | T3 mirror: boss win 35.0%–60.0% | 49.3% [40.6%–57.1%] | ✓ |
| Difficulty by opponent tier | T3 mirror_sym: boss win 35.0%–60.0% | 48.8% [40.6%–56.9%] | ✓ |
| Counterplay | blocker: player wins ≥ 35% of rounds 3–10 | player 0.4% | ✗ |
| Counterplay | dodger: player wins ≥ 35% of rounds 3–10 | player 1.1% | ✗ |
| Counterplay | stunner: player wins ≥ 35% of rounds 3–10 | player 0.7% | ✗ |
| Counterplay | healer: player wins ≥ 35% of rounds 3–10 | player 7.1% | ✗ |
| Counterplay | counter_puncher: player wins ≥ 35% of rounds 3–10 | player 11.3% | ✗ |
| Strategic diversity | top boss archetype ≤ 40% of rounds 3–10 (all opponents) | hybrid 90.7% | ✗ |
| Strategic diversity | ≥ 3 boss archetypes each ≥ 10% | hybrid 90.7%, bruiser 5.6%, duelist 1.8%, marksman 1.5%, bulwark 0.3% | ✗ |
| Adaptation | boss archetype mix differs between T1 opponents (≥ 4 of 5 at p < 0.01) | overall χ² 277.4 (df 16, p <0.0001); 5/5 differ: blocker JS 0.014, p <0.0001; dodger JS 0.017, p <0.0001; stunner JS 0.018, p <0.0001; healer JS 0.023, p <0.0001; counter_puncher JS 0.029, p <0.0001 | ✓ |
| No exploits | stun chains (a fighter stunned 2+ times in a round) ≤ 2% of rounds | 0.3% | ✓ |
| No exploits | HP healed ≤ 25% of damage dealt | 2.9% | ✓ |
| No exploits | rounds decided by the turn limit ≤ 2% | 0.0% | ✓ |

### V3 mechanics per opponent (all rounds)

| Opponent | Boss win | Player block ok | Player dodge ok | Boss block ok | Boss dodge ok | Counters P/B per round | Stuns on P/B per round | Stims P/B per round | Counter dmg share |
|---|---|---|---|---|---|---|---|---|---|
| melee_bruiser | 95.5% | — | 10.4% (3978) | 16.7% (144) | 27.2% (1102) | 0.00 / 0.01 | 0.00 / 0.00 | 0.01 / 0.08 | 0.3% |
| archer | 99.4% | — | 12.5% (3999) | 14.4% (187) | 21.8% (1580) | 0.00 / 0.00 | 0.00 / 0.00 | 0.19 / 0.07 | 0.0% |
| shield_turtle | 98.6% | 22.5% (4959) | — | 13.8% (356) | 35.7% (1533) | 0.24 / 0.04 | 0.30 / 0.00 | 0.00 / 0.16 | 5.2% |
| hybrid | 96.7% | — | 11.6% (3879) | 16.1% (137) | 25.7% (1543) | 0.00 / 0.01 | 0.00 / 0.00 | 0.09 / 0.17 | 0.4% |
| adaptive | 95.4% | — | 10.9% (3889) | 16.8% (161) | 27.0% (1151) | 0.01 / 0.01 | 0.00 / 0.00 | 0.01 / 0.07 | 0.4% |
| piercer | 95.0% | 15.7% (2591) | 10.9% (1363) | 15.3% (216) | 30.2% (1171) | 0.08 / 0.02 | 0.04 / 0.00 | 0.09 / 0.15 | 2.8% |
| duelist | 76.5% | — | 16.1% (3761) | 16.7% (462) | 18.6% (2070) | 0.00 / 0.04 | 0.00 / 0.00 | 0.14 / 0.30 | 1.2% |
| opportunist | 94.4% | — | 10.8% (3902) | 12.2% (172) | 23.9% (1333) | 0.00 / 0.01 | 0.00 / 0.00 | 0.06 / 0.06 | 0.3% |
| switcher | 95.8% | 5.9% (1905) | 10.3% (1934) | 12.7% (166) | 30.9% (1108) | 0.01 / 0.01 | 0.00 / 0.00 | 0.01 / 0.06 | 0.8% |
| reactive | 96.4% | 4.3% (23) | 10.8% (3884) | 14.8% (210) | 26.2% (1220) | 0.01 / 0.01 | 0.00 / 0.00 | 0.04 / 0.06 | 0.6% |
| random | 97.7% | 9.0% (1890) | 12.3% (1949) | 10.9% (211) | 28.4% (1098) | 0.03 / 0.01 | 0.01 / 0.00 | 0.10 / 0.06 | 0.8% |
| blocker | 99.5% | 23.5% (5406) | — | 17.1% (316) | 44.7% (1379) | 0.30 / 0.04 | 0.33 / 0.00 | 0.00 / 0.14 | 6.4% |
| dodger | 97.6% | — | 11.4% (3799) | 17.3% (278) | 24.2% (1165) | 0.04 / 0.03 | 0.00 / 0.00 | 0.16 / 0.12 | 1.7% |
| stunner | 97.7% | — | 9.9% (3960) | 5.1% (39) | 35.5% (1028) | 0.00 / 0.02 | 0.00 / 0.02 | 0.03 / 0.05 | 0.3% |
| healer | 88.8% | 6.9% (29) | 10.4% (4154) | 19.7% (173) | 32.8% (1198) | 0.00 / 0.02 | 0.00 / 0.00 | 0.27 / 0.09 | 0.4% |
| counter_puncher | 86.4% | 21.5% (5066) | — | 17.0% (171) | 43.2% (1403) | 0.18 / 0.01 | 0.17 / 0.00 | 0.16 / 0.18 | 7.6% |
| mirror | 49.3% | 16.7% (342) | 15.4% (2435) | 13.7% (306) | 15.4% (2475) | 0.01 / 0.01 | 0.01 / 0.01 | 0.05 / 0.22 | 0.7% |
| mirror_sym | 48.8% | 16.7% (360) | 14.6% (2423) | 18.2% (418) | 17.5% (2413) | 0.02 / 0.01 | 0.00 / 0.01 | 0.03 / 0.22 | 0.8% |

### Boss archetype mix, rounds 3–10, per opponent

| Opponent | Archetypes | Top late build |
|---|---|---|
| melee_bruiser | hybrid 95.8%, bruiser 2.9%, duelist 1.0%, marksman 0.4% | Crossbow + Leather Armor + LongSword (19.4%) |
| archer | hybrid 98.3%, bruiser 0.6%, marksman 0.6%, duelist 0.4%, bulwark 0.1% | Crossbow + Leather Armor + Rapier (24.8%) |
| shield_turtle | hybrid 87.0%, bruiser 8.6%, marksman 4.1%, duelist 0.3% | Crossbow + Leather Armor + Mace (31.4%) |
| hybrid | hybrid 97.6%, bruiser 1.4%, duelist 0.6%, marksman 0.4% | Crossbow + Leather Armor + Sabre (20.8%) |
| adaptive | hybrid 94.8%, bruiser 2.9%, duelist 1.6%, marksman 0.6%, bulwark 0.1% | Crossbow + Leather Armor + Sabre (19.8%) |
| piercer | hybrid 86.6%, bruiser 7.0%, duelist 2.8%, marksman 2.3%, bulwark 1.4% | Crossbow + Leather Armor + Mace (21.8%) |
| duelist | hybrid 77.5%, bruiser 18.0%, duelist 3.6%, bulwark 0.9% | Crossbow + Leather Armor + Sabre (29.6%) |
| opportunist | hybrid 95.9%, bruiser 2.9%, duelist 1.0%, marksman 0.3% | Crossbow + Leather Armor + Sabre (24.8%) |
| switcher | hybrid 95.9%, bruiser 3.0%, duelist 1.1% | Crossbow + Leather Armor + Sabre (19.8%) |
| reactive | hybrid 94.3%, bruiser 3.5%, duelist 1.3%, bulwark 0.5%, marksman 0.5% | Crossbow + Leather Armor + Sabre (18.8%) |
| random | hybrid 94.4%, bruiser 2.0%, marksman 1.8%, duelist 1.6%, bulwark 0.3% | Crossbow + Leather Armor + Sabre (17.8%) |
| blocker | hybrid 89.8%, bruiser 5.4%, marksman 4.9% | Crossbow + Leather Armor + Mace (36.8%) |
| dodger | hybrid 87.8%, bruiser 7.4%, duelist 2.1%, bulwark 1.8%, marksman 1.0% | Crossbow + Leather Armor + Sabre (18.2%) |
| stunner | hybrid 95.0%, bruiser 3.4%, duelist 1.0%, bulwark 0.4%, marksman 0.3% | Crossbow + Leather Armor + Sabre (25.6%) |
| healer | hybrid 92.8%, bruiser 3.9%, duelist 3.1%, marksman 0.3% | Crossbow + Leather Armor + Sabre (15.6%) |
| counter_puncher | hybrid 83.4%, marksman 10.5%, bruiser 4.8%, duelist 1.3%, bulwark 0.1% | Crossbow + Leather Armor + Mace (27.4%) |
| mirror | hybrid 84.8%, bruiser 10.4%, duelist 4.8%, marksman 0.1% | Crossbow + Leather Armor + Sabre (17.4%) |
| mirror_sym | hybrid 81.8%, bruiser 12.5%, duelist 5.1%, bulwark 0.6% | Crossbow + Leather Armor + Sabre (19.0%) |

### Boss round-1 plans (all opponents)

- +1 STR +1 DEX; Sword: 38.6%
- +2 STR; Sword: 35.8%
- +2 DEX; Sword: 25.6%
