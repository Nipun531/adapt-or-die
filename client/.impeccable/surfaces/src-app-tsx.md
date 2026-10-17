---
version: 1
slug: "src-app-tsx"
primary_target: "src/App.tsx"
related_targets: []
---

# Surface brief — Duel app (client)

Scope: the whole client SPA (Duel screen first; Runs, Simulations, ML Lab as the Workshop). Mode: Operate.
Audience: the developer playing the duel for fun and reading the boss's reasoning. Job: prepare, fight, read what the boss learned, repeat. Constraints: React 18 + plain CSS, server-authoritative rules, all current functions kept. User: replace the old look entirely; some art welcome; duel screen is the star. User delegated the direction choice ("pick and choose by yourself").

## Direction contract
THESIS: Every build is a hand of cards on a baize table; the boss's adaptation is the card it plays from the hand of equally strong plans it drew. Refuses the dark-parchment RPG panel and the grey dashboard.
OWN-WORLD: Deep green baize ground (#1e4b39 family), white card stock with rounded corners, flat four-colour court printing: card red #c4122f, court blue #1f3c8c, court yellow #f0b323, ink #141414. Saturated colour lives only on card faces and state; shell is baize, stock and ink. Condensed card-index numerals (Big Shoulders Display) over Atkinson Hyperlegible. Suit pips stand for stats: ♥ HP, ♠ STR, ♦ DEF, ♣ DEX. One card form at three sizes.
STORY: The player sees both fighters as face-up court cards, knows whose turn it is in the loop, builds a hand in the Armory, watches the fight resolve, then reads the boss's memory and the hand it drew.
FIRST VIEWPORT: Baize top bar (brand, Duel / Workshop). Run · round · record sit in a run header directly under it (adaptation, 2026-10-17: the top bar is shared by the Workshop pages, which have no run, and has no width on phones; the record also sits under VS on desktop). Versus row: You card left, VS, Boss card right, each with level index, HP large, STR/DEF/DEX pips Net values. Phase tabs Prepare · Fight · Aftermath. Prepare: Armory card grid with filters (left), hand slots Hand 1 / Hand 2 / Body + stat steppers + preview + the boss's last hand (right), Begin round at the foot of that column (a fixed bottom bar on phones only).
FORM: Court Deck, candidate 6 of my ordered list (assigned). seed:d9614f1b4440c060. Signature move: the boss's hand — its equal plans fanned as cards, the played one face up with its draw probability.
FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
