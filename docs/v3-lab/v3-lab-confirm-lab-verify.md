# V3 lab — confirm (seed "lab-verify", 1500 builds × 30000 fights per stage)

| Variant | Score (0 = all targets met) | Early dodge: success / smart dodge share / dodge-style vs block-style win | Mid dodge | Late dodge | Mid stun: holder lands ≥1 / extra-dmg share / chains / holder win landed vs not | Late stun | Faster fighter wins (E/M/L) | Attacks per fight (E/M/L) |
|---|---|---|---|---|---|---|---|---|
| V2 (control) | — | — / — / 50.1% vs 49.5% | — / — / 50.2% vs 51.8% | — / — / 49.0% vs 51.2% | 0.0% / 0.0% / 0.0% / — vs 67.9% | 0.0% / 0.0% / 0.0% / — vs 59.2% | 61.6% / 61.2% / 64.7% | 13.0 / 9.9 / 10.3 |
| V3 default (tuned sweet spot) | 6.61 | 12.4% / 90.1% / 50.7% vs 47.9% | 20.4% / 47.5% / 49.4% vs 50.2% | 23.6% / 38.6% / 46.5% vs 49.0% | 44.2% / 0.7% / 3.3% / 95.8% vs 43.2% | 39.1% / 0.9% / 5.1% / 92.6% vs 39.6% | 59.4% / 61.9% / 64.0% | 15.3 / 12.2 / 13.1 |
| Owner original (dodge base 0, stun 10-20) | 23.28 | 3.5% / 13.3% / 43.9% vs 52.8% | 12.3% / 23.1% / 46.8% vs 52.3% | 14.5% / 24.1% / 44.7% vs 50.6% | 7.5% / 0.1% / 0.0% / 98.0% vs 61.8% | 9.9% / 0.2% / 0.1% / 94.4% vs 54.4% | 57.5% / 60.7% / 63.2% | 14.3 / 11.7 / 12.9 |

### What stun changes (paired: same fights with stun triggering off)

| Variant | Stage | Can-stun holder win: stun on | stun off | Δ (pp) | Stuns per fight | Lost turns per fight |
|---|---|---|---|---|---|---|
| V3 default (tuned sweet spot) | mid | 66.5% | 63.2% | 3.3 | 0.15 | 0.07 |
| V3 default (tuned sweet spot) | late | 60.3% | 57.4% | 2.9 | 0.18 | 0.09 |
| Owner original (dodge base 0, stun 10-20) | mid | 64.5% | 64.1% | 0.3 | 0.02 | 0.01 |
| Owner original (dodge base 0, stun 10-20) | late | 58.3% | 57.9% | 0.4 | 0.04 | 0.02 |

### What the dodge change does (paired vs V3 default)

| Variant | Stage | Dodge-style win | Block-style win | Smart-style win | Dodge success | Δ dodge-style vs default (pp) |
|---|---|---|---|---|---|---|
| V3 default (tuned sweet spot) | early | 50.7% | 47.9% | 50.3% | 12.4% | 0.0 |
| V3 default (tuned sweet spot) | mid | 49.4% | 50.2% | 51.7% | 20.4% | 0.0 |
| V3 default (tuned sweet spot) | late | 46.5% | 49.0% | 55.4% | 23.6% | 0.0 |
| Owner original (dodge base 0, stun 10-20) | early | 43.9% | 52.8% | 51.6% | 3.5% | -6.7 |
| Owner original (dodge base 0, stun 10-20) | mid | 46.8% | 52.3% | 52.2% | 12.3% | -2.6 |
| Owner original (dodge base 0, stun 10-20) | late | 44.7% | 50.6% | 55.4% | 14.5% | -1.9 |

### Targets missed

- **V3 default (tuned sweet spot)** (score 6.61): early dodge success 12.4 < 20; mid stun extra-damage share 0.7 < 1; late 3 stalls; late stun extra-damage share 0.9 < 1; late stun chains 5.1 > 5
- **Owner original (dodge base 0, stun 10-20)** (score 23.28): early dodge success 3.5 < 20; early |dodge style − block style| 8.9 > 5; mid dodge success 12.3 < 20; mid smart players dodge share 23.1 < 30; mid |dodge style − block style| 5.5 > 5; mid stun holder lands a stun 7.5 < 30; mid stun extra-damage share 0.1 < 1; late dodge success 14.5 < 20; late smart players dodge share 24.1 < 30; late |dodge style − block style| 6.0 > 5; late 2 stalls; late stun holder lands a stun 9.9 < 30; late stun extra-damage share 0.2 < 1

### Win rate by group (late stage), V2 → candidates

| Group | V2 | V3 default (tuned sweet spot) | Owner original (dodge base 0, stun 10-20) |
|---|---|---|---|
| def-alloc:heavy | 43.3% | 44.7% | 45.2% |
| def-alloc:light | 51.6% | 51.2% | 51.1% |
| dex-alloc:heavy | 56.6% | 56.3% | 56.4% |
| dex-alloc:light | 48.3% | 48.4% | 48.4% |
| gear:can-stun weapon | 59.2% | 60.3% | 58.3% |
| gear:dodge-counter weapon | 61.0% | 60.4% | 60.5% |
| gear:heavy armour | 35.3% | 35.3% | 36.2% |
| gear:shield | 39.4% | 42.0% | 42.7% |
| shape:hybrid | 70.7% | 69.5% | 68.9% |
| shape:melee+shield | 52.4% | 54.9% | 56.0% |
| shape:melee | 56.5% | 52.3% | 52.3% |
| shape:ranged+shield | 14.0% | 16.9% | 16.8% |
| shape:ranged | 28.1% | 31.8% | 30.9% |
| shape:shield | 15.7% | 17.9% | 18.8% |
| shape:unarmed | 11.3% | 11.1% | 11.2% |
| stim:auto | 52.1% | 53.3% | 53.6% |
| stim:low | 47.8% | 48.5% | 48.3% |
| stim:never | 49.9% | 47.8% | 47.6% |
| style:block | 51.2% | 49.0% | 50.6% |
| style:dodge | 49.0% | 46.5% | 44.7% |
| style:greedy | 46.9% | 51.1% | 51.4% |
| style:random | 49.7% | 48.5% | 48.3% |
| style:smart | 53.0% | 55.4% | 55.4% |
| supplies:has stims | 49.4% | 51.3% | 51.3% |
