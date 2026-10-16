# Antigravity Build Prompt — The Boss Remembers

You are the lead engineer responsible for turning the attached **Adaptive Boss Duel V1 Game Plan** into a working, locally runnable web game. The project is called **The Boss Remembers** (also referred to as Adaptive Boss Duel).

Read the attached game-plan document completely before coding. Treat its mechanics as the source of truth. Implement the game, make reasonable engineering/design decisions, and explain those decisions. Do not redesign the game's rules.

## 1. Goal

Build a complete, playable browser-based game in which a player fights an adaptive medieval boss over multiple rounds. The game must have:
- A real webpage where I can play rounds, view combat logs, inspect both builds, spend rewards, level up, and see how the boss adapts.
- Persistent storage for runs, rounds, actions, results, progression, boss decisions, simulation data, and model versions/metadata as appropriate.
- A reproducible simulation runner that can play many rounds automatically and save training data.
- An ML-ready architecture that starts with a transparent baseline and later trains/uses a model based on accumulated simulation and real-play data.
- Detailed documentation so I can understand and manually modify the game and ML code.

Functionality, correctness, clarity, and explainability matter more than unnecessary infrastructure.

## 2. Non-negotiable rules

1. **Preserve the mechanics in the attached document.** Implement its stats, starting values, level-up increases, stat-allocation increases, XP curve, rewards, equipment values/costs, equipment slots, damage equations, DEX mitigation behavior, ranged opening attack, DEX bonus attacks, and piercing behavior.
2. Do not silently “correct,” simplify, rebalance, or replace my formulas. Retain the modifier formulas exactly as written. If a formula is ambiguous or internally inconsistent, document the ambiguity and ask me before changing the rule. Isolate formulas behind clearly named functions.
3. No magic in V1. Use physical medieval combat and the listed equipment only.
4. Do not invent new stats, items, weapons, skills, classes, currencies, or combat mechanics. If the plan mentions skills but specifies no actual skills, create only the architecture/placeholder needed for future support; do not invent skill content/effects. Flag blocking ambiguities.
5. Player and boss use the same progression, equipment, combat, and economy rules unless the plan explicitly says otherwise.
6. Do not use fake persistence disguised as a database.
7. Do not claim the project uses ML if its behavior is only hard-coded rules. Clearly label baseline, trained model, and actual model usage.
8. You have leeway over framework, components, UI, database schema, and ML implementation. Choose the simplest maintainable design. Explain trade-offs in the walkthrough instead of asking me to make every engineering decision.
9. Do not stop at a plan or mock UI. Implement, run, test, fix issues, and report what works and what remains.

## 3. Inspect the environment and report prerequisites first

Before irreversible changes:
- Inspect the repository/workspace, existing code, package managers, installed runtimes, and existing database/ML infrastructure.
- Reuse useful code and conventions instead of replacing files indiscriminately.
- Give me a concise **Prerequisites / Inputs Needed** report. State exactly what I must provide (database/service details, credentials if needed, local software, etc.). Separate required for local development, required only for deployment, and optional.
- Never ask me to commit or hardcode secrets. Use environment variables and provide a complete `.env.example` with safe placeholders.
- If a required service is not configured, explain the simplest way to configure it. Do not fabricate credentials or claim a database is connected when it is not.
- Prefer minimal external dependencies. Do not require paid services without explaining why and the likely costs.
- If the repository is empty, create the project structure. Otherwise summarize what exists and how you will integrate it before continuing.

Proceed with choices that do not need my input. Ask a focused batch of questions only if genuinely blocked.

## 4. Gameplay and round lifecycle

Implement the game loop from the attached plan:

1. Create or resume a run.
2. Show player/boss stats, levels, equipment, inventory/economy, and history.
3. Before a round, allow only progression/equipment decisions supported by the plan: spend gold, buy/upgrade supported equipment, and allocate available stat points. Do not add mechanics.
4. Boss reviews history, analyses the previous fight, identifies weaknesses, and makes legal progression/equipment decisions before the next round.
5. Resolve combat on the authoritative backend. Record random seeds/rolls and intermediate calculation values so fights can be audited and reproduced where practical.
6. Show a chronological combat log explaining attacks, damage calculations, ranged opening attacks, DEX bonus attacks, piercing/DEF ignore, remaining HP, and the result.
7. Apply specified XP/gold rewards, automatic level-up increases, and stat points according to the plan.
8. Persist the round, events, results, rewards, state changes, boss analysis, and decisions.
9. Prepare the next round.

