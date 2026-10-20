# Game modes (V4)

There are three modes. They share one combat engine (`game/combat.ts`, engine 3.1.0) and one validation layer (`game/equipment.ts`). They differ in **who the opponent is**, **what it may know** and **where their data goes**. Every run has `runs.mode` (migration 004). All runs created before V4 are `prepared`.

| | Prepared Boss | Learning Boss | PvP Arena (local) |
|---|---|---|---|
| Route | `#/prepared` (alias `#/duel`), runs at `#/duel/:id` | `#/learning`, runs at `#/duel/:id` | `#/pvp`, matches at `#/pvp/:id` |
| Opponent | `boss/prepare.ts` → `choosePlan` | `boss/prepare.ts` → `choosePlan` with the profile forecast | a second human (engine side `boss` = Player 2) |
| Knowledge | Rules, prices and legal builds. The P(ranged) baseline uses this run's history. A global, simulation-trained model is used **only if an eligible one is active** (none is today). | Rules, prices and legal builds, plus **this profile's observations only** (`profile_observations`). It never reads a global model or global data. | — |
| Writes | `boss_decisions`, `boss_analyses`, `training_examples`, `build_examples` (global data) | `boss_decisions`, `boss_analyses`, `profile_observations`. Never the global tables. | rounds and events only; no boss decision, analysis, example or profile row |
| Guarded by | default mode | `bossPrepare(mode)`, `appendExample` and `buildMissingBuildExamples` (Prepared only), `recordObservation` (Learning only) | `startRound` → `startPvpRound`; `submitChoice` checks turn ownership; prep `?side=boss` is allowed only in PvP |

## Learning Boss profiles: identity and persistence

- **There are no user accounts.** A profile is a `learning_profiles` row with a random UUID key. The browser keeps the key (`localStorage` `tbr-profile-key`) and sends it as `X-Profile-Key`.
- A Learning run can only be changed by the holder of its profile's key, so two browsers never touch or merge each other's profile.
- **Start fresh** (`POST /api/profiles/me/fresh`) archives the profile: its observations and runs stay as history, and its active runs are closed. It then issues a new, empty profile.
- Limitation: clearing the browser's storage, or using another browser, starts a new profile. The old one is kept on the server but cannot be reached from that browser.

**What is recorded.** After every completed Learning round, one observation is stored:
- `context`: the previous result, plus the gold and points available before preparing;
- `heads`: what the player chose (hands, melee family, armour change, dominant stat; `boss/build-heads.ts`);
- `outcome`: what then happened.

Choices and outcomes are kept apart, because using something often does not mean it works. The source is `manual` for humans and `synthetic` for simulated fixtures.

**How it learns.** `boss/forecast.ts` `profileHeads` is a Dirichlet over each head with a uniform prior, so with no evidence it knows only the rules. On top of that:
- recency decay is 0.8 per observation;
- observations made after the same result (win/loss) count double;
- a learned "repeat last round" rate, estimated from this player's own transitions.

The forecast weights the planner's opponent scenarios: the V3 reachable builds, reweighted by head probability (`reweightReachable`). It is stored in `boss_decisions.predictor.forecast`, together with the number of observations used.

**Insights shown to the player** (`services/learning.ts` `insightsOf`): a habit is shown only when it was seen in at least 3 rounds and in at least 60% of them. Each line states its own counts.

## Local PvP

- Two names and a number of rounds.
- Each round, Player 1 prepares, a hand-over screen follows, then Player 2 prepares. The opponent's build is hidden in the UI during preparation. Combat then plays on the shared stage, with the name of whoever must decide shown.
- All preparation goes through the same validated endpoints, with `?side=boss` for Player 2.
- Every combat answer is checked by the server: it must come from the side whose decision is pending, otherwise `400 "It is … decision"`.
- No boss policy is called, and no ML or profile data is written.
- Hidden information is hidden only in the local UI. Both players share one device, and the run view carries both builds.

**Online PvP is deferred** to a future version (V4 scope amendment). Nothing online is implemented or advertised.

## Verification

- `server/tests/integration/modes.test.ts` covers:
  - Prepared data paths;
  - Learning cold start, cross-run memory, start fresh, key isolation, the forecast used for decisions;
  - build-example alignment and isolation;
  - the PvP lifecycle, turn ownership, no boss policy, HTTP flow.
- `client/src/routes.test.ts` covers routes.
