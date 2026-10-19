# V3 boss evaluation — v3-baseline (rules v3)

Source: `artifacts/balance/d2/v3-baseline-v3-eval-100x10-v3-subset.json` ({"runs":100,"rounds":10,"seed":"v3-eval","seedPattern":"v3-eval:<strategy>:<i>","mirrorR1":1000,"mirrorR1Pattern":"v3-eval:mirror-r1:<i>","bootstrap":2000})

| Area | Criterion | Result | Pass |
|---|---|---|---|
| Competitive fairness | mirror: boss win 45–60% overall and in round 1 | 50.1% [42.1%–58.0%]; round 1 44.0% [34.7%–53.8%] | ✓ |
| Competitive fairness | mirror_sym: boss win 45–60% overall and in round 1 | 48.5% [41.2%–56.2%]; round 1 45.0% [35.6%–54.8%] | ✓ |
| Difficulty by opponent tier | T0 melee_bruiser: boss win 70.0%–90.0% | 94.1% [92.3%–95.8%] | ✗ |
| Difficulty by opponent tier | T0 archer: boss win 70.0%–90.0% | 98.2% [97.3%–99.0%] | ✗ |
| Difficulty by opponent tier | T0 shield_turtle: boss win 70.0%–90.0% | 98.3% [97.2%–99.3%] | ✗ |
| Difficulty by opponent tier | T0 hybrid: boss win 70.0%–90.0% | 98.3% [96.4%–99.5%] | ✗ |
| Difficulty by opponent tier | T0 piercer: boss win 70.0%–90.0% | 94.5% [92.5%–96.4%] | ✗ |
| Difficulty by opponent tier | T0 duelist: boss win 70.0%–90.0% | 64.3% [58.1%–70.6%] | ✗ |
| Difficulty by opponent tier | T0 random: boss win 70.0%–90.0% | 97.4% [95.8%–98.6%] | ✗ |
| Difficulty by opponent tier | T1 blocker: boss win 55.0%–75.0% | 99.0% [98.4%–99.6%] | ✗ |
| Difficulty by opponent tier | T1 dodger: boss win 55.0%–75.0% | 97.2% [95.7%–98.5%] | ✗ |
| Difficulty by opponent tier | T1 stunner: boss win 55.0%–75.0% | 95.8% [94.4%–97.1%] | ✗ |
| Difficulty by opponent tier | T1 healer: boss win 55.0%–75.0% | 84.7% [79.7%–89.2%] | ✗ |
| Difficulty by opponent tier | T1 counter_puncher: boss win 55.0%–75.0% | 83.7% [79.2%–87.8%] | ✗ |
| Difficulty by opponent tier | T2 adaptive: boss win 55.0%–75.0% | 95.0% [93.3%–96.6%] | ✗ |
| Difficulty by opponent tier | T2 opportunist: boss win 55.0%–75.0% | 93.8% [91.2%–96.0%] | ✗ |
| Difficulty by opponent tier | T2 switcher: boss win 55.0%–75.0% | 95.2% [93.5%–96.7%] | ✗ |
| Difficulty by opponent tier | T2 reactive: boss win 55.0%–75.0% | 96.2% [94.1%–98.0%] | ✗ |
| Difficulty by opponent tier | T3 mirror: boss win 35.0%–60.0% | 50.1% [42.1%–58.0%] | ✓ |
| Difficulty by opponent tier | T3 mirror_sym: boss win 35.0%–60.0% | 48.5% [41.2%–56.2%] | ✓ |
| Counterplay | blocker: player wins ≥ 35% of rounds 3–10 | player 1.0% | ✗ |
| Counterplay | dodger: player wins ≥ 35% of rounds 3–10 | player 1.6% | ✗ |
| Counterplay | stunner: player wins ≥ 35% of rounds 3–10 | player 3.1% | ✗ |
| Counterplay | healer: player wins ≥ 35% of rounds 3–10 | player 12.3% | ✗ |
| Counterplay | counter_puncher: player wins ≥ 35% of rounds 3–10 | player 14.6% | ✗ |
| Strategic diversity | top boss archetype ≤ 40% of rounds 3–10 (all opponents) | hybrid 77.4% | ✗ |
| Strategic diversity | ≥ 3 boss archetypes each ≥ 10% | hybrid 77.4%, bruiser 12.2%, duelist 5.3%, marksman 2.6%, bulwark 1.3%, piercer 1.1% | ✗ |
| Adaptation | boss archetype mix differs between T1 opponents (≥ 4 of 5 at p < 0.01) | overall χ² 285.3 (df 20, p <0.0001); 5/5 differ: blocker JS 0.029, p <0.0001; dodger JS 0.015, p <0.0001; stunner JS 0.020, p <0.0001; healer JS 0.023, p <0.0001; counter_puncher JS 0.017, p <0.0001 | ✓ |
| No exploits | stun chains (a fighter stunned 2+ times in a round) ≤ 2% of rounds | 0.1% | ✓ |
| No exploits | HP healed ≤ 25% of damage dealt | 4.1% | ✓ |
| No exploits | rounds decided by the turn limit ≤ 2% | 0.0% | ✓ |

