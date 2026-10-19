# V3 lab — confirm (seed "lab-confirm", 1500 builds × 30000 fights per stage)

| Variant | Score (0 = all targets met) | Early dodge: success / smart dodge share / dodge-style vs block-style win | Mid dodge | Late dodge | Mid stun: holder lands ≥1 / extra-dmg share / chains / holder win landed vs not | Late stun | Faster fighter wins (E/M/L) | Attacks per fight (E/M/L) |
|---|---|---|---|---|---|---|---|---|
| V2 (control) | — | — / — / 50.7% vs 50.0% | — / — / 48.2% vs 47.9% | — / — / 53.3% vs 50.0% | 0.0% / 0.0% / 0.0% / — vs 63.6% | 0.0% / 0.0% / 0.0% / — vs 61.1% | 61.9% / 61.4% / 62.5% | 13.0 / 10.2 / 9.6 |
| V3 default (owner rules) | 29.87 | 3.3% / 12.4% / 44.7% vs 52.9% | 12.0% / 24.7% / 44.7% vs 48.9% | 15.5% / 22.1% / 48.1% vs 49.8% | 9.4% / 0.1% / 0.0% / 98.2% vs 56.3% | 7.3% / 0.1% / 0.1% / 96.4% vs 55.9% | 59.0% / 61.1% / 61.6% | 14.4 / 11.9 / 11.8 |
| A dodge base10+2%/pt (stun default) | 22.15 | 12.2% / 92.2% / 50.7% vs 48.3% | 20.2% / 49.1% / 47.4% vs 46.4% | 23.8% / 38.2% / 50.2% vs 48.0% | 9.4% / 0.1% / 0.0% / 98.3% vs 55.3% | 7.2% / 0.1% / 0.1% / 95.4% vs 55.3% | 60.6% / 62.4% / 62.4% | 15.3 / 12.5 / 12.4 |
| B dodge A + stun x1.5 boost x3 | 12.87 | 12.2% / 92.2% / 50.7% vs 48.3% | 20.2% / 49.2% / 47.5% vs 46.3% | 23.8% / 38.2% / 50.7% vs 47.8% | 42.8% / 0.6% / 2.0% / 96.2% vs 36.8% | 33.2% / 0.8% / 2.1% / 95.1% vs 43.0% | 60.6% / 62.1% / 62.5% | 15.3 / 12.4 / 12.3 |
| C dodge A + stun x1.75 | 12.26 | 12.2% / 92.2% / 50.7% vs 48.3% | 20.2% / 49.2% / 47.6% vs 46.2% | 23.8% / 38.1% / 50.6% vs 47.8% | 48.1% / 0.7% / 4.5% / 94.3% vs 34.0% | 37.0% / 0.9% / 3.4% / 94.0% vs 41.0% | 60.6% / 62.1% / 62.5% | 15.3 / 12.4 / 12.3 |
| D dodge A + stun x2 extra 0.5 | 13.11 | 12.2% / 92.2% / 50.7% vs 48.3% | 20.2% / 49.1% / 47.8% vs 46.1% | 23.8% / 38.1% / 50.7% vs 47.8% | 57.3% / 1.6% / 5.1% / 94.9% vs 25.5% | 46.3% / 2.3% / 3.6% / 95.3% vs 33.7% | 60.6% / 61.7% / 62.4% | 15.3 / 12.3 / 12.2 |
| E dodge signed base20+1%/pt + stun x1.5 boost x3 | 12.38 | 20.0% / 93.1% / 53.3% vs 43.0% | 20.4% / 53.3% / 47.5% vs 46.3% | 21.5% / 41.0% / 50.2% vs 48.3% | 42.8% / 0.6% / 2.0% / 96.2% vs 38.0% | 33.5% / 0.8% / 2.1% / 95.0% vs 43.7% | 61.6% / 61.5% / 61.5% | 16.2 / 12.5 / 12.1 |

### What stun changes (paired: same fights with stun triggering off)

