# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users
Players who play for fun: they start a run, allocate stats, buy gear and fight a boss over many rounds in the browser. The Runs, Simulations and ML Lab views are secondary tools the developer uses while the game is in testing.

## Product Purpose
The Boss Remembers is a browser-playable, text-focused medieval duel. Player and boss start from the same base, earn XP and gold, level up and re-equip between rounds. The boss studies every fight and adapts under exactly the same rules as the player instead of getting arbitrary power boosts. Success means the duel feels tense and alive, and the player can see that the boss is learning from them.

## Positioning
The boss has no hidden advantages. It records evidence-backed weaknesses, predicts the player's next approach (trained XGBoost model when one is active, otherwise a transparent baseline) and picks legal, affordable adaptations. It always says honestly which one it used.

## Operating Context
- Single run loop: pre-round prep (stat points, shop, loadout), then the round's combat log, then the boss's post-round analysis and next-round decision.
- Every attack stores its formula inputs and random rolls, and the combat log shows them.
- The game is in testing; the developer plays it and reads the boss reasoning to tune rules and ML.

## Capabilities and Constraints
- Client: React 18 + Vite + TypeScript, plain CSS (`src/styles/*.css`). All game rules live on the server; the client only displays state and sends player intents (stat previews come from a pure server endpoint).
- Views: Duel (Prepare / Fight / Aftermath), plus the developer's Workshop: Runs, Simulations, ML Lab.
- 24-item medieval gear catalogue (engine 2.0.0: blades, blunt weapons, polearms, bows, shields, armor), 2 hand slots + armor.
- Visual world: "Court Deck" (baize table, card stock, court inks, suit pips). No raster art yet; the user welcomes some art where it helps.
- Deployment is not configured.

## Evidence on Hand
- Mechanics and rules: `../docs/GAME_MECHANICS.md`. Design intent: `../context/`.
- No player testimonials, metrics or press exist. Do not invent any.

## Product Principles
1. Duel feel comes first: combat should read as a tense medieval fight, not a spreadsheet.
2. The boss's memory must stay visible: evidence, weaknesses, prediction and why it adapted sit next to the fight, without burying it.
3. Fair and honest: same rules for both sides, and model vs fallback is always reported truthfully.
4. Numbers stay traceable: formula inputs and rolls stay available for anyone who wants them, even when they are not the headline.