### V3 mechanics per opponent (all rounds)

| Opponent | Boss win | Player block ok | Player dodge ok | Boss block ok | Boss dodge ok | Counters P/B per round | Stuns on P/B per round | Stims P/B per round | Counter dmg share |
|---|---|---|---|---|---|---|---|---|---|
| melee_bruiser | 94.1% | — | 10.7% (3633) | 16.9% (332) | 23.0% (1239) | 0.00 / 0.03 | 0.00 / 0.00 | 0.01 / 0.22 | 1.1% |
| archer | 98.2% | — | 11.3% (3870) | 15.8% (184) | 22.0% (1695) | 0.00 / 0.00 | 0.00 / 0.00 | 0.20 / 0.14 | 0.0% |
| shield_turtle | 98.3% | 22.4% (4889) | — | 15.6% (584) | 34.8% (1747) | 0.26 / 0.05 | 0.11 / 0.00 | 0.00 / 0.25 | 6.3% |
| hybrid | 98.3% | — | 12.1% (3917) | 14.5% (248) | 24.8% (1632) | 0.00 / 0.02 | 0.00 / 0.00 | 0.09 / 0.24 | 0.5% |
| adaptive | 95.0% | — | 11.2% (3517) | 16.5% (273) | 23.4% (1305) | 0.00 / 0.02 | 0.00 / 0.00 | 0.03 / 0.18 | 0.9% |
| piercer | 94.5% | 15.6% (2576) | 11.2% (1354) | 18.6% (220) | 26.2% (1503) | 0.09 / 0.03 | 0.01 / 0.00 | 0.11 / 0.24 | 3.5% |
| duelist | 64.3% | — | 17.9% (3665) | 16.8% (512) | 15.4% (2529) | 0.00 / 0.04 | 0.00 / 0.00 | 0.18 / 0.38 | 1.3% |
| opportunist | 93.8% | — | 11.3% (3598) | 15.0% (360) | 20.6% (1472) | 0.00 / 0.02 | 0.00 / 0.00 | 0.07 / 0.13 | 0.7% |
| switcher | 95.2% | 6.2% (1764) | 10.5% (1797) | 13.7% (328) | 24.6% (1311) | 0.01 / 0.03 | 0.00 / 0.00 | 0.02 / 0.19 | 1.4% |
| reactive | 96.2% | 0.0% (14) | 10.8% (3670) | 15.1% (378) | 24.4% (1393) | 0.01 / 0.03 | 0.00 / 0.00 | 0.05 / 0.18 | 1.1% |
| random | 97.4% | 9.3% (1783) | 12.7% (1829) | 13.6% (374) | 25.7% (1266) | 0.03 / 0.03 | 0.01 / 0.00 | 0.13 / 0.13 | 1.9% |
| blocker | 99.0% | 23.8% (5349) | — | 16.3% (387) | 43.7% (1784) | 0.30 / 0.04 | 0.16 / 0.00 | 0.00 / 0.20 | 6.5% |
| dodger | 97.2% | — | 11.7% (3785) | 16.3% (283) | 22.3% (1419) | 0.04 / 0.03 | 0.00 / 0.00 | 0.18 / 0.15 | 1.6% |
| stunner | 95.8% | — | 10.0% (3694) | 8.1% (136) | 31.2% (1164) | 0.00 / 0.02 | 0.00 / 0.03 | 0.07 / 0.17 | 0.4% |
| healer | 84.7% | 12.5% (24) | 10.2% (4062) | 17.3% (277) | 30.2% (1472) | 0.00 / 0.02 | 0.00 / 0.00 | 0.36 / 0.18 | 0.5% |
| counter_puncher | 83.7% | 21.5% (4805) | — | 15.1% (199) | 41.1% (1655) | 0.19 / 0.01 | 0.07 / 0.00 | 0.20 / 0.26 | 7.6% |
| mirror | 50.1% | 15.5% (600) | 15.3% (2366) | 18.1% (513) | 16.3% (2393) | 0.03 / 0.03 | 0.00 / 0.00 | 0.05 / 0.25 | 1.6% |
| mirror_sym | 48.5% | 16.8% (542) | 16.3% (2383) | 19.1% (564) | 17.2% (2471) | 0.03 / 0.02 | 0.00 / 0.00 | 0.04 / 0.24 | 1.7% |

