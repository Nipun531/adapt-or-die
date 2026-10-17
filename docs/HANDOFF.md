# Handoff — The Boss Remembers, Version 2 (2026-10-17)

Read this first, then `PROGRESS.md` §1a (detailed log) and `docs/V2_IMPLEMENTATION_PLAN.md`.
Spec: `docs/V2_DEMANDS.md` (user answers in §11.1). Balance: `docs/V2_BALANCE.md`. ML: `docs/ML_WALKTHROUGH.md` §10b–10c.

## Where things stand

| Phase | State |
|---|---|
| 0 Safety baseline | done (`docs/V2_BASELINE.md`, DB backup `artifacts/backups/pre-v2-2026-10-16.sql`) |
| 1–2 Catalogue, economy, pierce, opening shot (engine 2.0.0) | done |
| 3 Balance harness + pierce tuning | done; non-pierce fixes **deferred to the next version** (user decision) |
| 4 Feasibility prediction + boss diversity (policy v2) | done |
| 5–6 Agents (sim-2.2.0), ML schema v3, ensemble candidate | done; **no model is eligible → boss uses the baseline** (honest; rules not relaxed) |
| 7 UI redesign "Court Deck" | done; reviewer verdict **ship**; `client/DESIGN.md` written |
| 8 Final verification | **in progress** — see below |

Git: `main` on github.com/Nipun531/adapt-or-die; last pushed `a2b09ef`. Commits after that are local until pushed.

## Phase 8 — done so far
- Pushed Phase 7.
- Added `server/tests/unit/catalog-guard.test.ts` (AC-CAT-2: no item ids outside the catalogue).
- Token contrast check: all text pairs ≥ 4.5:1 (lowest 4.69).
- Read-only dev-DB checks (engine 2.0.0): never more than one opening shot per round; rewards 50/10 win, 30/5 loss, +20 level-up; melee pierce happens; every round-1 decision basis = `rule`.
- Smoke sim on the test DB: 12 runs, 0 failures.
- Browser keyboard check of the Ranged+Melee choice (first time this was ever exercised in a browser): M and R work; **fixed a bug** where R/M did nothing while the "use for the rest of this round" checkbox had focus (`client/src/duel/Fight.tsx`).

## Phase 8 — still to do
1. Commit + run `npm test` (expect 160 server + 5 client), `npm run typecheck`, `npm run build`.
2. Write a short V1→V2 comparison (numbers already in `V2_BASELINE.md`, `V2_BALANCE.md` §3/§6, `ML_WALKTHROUGH.md` §10c) and tick the acceptance list of `V2_DEMANDS.md` §13 in `PROGRESS.md`.
3. Ask the user before: pushing; deactivating the stale active model `m20261010-200001-s2` (`npm run ml:activate -- --none`; it already falls back automatically, so this is cosmetic).

## Open decisions for the user (next version)
- Balance fixes in `V2_BALANCE.md` §4 (#1 DEX dominance first) and #8 round-1 STR, #9 hybrid build answering both styles (why ML has no leverage).
- More human play data before another ML round.

## How to run things
- DB: start Docker Desktop, `npm run db:up`.
- Play: `npm run dev` → http://localhost:5173. Safe testing without touching dev data: launch config `api-testdb` (`npm run dev:testdb`) + `client`. `npm test` wipes the test DB.
- Balance: `npm run balance`; boss bench: `npm run boss:bench`; ML: `npm run ml:status`, `npm run ml:train` (prints pure-model + ensemble verdicts; never auto-activates).
- UI review screenshots: `python client/scripts/capture-review.py client/.impeccable/review` (needs API + client running and a played run #2 on the test DB).