Document the order of competing/simultaneous effects where the plan is silent. Do not invent a new effect. Ask me about implementation-blocking rule ambiguities; for minor technical choices, use a consistent approach and document it.

## 5. Boss adaptation: after and before each round

### After a round
Generate a structured analysis based on observed evidence, including:
- Player equipment and action pattern where actions exist.
- Damage dealt/received and its source.
- Outcome.
- Boss stats/equipment and weaknesses exposed.
- What the boss concludes it lacks, with evidence rather than an unexplained grade.

Persist this analysis. A single letter grade is not enough to drive adaptation.

### Before the next round
Use the analysis and history to select legal, affordable improvements supported by the plan, such as stat allocation and equipment purchases/upgrades. Every choice obeys the same economy/progression rules as the player.

For each decision, store/show the evidence, inferred need, relevant options/constraints, selected action, reason/goal, cost, and resulting state change. Prevent unaffordable purchases, negative gold, invalid stat allocation, and equipment combinations violating the two-slot setup. Do not call an upgrade “optimal” without justification. Keep decisions explainable and testable.

## 6. ML and accumulating data

Keep the game rules and damage resolution in ordinary, testable application code. ML must not bypass or mutate game rules.

### Data collection
- Save manual-play rounds and automated simulation data using the same canonical event/feature format.
- Make simulations repeatable with recorded seeds/configuration.
- Support batches with progress and a summary of completed/failed simulations.
- Store provenance: manual vs simulation, run/round IDs, simulator version, feature-schema version, timestamp, and seed where applicable.
- Prevent training leakage: a model input cannot include information only known after its prediction point.
- Do not silently overwrite historical data. Use append-only or versioned data and document retention/deletion.
- Track dataset size, label/action distribution, invalid records, model version, training time, evaluation metrics, and dataset/feature version.

### ML task and lifecycle
Choose a sensible first ML task. A reasonable starting task is predicting a player's likely next behavior from information available before that action; the boss decision layer can use that prediction alongside the combat profile to choose legal adaptations. If you choose another task, explain why and keep it aligned with adaptive boss behavior.

Do not train on an empty/tiny dataset and claim reliability. Include:
- Transparent baseline/fallback when data is insufficient or the model unavailable.
- A documented model-eligibility rule.
- Training pipeline and held-out evaluation where appropriate.
- Versioned model artifacts and metadata.
- An inference interface used by the boss decision layer.
- Logs showing trained model vs fallback and why.
- Documentation of features, labels, preprocessing, training, evaluation, limitations, and retraining.

The model can predict or score. A separate decision policy must turn that into a legal action under game rules, inventory, points, and gold. Do not let the model buy or allocate anything outside the constrained decision layer.

### Growing dataset
Every completed manual round and simulation should append useful records to persistent storage. Running more simulations should increase the dataset, subject to validation/deduplication. Provide a UI or command to launch batches and view counts/status. Provide a practical CSV/JSON/Parquet export and a documented retrain/evaluate workflow. Keep raw records separate from derived training rows so features can be rebuilt after schema changes.

Make it clear in UI/docs whether data has been collected, a model trained, a model loaded, and a trained model actually used for the latest decision. Do not imply online learning during a fight unless implemented. Prefer explicit, repeatable retraining jobs.

## 7. Database and persistence

Choose a database appropriate to the repo and stack. A relational database can suit run → round → action history; a document database can suit a MERN implementation. Pick one, explain why, and make it runnable.

Persist enough information for:
- Runs and status/configuration.
- Player/boss state and progression.
- Rounds and outcomes.
- Ordered combat events/actions and calculation details.
- Rewards, purchases, allocations, equipment/inventory.
- Boss analysis and decisions.
- Simulation batches and run metadata.
- Raw observations and derived ML examples.
- Feature schema/simulator versions.
- Model metadata, evaluation results, and artifact location/reference.

Include useful indexes/constraints, migrations or schema setup, seed/demo data clearly marked as such, environment variables, connection checks, setup instructions, and actionable errors. Never expose secrets in logs/UI. Tell me exactly which environment variables I need to configure.

## 8. Web app

Build a genuinely playable, responsive browser UI. You decide the visual design; prioritize clarity and a cohesive medieval-duel feel over excessive decoration.

Make it easy to:
- Start/resume a run.
- View player/boss level, HP, stats, equipment, points, gold, XP, and next-level progress.
- Inspect legal purchases/upgrades and costs.
- Allocate points and equip items before a round.
- Start a round and follow a readable combat log.
- Inspect results, rewards, level-ups, and state changes.
- Inspect boss post-round analysis and pre-round decisions.
- Run simulation batches.
- View data counts and ML status, including fallback vs trained model.
- Browse past runs/rounds/logs.

