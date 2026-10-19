# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users
Players who play for fun, including **first-time players who have never seen the rules**. They start a run, build a fighter (stat points, gear, healing stims) and fight a boss over many rounds in the browser. The game must be playable without knowing the developer's implementation. The Runs, Simulations and ML Lab views are secondary tools for the developer, who also plays and tunes the game.

## Product Purpose
The Boss Remembers is a browser-playable, turn-based medieval duel. Player and boss start from the same base, earn XP and gold, level up, buy gear and stims between rounds. The boss studies every fight and adapts under exactly the same rules as the player instead of getting arbitrary power boosts. Success means:
- the duel feels like a tense fight;
- a new player understands what they can do, why a choice matters and what just happened;
- the player can see that the boss is learning from them.

## Positioning
The boss has no hidden advantages:
- it sees only what a player could see;
- it records evidence-backed weaknesses;
- it predicts the player's next approach (a trained model when one is eligible and approved, otherwise a transparent baseline) and says honestly which one it used;
- it picks legal, affordable adaptations.

## Operating Context
- **Run loop:** prepare (stat points, gear, healing stims), then fight the round, then read what the boss learned.
- **Combat (engine 3.x), every attack:**
  1. The attacker chooses Ranged or Melee and the attack is announced.
  2. The defender chooses **Block** (DEF, shields, armor) or **Dodge** (a DEX lead).
  3. A successful defence may **counter**: ×1.5 after a block, ×0.75 after a dodge with a long weapon. Ranged attacks are never countered.
  4. Landed hits fill a **stun meter**. At 100, a stun-capable weapon stuns the target: it loses its next defence and an attack turn.
- **Stims and round end:** healing stims are used before your own turn. A round ends at KO or after a 30-turn limit.
- **The player decides every incoming attack** (keys B / D), plus Ranged/Melee (R / M) and stim use.
- Every attack stores its formula inputs and random rolls. The log can show them, but they are not the headline.

## Capabilities and Constraints
- **Client:** React 18 + Vite + TypeScript, plain CSS (`src/styles/*.css`).
  - All game rules live on the server. The client only displays authoritative state and sends player intents.
  - Odds, prices and previews come from the server.
- **Views:** Duel (Prepare / Fight / Aftermath), plus the developer's Workshop: Runs, Simulations, ML Lab.
- **Gear:** 24-item medieval catalogue (blades, blunt weapons that can stun, polearms with dodge counters, bows, shields and armor with block bonuses), 2 hand slots + armor, healing stims with upgrades.
- **Visual world:** the V2 "Court Deck" look (green baize, white card stock) is being **replaced**. The owner asked for a restrained **dark-fantasy** combat-game identity:
  - clean, precise and fun;
  - not flashy, no particle effects or elaborate animation;
  - not a dashboard of boxes and buttons;
  - some art is welcome where it helps.
- Deployment is not configured.

## Evidence on Hand
- Mechanics and rules: `../docs/GAME_MECHANICS.md` (§0 = V3), `../docs/V3_DEMANDS.md`. Owner's V3 UI brief: `../docs/V3_IMPLEMENTATION_PLAN.md` §E.
- No player testimonials, metrics or press exist. Do not invent any.

## Product Principles
1. **The fight comes first.** An incoming attack and the player's answer are the focal point; combat should read as a tense duel, not a spreadsheet.
2. **Explain what matters now.** Use progressive disclosure: contextual hints, plain-language gear effects and an optional rules reference, never a wall of text.
3. **The boss's memory must stay visible.** Show what it learned and what it will do next, in its own voice, with the evidence one step away.
4. **Fair and honest.** Same rules for both sides; model vs fallback always reported truthfully.
5. **Numbers stay traceable.** Formula inputs and rolls stay available for anyone who wants them, even when they are not the headline.
