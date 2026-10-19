# V3 lab — confirm (seed "lab-verify", 1500 builds × 30000 fights per stage)

| Variant | Score (0 = all targets met) | Early dodge: success / smart dodge share / dodge-style vs block-style win | Mid dodge | Late dodge | Mid stun: holder lands ≥1 / extra-dmg share / chains / holder win landed vs not | Late stun | Faster fighter wins (E/M/L) | Attacks per fight (E/M/L) |
|---|---|---|---|---|---|---|---|---|
| V2 (control) | — | — / — / 50.1% vs 49.5% | — / — / 50.2% vs 51.8% | — / — / 49.0% vs 51.2% | 0.0% / 0.0% / 0.0% / — vs 67.9% | 0.0% / 0.0% / 0.0% / — vs 59.2% | 61.6% / 61.2% / 64.7% | 13.0 / 9.9 / 10.3 |
| V3 default (tuned sweet spot) | 1.73 | 12.4% / 90.1% / 50.7% vs 47.9% | 19.2% / 47.8% / 48.9% vs 50.4% | 22.6% / 40.0% / 46.2% vs 49.2% | 43.9% / 0.7% / 3.2% / 95.4% vs 44.7% | 39.1% / 0.9% / 4.9% / 92.3% vs 39.5% | 59.4% / 59.8% / 61.9% | 15.3 / 11.1 / 10.7 |
| Owner original (dodge base 0, stun 10-20) | 19.24 | 3.5% / 13.3% / 43.9% vs 52.8% | 10.7% / 23.5% / 46.0% vs 52.8% | 13.7% / 24.9% / 44.1% vs 51.3% | 7.1% / 0.1% / 0.0% / 97.6% vs 62.4% | 9.1% / 0.2% / 0.1% / 94.3% vs 54.1% | 57.5% / 58.7% / 61.4% | 14.3 / 10.7 / 10.4 |

### What stun changes (paired: same fights with stun triggering off)

| Variant | Stage | Can-stun holder win: stun on | stun off | Δ (pp) | Stuns per fight | Lost turns per fight |
|---|---|---|---|---|---|---|
| V3 default (tuned sweet spot) | mid | 66.9% | 63.6% | 3.3 | 0.14 | 0.07 |
| V3 default (tuned sweet spot) | late | 60.1% | 56.6% | 3.5 | 0.18 | 0.09 |
| Owner original (dodge base 0, stun 10-20) | mid | 64.9% | 64.6% | 0.3 | 0.02 | 0.01 |
| Owner original (dodge base 0, stun 10-20) | late | 57.7% | 57.2% | 0.5 | 0.04 | 0.01 |

### What the dodge change does (paired vs V3 default)

| Variant | Stage | Dodge-style win | Block-style win | Smart-style win | Dodge success | Δ dodge-style vs default (pp) |
|---|---|---|---|---|---|---|
| V3 default (tuned sweet spot) | early | 50.7% | 47.9% | 50.3% | 12.4% | 0.0 |
| V3 default (tuned sweet spot) | mid | 48.9% | 50.4% | 52.0% | 19.2% | 0.0 |
| V3 default (tuned sweet spot) | late | 46.2% | 49.2% | 55.8% | 22.6% | 0.0 |
| Owner original (dodge base 0, stun 10-20) | early | 43.9% | 52.8% | 51.6% | 3.5% | -6.7 |
| Owner original (dodge base 0, stun 10-20) | mid | 46.0% | 52.8% | 52.4% | 10.7% | -2.9 |
| Owner original (dodge base 0, stun 10-20) | late | 44.1% | 51.3% | 55.7% | 13.7% | -2.2 |

### Targets missed

- **V3 default (tuned sweet spot)** (score 1.73): early dodge success 12.4 < 20; mid dodge success 19.2 < 20; mid stun extra-damage share 0.7 < 1; late stun extra-damage share 0.9 < 1
- **Owner original (dodge base 0, stun 10-20)** (score 19.24): early dodge success 3.5 < 20; early |dodge style − block style| 8.9 > 5; mid dodge success 10.7 < 20; mid smart players dodge share 23.5 < 30; mid |dodge style − block style| 6.7 > 5; mid stun holder lands a stun 7.1 < 30; mid stun extra-damage share 0.1 < 1; late dodge success 13.7 < 20; late smart players dodge share 24.9 < 30; late |dodge style − block style| 7.2 > 5; late stun holder lands a stun 9.1 < 30; late stun extra-damage share 0.2 < 1

### Win rate by group (late stage), V2 → candidates

| Group | V2 | V3 default (tuned sweet spot) | Owner original (dodge base 0, stun 10-20) |
|---|---|---|---|
| def-alloc:heavy | 43.3% | 44.1% | 44.3% |
| def-alloc:light | 51.6% | 51.4% | 51.3% |
| dex-alloc:heavy | 56.6% | 56.3% | 56.2% |
| dex-alloc:light | 48.3% | 48.4% | 48.5% |
| gear:can-stun weapon | 59.2% | 60.1% | 57.7% |
| gear:dodge-counter weapon | 61.0% | 60.2% | 60.3% |
| gear:heavy armour | 35.3% | 33.4% | 34.0% |
| gear:shield | 39.4% | 43.8% | 44.6% |
| shape:hybrid | 70.7% | 63.7% | 63.1% |
| shape:melee+shield | 52.4% | 57.5% | 58.5% |
| shape:melee | 56.5% | 55.7% | 55.4% |
| shape:ranged+shield | 14.0% | 17.4% | 17.7% |
| shape:ranged | 28.1% | 34.5% | 34.2% |
| shape:shield | 15.7% | 18.4% | 19.1% |
| shape:unarmed | 11.3% | 10.8% | 10.6% |
| stim:auto | 52.1% | 53.3% | 53.7% |
| stim:low | 47.8% | 48.6% | 48.5% |
| stim:never | 49.9% | 47.6% | 47.4% |
| style:block | 51.2% | 49.2% | 51.3% |
| style:dodge | 49.0% | 46.2% | 44.1% |
| style:greedy | 46.9% | 50.9% | 51.4% |
| style:random | 49.7% | 48.3% | 48.0% |
| style:smart | 53.0% | 55.8% | 55.7% |
| supplies:has stims | 49.4% | 51.2% | 51.3% |