Include empty/loading/success/error states. Validate on the server as well as the UI. The client must not be authoritative for damage, costs, rewards, progression, or boss decisions.

## 9. Architecture and code quality

Choose the exact stack after inspecting the workspace. Keep it understandable and not overengineered. Separate these responsibilities, through modules/packages or clear layers:
- Game rules/combat.
- Progression/economy/equipment validation.
- Round orchestration and event logging.
- Boss analysis and decision policy.
- Simulation runner.
- Data access/persistence.
- ML feature construction, training, evaluation, and inference.
- API/backend.
- Web UI.

Use clear names, focused functions, and types/schemas where practical. Add useful comments to **every source/config file** explaining its purpose and non-obvious logic. Avoid redundant comments on every trivial line. Document formula inputs/intermediate values.

Add automated tests for formulas, DEX mitigation clamp, XP curve, rewards, equipment slots, ranged opening priority, piercing/DEF ignore, boss affordability, persistence, simulation reproducibility, ML fallback, and feature leakage where practical. Include integration tests for run → round → rewards → adaptation.

## 10. Required documentation

Create these files in the repo:

1. `README.md`: features, chosen stack, prerequisites, quick start, env setup, database setup, run website, simulations, train/evaluate ML, tests, troubleshooting.
2. `docs/GAME_MECHANICS.md`: faithful mechanics/formulas/tables; mark unresolved ambiguities instead of inventing rules.
3. `docs/ARCHITECTURE.md`: components, request/data flow, database design, round lifecycle, simulation and ML interaction.
4. `docs/ML_WALKTHROUGH.md`: beginner-friendly details of ML task/target, training-row meaning, feature/label definitions, prediction-time boundary, preprocessing, baseline, model choice, training/evaluation/inference, boss decision layer, retraining, artifact/version management, data growth, limitations, debugging, and how to tweak manually.
5. `docs/DATABASE_WALKTHROUGH.md`: tables/collections, fields, relations, indexes, migrations, data lifecycle, environment variables, backup/export, and inspecting records.
6. `docs/FILE_GUIDE.md`: purpose of every actual project file and where to make common changes; keep synchronized with repo. Source/config files also need useful internal comments.
7. `docs/SIMULATIONS.md`: batch commands/settings, seeds, outputs, failures, export, retraining/evaluation.

Never document features as implemented before they exist. Docs must match the actual code.

## 11. Acceptance criteria

Not complete until:
- I can install dependencies and run the documented commands.
- I can play a full multi-round run in the browser.
- Player and boss follow the same rules/economy/progression.
- Formulas and equipment values/costs match the plan.
- Combat logs allow damage calculations to be audited.
- History, rewards, progression, analyses, and decisions persist across restarts.
- Boss adaptations are legal, evidence-based, and explained.
- Simulations run repeatedly and grow persistent data.
- I can train/evaluate a model and inspect its metadata/metrics.
- App accurately reports trained model vs fallback.
- Critical rules and main loop are tested.
- Docs enable manual changes to mechanics and ML.
- No committed credentials, fake ML claims, dead buttons, mock-only features, or unexplained placeholders.

## 12. Work in milestones, but continue until done

**A — Inspect:** inspect workspace, report prerequisites/credentials, flag only blocking mechanics ambiguities.  
**B — Design:** choose stack/database/ML baseline, sketch schema/architecture, record decisions.  
**C — Core game:** implement formulas, progression, equipment/economy, combat log, persistence, tests.  
**D — Boss/simulations:** implement analysis, decision layer, simulation runner, reproducible data collection.  
**E — ML:** implement baseline, dataset, training/evaluation/inference, model metadata and honest fallback.  
**F — Web UI:** finish playable site and connect controls to backend behavior.  
**G — Verify/docs:** run tests, fix failures, smoke-test locally if possible, finish docs and commands.

At each milestone report completion, changes, commands/tests and results, and anything needed from me. Continue unless blocked; do not stop after planning.

### Final report must include
- Implemented features and chosen stack/database/model.
- Exact prerequisites and anything I still need to provide.
- Commands for install, env setup, migrations, web app, simulations, training/evaluation, and tests.
- Test results and known limitations/unresolved mechanics questions.
- Paths to all docs.
- Whether a trained model was actually trained and used in the latest boss decision, or fallback was used.

Begin by reading the attached game plan and inspecting the workspace, then provide the prerequisites report and proceed.