| Variant | Stage | Can-stun holder win: stun on | stun off | Δ (pp) | Stuns per fight | Lost turns per fight |
|---|---|---|---|---|---|---|
| V3 default (owner rules) | mid | 60.3% | 59.8% | 0.5 | 0.03 | 0.01 |
| V3 default (owner rules) | late | 58.8% | 58.5% | 0.3 | 0.03 | 0.01 |
| A dodge base10+2%/pt (stun default) | mid | 59.3% | 58.9% | 0.5 | 0.03 | 0.01 |
| A dodge base10+2%/pt (stun default) | late | 58.2% | 58.0% | 0.3 | 0.03 | 0.01 |
| B dodge A + stun x1.5 boost x3 | mid | 62.2% | 58.9% | 3.3 | 0.13 | 0.06 |
| B dodge A + stun x1.5 boost x3 | late | 60.3% | 58.0% | 2.3 | 0.14 | 0.06 |
| C dodge A + stun x1.75 | mid | 63.0% | 58.9% | 4.2 | 0.15 | 0.08 |
| C dodge A + stun x1.75 | late | 60.6% | 58.0% | 2.7 | 0.16 | 0.08 |
| D dodge A + stun x2 extra 0.5 | mid | 65.3% | 58.9% | 6.5 | 0.18 | 0.09 |
| D dodge A + stun x2 extra 0.5 | late | 62.3% | 58.0% | 4.3 | 0.20 | 0.08 |
| E dodge signed base20+1%/pt + stun x1.5 boost x3 | mid | 62.9% | 59.7% | 3.2 | 0.13 | 0.06 |
| E dodge signed base20+1%/pt + stun x1.5 boost x3 | late | 60.9% | 58.7% | 2.2 | 0.14 | 0.06 |

### What the dodge change does (paired vs V3 default)

| Variant | Stage | Dodge-style win | Block-style win | Smart-style win | Dodge success | Δ dodge-style vs default (pp) |
|---|---|---|---|---|---|---|
| V3 default (owner rules) | early | 44.7% | 52.9% | 52.2% | 3.3% | 0.0 |
| V3 default (owner rules) | mid | 44.7% | 48.9% | 54.2% | 12.0% | 0.0 |
| V3 default (owner rules) | late | 48.1% | 49.8% | 51.4% | 15.5% | 0.0 |
| A dodge base10+2%/pt (stun default) | early | 50.7% | 48.3% | 51.5% | 12.2% | 6.0 |
| A dodge base10+2%/pt (stun default) | mid | 47.4% | 46.4% | 53.9% | 20.2% | 2.6 |
| A dodge base10+2%/pt (stun default) | late | 50.2% | 48.0% | 51.5% | 23.8% | 2.1 |
| B dodge A + stun x1.5 boost x3 | early | 50.7% | 48.3% | 51.5% | 12.2% | 6.0 |
| B dodge A + stun x1.5 boost x3 | mid | 47.5% | 46.3% | 53.8% | 20.2% | 2.8 |
| B dodge A + stun x1.5 boost x3 | late | 50.7% | 47.8% | 51.2% | 23.8% | 2.6 |
| C dodge A + stun x1.75 | early | 50.7% | 48.3% | 51.5% | 12.2% | 6.0 |
| C dodge A + stun x1.75 | mid | 47.6% | 46.2% | 53.8% | 20.2% | 2.9 |
| C dodge A + stun x1.75 | late | 50.6% | 47.8% | 51.1% | 23.8% | 2.5 |
| D dodge A + stun x2 extra 0.5 | early | 50.7% | 48.3% | 51.5% | 12.2% | 6.0 |
| D dodge A + stun x2 extra 0.5 | mid | 47.8% | 46.1% | 53.9% | 20.2% | 3.1 |
| D dodge A + stun x2 extra 0.5 | late | 50.7% | 47.8% | 51.1% | 23.8% | 2.6 |
| E dodge signed base20+1%/pt + stun x1.5 boost x3 | early | 53.3% | 43.0% | 53.9% | 20.0% | 8.6 |
| E dodge signed base20+1%/pt + stun x1.5 boost x3 | mid | 47.5% | 46.3% | 54.0% | 20.4% | 2.8 |
| E dodge signed base20+1%/pt + stun x1.5 boost x3 | late | 50.2% | 48.3% | 50.6% | 21.5% | 2.2 |

### Targets missed

