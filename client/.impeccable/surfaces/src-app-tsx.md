---
version: 1
slug: "src-app-tsx"
primary_target: "src/App.tsx"
related_targets: []
---

# Surface brief — Duel app (client), Version 3

Scope: the whole client SPA (the Duel first; Runs, Simulations, ML Lab as the Workshop). Mode: Operate.

**Audience:** players who play for fun, including first-time players who do not know the rules, and the developer.

**Job:**
- prepare a fighter (points, gear, stims);
- answer every incoming attack (Block / Dodge), pick Ranged or Melee, and use stims;
- understand what happened;
- read what the boss learned;
- repeat.

**Constraints:**
- React 18 + plain CSS. Rules are server-authoritative: odds, prices and previews come from the server.
- Every current function is kept.
- Not flashy, not a dashboard.

**Owner choices for this direction (2026-10-20):**
- Lead-light is the base.
- No exchange-history strip under the fight; history goes per round at the bottom.
- Show the inventory beautifully.
- Add interactive animations for hit, block, dodge, counter and stun.

## Direction contract
THESIS: A dark nave where colour exists only as lit glass, and glass lights only when something happens. The fight is two lancet windows facing each other across an aisle; the incoming attack is the one pane waiting for your answer. Refuses the gold-filigree RPG panel and the grey dashboard.

OWN-WORLD:
- **Ground and surfaces:** night-nave ground #0e0f12; stone surfaces #17191d / #1f2227; dark lead seams #2c2f35 instead of borders or shadows.
- **Tinctures:**
  - azure #3d74d8 = you;
  - gules #cf3b41 = boss;
  - amber #dfa634 = only "your decision now" and counters;
  - violet #8a64d6 = stun;
  - verdant #4f9d66 = healing;
  - clear glass #c9d3d8 = blocked or dodged.
- **Type:** inscriptional caps (Marcellus SC) for names and big numerals; Atkinson Hyperlegible for everything read.
- **Meters:** HP and stun are rows of leaded panes.
- **Gear:** each item shown as a glass roundel: weapon, shield, armour, stims as vials.

STORY:
1. A player sees both fighters' windows: health, stun and gear.
2. Exactly one lit, amber-ringed pane asks for a decision; its two answers state their odds and consequences.
3. The answer plays out as light in the glass: a hit cracks red or blue light across the struck window, a block flashes clear glass, a dodge slides the window aside, a counter sends amber back, a stun floods the window violet.
4. Below, rounds are listed one per row, newest first, expandable to every exchange.

FIRST VIEWPORT:
- **Top bar:** brand, then Duel · Rules · Workshop (quiet).
- **Run line:** round N of M, turn, who acts first, record, End run (isolated).
- **Three columns:**
  - left, your window: name, level, HP numeral over a row of HP panes, stun panes, then the inventory as roundels (hands, body, stim vials);
  - centre, the incoming pane: attacker, weapon, mode, expected damage, tags (heavy · can stun · cannot be countered). Under it, Block and Dodge as two large choices with odds, keys B / D, one-line consequences. Under that, one line for the last exchange;
  - right, the boss's window, mirrored.
- **Below the fold:** the round history.

FORM: Cathedral Lead-Light, candidate 3 of my re-rolled ordered list (assigned). seed:bbf9b5d1e0af79df. Signature move: the exchange as light in the glass, with one restrained, purposeful animation per outcome (hit, block, dodge, counter, stun, heal, KO), all under prefers-reduced-motion.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