### Boss archetype mix, rounds 3–10, per opponent

| Opponent | Archetypes | Top late build |
|---|---|---|
| melee_bruiser | hybrid 74.0%, bruiser 12.8%, duelist 5.4%, piercer 5.3%, bulwark 1.4%, marksman 1.3% | Crossbow + Leather Armor + Sabre (27.6%) |
| archer | hybrid 94.3%, marksman 3.3%, duelist 1.5%, bruiser 0.9%, bulwark 0.1% | Crossbow + Leather Armor + Sabre (25.8%) |
| shield_turtle | hybrid 69.3%, bruiser 20.3%, marksman 4.9%, duelist 3.4%, bulwark 1.9%, piercer 0.4% | Crossbow + Leather Armor + LongSword (24.6%) |
| hybrid | hybrid 92.0%, bruiser 3.9%, marksman 1.8%, duelist 1.8%, bulwark 0.6% | Crossbow + Leather Armor + Sabre (40.6%) |
| adaptive | hybrid 75.8%, bruiser 14.6%, duelist 5.6%, piercer 2.1%, marksman 1.0%, bulwark 0.9% | Crossbow + Leather Armor + Sabre (28.0%) |
| piercer | hybrid 78.1%, bruiser 9.3%, marksman 6.4%, duelist 3.8%, bulwark 2.5% | Crossbow + Leather Armor + LongSword (34.4%) |
| duelist | hybrid 74.3%, bruiser 20.4%, duelist 4.3%, bulwark 0.9%, marksman 0.3% | Crossbow + Leather Armor + Sabre (29.8%) |
| opportunist | hybrid 75.1%, bruiser 12.4%, duelist 6.4%, piercer 4.1%, marksman 1.3%, bulwark 0.8% | Crossbow + Leather Armor + Sabre (24.6%) |
| switcher | hybrid 75.0%, bruiser 12.3%, duelist 6.4%, piercer 4.9%, marksman 1.0%, bulwark 0.5% | Crossbow + Leather Armor + Sabre (25.0%) |
| reactive | hybrid 76.6%, bruiser 13.5%, duelist 5.3%, bulwark 2.8%, marksman 1.4%, piercer 0.5% | Crossbow + Leather Armor + Sabre (25.0%) |
| random | hybrid 79.6%, bruiser 10.6%, duelist 5.5%, bulwark 1.8%, marksman 1.8%, piercer 0.8% | Crossbow + Leather Armor + Sabre (21.2%) |
| blocker | hybrid 64.6%, bruiser 14.9%, duelist 10.6%, marksman 9.3%, bulwark 0.6% | Crossbow + Leather Armor + Mace (20.8%) |
| dodger | hybrid 84.4%, bruiser 8.9%, duelist 3.4%, marksman 1.8%, bulwark 1.6% | Crossbow + Leather Armor + Sabre (32.6%) |
| stunner | hybrid 79.3%, bruiser 11.4%, duelist 5.0%, bulwark 3.4%, marksman 1.0% | Crossbow + Leather Armor + Sabre (30.2%) |
| healer | hybrid 82.9%, bruiser 10.3%, duelist 6.3%, marksman 0.5%, bulwark 0.1% | Crossbow + Leather Armor + Sabre (26.0%) |
| counter_puncher | hybrid 74.1%, marksman 9.4%, bruiser 8.9%, duelist 7.0%, bulwark 0.4%, piercer 0.3% | Crossbow + Leather Armor + LongSword (20.0%) |
| mirror | hybrid 74.0%, bruiser 15.5%, duelist 7.6%, piercer 1.1%, bulwark 1.0%, marksman 0.8% | Crossbow + Leather Armor + Sabre (23.2%) |
| mirror_sym | hybrid 70.4%, bruiser 19.6%, duelist 6.9%, bulwark 1.9%, piercer 1.0%, marksman 0.3% | Crossbow + Leather Armor + Sabre (22.2%) |

### Boss round-1 plans (all opponents)

- +1 STR +1 DEX; Sword: 38.6%
- +2 STR; Sword: 35.8%
- +2 DEX; Sword: 25.6%