- **V3 default (owner rules)** (score 29.87): early dodge success 3.3 < 20; early |dodge style − block style| 8.1 > 5; mid dodge success 12.0 < 20; mid smart players dodge share 24.7 < 30; mid stun holder lands a stun 9.4 < 30; mid stun extra-damage share 0.1 < 1; mid stunner win when it lands a stun 98.2 > 80; late dodge success 15.5 < 20; late smart players dodge share 22.1 < 30; late 1 stalls; late stun holder lands a stun 7.3 < 30; late stun extra-damage share 0.1 < 1; late stunner win when it lands a stun 96.4 > 80
- **A dodge base10+2%/pt (stun default)** (score 22.15): early dodge success 12.2 < 20; mid stun holder lands a stun 9.4 < 30; mid stun extra-damage share 0.1 < 1; mid stunner win when it lands a stun 98.3 > 80; late 1 stalls; late stun holder lands a stun 7.2 < 30; late stun extra-damage share 0.1 < 1; late stunner win when it lands a stun 95.4 > 80
- **B dodge A + stun x1.5 boost x3** (score 12.87): early dodge success 12.2 < 20; mid stun extra-damage share 0.6 < 1; mid stunner win when it lands a stun 96.2 > 80; late 1 stalls; late stun extra-damage share 0.8 < 1; late stunner win when it lands a stun 95.1 > 80
- **C dodge A + stun x1.75** (score 12.26): early dodge success 12.2 < 20; mid stun extra-damage share 0.7 < 1; mid stunner win when it lands a stun 94.3 > 80; late 1 stalls; late stun extra-damage share 0.9 < 1; late stunner win when it lands a stun 94.0 > 80
- **D dodge A + stun x2 extra 0.5** (score 13.11): early dodge success 12.2 < 20; mid stun holder lands a stun 57.3 > 55; mid stun chains 5.1 > 5; mid stunner win when it lands a stun 94.9 > 80; late 1 stalls; late stunner win when it lands a stun 95.3 > 80
- **E dodge signed base20+1%/pt + stun x1.5 boost x3** (score 12.38): early dodge success 20.0 < 20; early |dodge style − block style| 10.3 > 5; mid stun extra-damage share 0.6 < 1; mid stunner win when it lands a stun 96.2 > 80; late 1 stalls; late stun extra-damage share 0.8 < 1; late stunner win when it lands a stun 95.0 > 80

### Win rate by group (late stage), V2 → candidates

| Group | V2 | V3 default (owner rules) | A dodge base10+2%/pt (stun default) | B dodge A + stun x1.5 boost x3 | C dodge A + stun x1.75 | D dodge A + stun x2 extra 0.5 | E dodge signed base20+1%/pt + stun x1.5 boost x3 |
|---|---|---|---|---|---|---|---|
| def-alloc:heavy | 42.5% | 44.3% | 44.6% | 44.5% | 44.5% | 44.4% | 44.3% |
| def-alloc:light | 51.5% | 51.1% | 51.1% | 51.1% | 51.1% | 51.1% | 51.1% |
| dex-alloc:heavy | 58.5% | 57.4% | 57.3% | 57.4% | 57.3% | 57.3% | 57.4% |
| dex-alloc:light | 48.1% | 48.3% | 48.4% | 48.3% | 48.3% | 48.4% | 48.3% |
| gear:can-stun weapon | 61.1% | 58.8% | 58.2% | 60.3% | 60.6% | 62.3% | 60.9% |
| gear:dodge-counter weapon | 62.2% | 60.8% | 60.9% | 60.9% | 61.0% | 61.3% | 61.3% |
| gear:heavy armour | 35.4% | 35.1% | 34.5% | 34.4% | 34.4% | 34.5% | 35.5% |
| gear:shield | 41.6% | 45.3% | 44.8% | 44.3% | 44.2% | 44.1% | 45.1% |
| shape:hybrid | 70.9% | 68.2% | 68.4% | 68.9% | 68.9% | 69.3% | 68.5% |
| shape:melee+shield | 53.5% | 57.2% | 56.4% | 55.9% | 55.8% | 55.6% | 57.2% |
| shape:melee | 56.6% | 52.2% | 52.0% | 52.3% | 52.4% | 52.4% | 52.5% |
| shape:ranged+shield | 17.0% | 20.6% | 20.8% | 20.4% | 20.3% | 20.2% | 19.8% |
| shape:ranged | 29.2% | 34.0% | 35.2% | 35.0% | 35.0% | 34.6% | 33.3% |
| shape:shield | 15.1% | 18.6% | 18.4% | 18.0% | 18.0% | 18.0% | 18.4% |
| shape:unarmed | 12.4% | 11.1% | 11.1% | 11.0% | 11.0% | 11.0% | 11.2% |
| stim:auto | 50.5% | 51.6% | 51.5% | 51.3% | 51.3% | 51.3% | 51.4% |
| stim:low | 51.8% | 52.2% | 52.2% | 52.2% | 52.2% | 52.1% | 52.2% |
| stim:never | 47.7% | 46.3% | 46.4% | 46.6% | 46.6% | 46.6% | 46.4% |
| style:block | 50.0% | 49.8% | 48.0% | 47.8% | 47.8% | 47.8% | 48.3% |
| style:dodge | 53.3% | 48.1% | 50.2% | 50.7% | 50.6% | 50.7% | 50.2% |
| style:greedy | 49.7% | 53.5% | 53.1% | 53.0% | 53.0% | 52.9% | 53.0% |
| style:random | 49.5% | 47.5% | 47.3% | 47.4% | 47.5% | 47.5% | 47.8% |
| style:smart | 47.1% | 51.4% | 51.5% | 51.2% | 51.1% | 51.1% | 50.6% |
| supplies:has stims | 48.9% | 50.8% | 50.7% | 50.7% | 50.6% | 50.6% | 50.7% |
