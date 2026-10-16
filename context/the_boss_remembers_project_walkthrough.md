# The Boss Remembers — Project Walkthrough

> **Purpose:** This is the developer's map to the game and implementation. Keep it synchronized with the actual repository. The project should be understandable and manually tweakable, not a black box.

## 1. What the project is

The Boss Remembers is a browser-playable, text-focused medieval duel. The player and boss progress over multiple rounds. They earn XP and gold, improve their builds, and fight again. The boss examines prior fights and adapts instead of receiving arbitrary power increases.

The attached **Adaptive Boss Duel V1 Game Plan** is the authority for game rules. This document explains how the implementation should be organized; it must not silently introduce new mechanics.

## 2. Environment and required inputs

Antigravity must inspect the existing repository before choosing the final stack. Aim to run locally with as few external services as practical.

Ask the implementer for an exact checklist of anything required from you. Typical categories—not assumptions that every item is required—include:
- A database service or local database installation if needed.
- Database connection string and database name/user/password, supplied through environment variables.
- Runtime versions and package manager.
- Optional deployment credentials only if deployment is requested.
- Any model/runtime dependency that cannot be installed automatically.

**Never commit secrets.** Use local `.env` and commit only `.env.example` with placeholders. Do not paste credentials into source files, docs, screenshots, or logs.

## 3. Core lifecycle

The implementation should make this lifecycle explicit and testable:

1. **Run creation/resume:** load or create a run and initialize player/boss state from the game plan.
2. **Pre-round player decisions:** allow only valid stat allocation and equipment purchases/upgrades supported by the plan.
3. **Boss preparation:** analyse history, identify weaknesses, and make legal, affordable improvements.
4. **Combat:** resolve the rules on the authoritative backend. Record random rolls and calculation intermediates so the result can be audited and reproduced where practical.
5. **Result/rewards:** determine outcome, award specified XP/gold, apply level-up effects and stat points according to the plan.
6. **Post-round analysis:** record what happened, what the boss learned, and the evidence for its conclusions.
7. **Data collection:** append canonical round/action/observation records needed for training.
8. **Next round:** show updated state and allow the next preparation phase.

The UI should show these phases clearly. The backend, not the browser, must be authoritative for damage, rewards, prices, level-ups, and boss decisions.

## 4. Game rules and where to edit them

The exact rule tables and equations belong in `docs/GAME_MECHANICS.md`, copied faithfully from the game plan. In code, keep them centralized in a domain/game-rules layer rather than scattering constants through UI components.

Look for clearly named modules/functions corresponding to:
- Base stats and automatic level-up/stat-allocation increments.
- XP-to-level progression and rewards.
- Weapon/armor/shield catalogue and costs.
- Equipment-slot validation.
- Net attack/defense and final damage.
- DEX mitigation and bonus attacks.
- Ranged opening attacks and priority.
- Pierce chance and DEF-ignore resolution.

Use one authoritative implementation of each rule for both player and boss. When changing a formula, update tests and mechanics docs together.

### Formula fidelity matters

The modifier equations in the game plan are intentional for this version. Do not replace them with additive modifiers or a more conventional RPG formula without approval. Keep intermediate values visible in combat logs. If a rule is ambiguous, mark it in the docs and ask rather than inventing an effect.

DEX mitigation must not reduce damage negatively when the defender has no DEX advantage: clamp it to zero in that case. Ranged opening priority and bonus-attack thresholds need explicit tests too.

## 5. Architecture map

Antigravity may choose different filenames/frameworks, but responsibilities should remain separated. The final `docs/FILE_GUIDE.md` must describe the actual repository rather than treating this illustrative map as literal.

| Responsibility | What belongs here |
|---|---|
| Game domain/rules | Stats, formulas, equipment, validation, progression, rewards |
| Round orchestration | Preparation, combat, result, rewards, persistence |
| Combat/event log | Ordered events and calculation details |
| Boss analysis | Structured interpretation of the completed fight |
| Boss decision layer | Converts analysis into legal and affordable next-round choices |
| Simulation runner | Repeated games/rounds with recorded seeds and outputs |
| Data access | Runs, rounds, events, datasets, and model metadata |
| ML features | Inputs available at the time of prediction |
| ML training/evaluation | Data splits, training, metrics, versioned artifacts |
| ML inference | Loads eligible model and returns a prediction/score |
| Web/API | Validated endpoints and UI |
| Tests/docs/config | Correctness, setup, and developer explanations |

The game engine should work in tests without the browser. ML can inform decisions but must not bypass game rules.

## 6. Database and data lifecycle

The exact schema should be described in `docs/DATABASE_WALKTHROUGH.md`. The following are logical data groups, not a requirement to make one table/collection per group:

- **Run:** identity, timestamps, configuration, status, engine/simulator version.
- **Round:** run reference, round number, participants' pre/post state, outcome, rewards, seed/roll metadata.
- **Combat events/actions:** ordered events, attacker/defender, weapon/action, stats, formula intermediates, pierce roll, damage, remaining HP.
- **Progression/economy events:** XP, gold, level-ups, stat allocation, purchases, upgrades, resulting state.
- **Boss analysis/decision:** evidence, inferred weakness, selected change, cost, rationale, result.
- **Simulation batch:** configuration, seed strategy, progress, successes/failures, timestamps.
- **Raw observations/training examples:** source run/round/action, provenance, feature-schema version, target, validation status.
- **Model metadata:** artifact reference, model/feature versions, training data/version, metrics, timestamp, activation status.

Choose a schema appropriate to the selected database. Include indexes/constraints, migrations/setup instructions, and export tooling.

### Data must accumulate

Each manual round and simulation should append useful records. Re-running a simulation with the same seed should be reproducible where practical and must not silently overwrite prior history. Store whether data came from manual play or simulation. Keep raw records separate from derived training rows so features can be rebuilt.

## 7. ML walkthrough

### 7.1 Begin with a transparent baseline

A new project has no trustworthy historical dataset. Start with a transparent baseline/fallback and report that honestly. A model file existing on disk does not prove that a model is trained, eligible, loaded, or used.

A reasonable first task is predicting a player's likely next behavior from information available before that action. Antigravity may choose another first task if it explains why that is better aligned with adaptive boss behavior and the available data.

### 7.2 What is a training row?

A training row represents a well-defined prediction moment, such as immediately before a player action. It contains:

- **Features:** only information available at that prediction moment.
- **Label/target:** the behavior that actually happened next, recorded afterward.
- **Provenance:** run/round ID, source type (manual/simulation), feature schema version, engine/simulator version, and relevant seed/timestamp metadata.

Do not include future actions, final round outcome, future damage, or any other post-prediction facts in model input. That would be data leakage and could make evaluation misleadingly good.

The actual feature list and labels must be documented by the implementation. Do not invent in-game actions that the game itself does not support.

### 7.3 Training lifecycle

A clear pipeline should:

1. Read validated eligible records from persistent storage.
2. Build a versioned feature dataset.
3. Check data volume, missing values, class/action distribution, and invalid records.
4. Split data for evaluation without leaking related rounds across train/test where appropriate.
5. Train the selected model.
6. Evaluate against a simple baseline using appropriate metrics.
7. Save a versioned artifact and metadata.
8. Mark the model eligible only if documented data/evaluation requirements are met.
9. Load eligible artifacts for inference.
10. Record which model or fallback was used for every boss decision.

For a small project, a conventional classifier (potentially a tree-based model) may suffice. Choose based on target/data and keep it replaceable. Avoid deep learning or reinforcement learning without a demonstrated need.

### 7.4 Prediction is not the same as a decision

Keep the steps separate:

**Observed history → feature builder → model prediction → boss decision policy → rules/economy validation → purchase/allocation → saved decision**

The model might predict likely behavior or provide scores. A separate policy evaluates legal actions using the prediction, observed weaknesses, inventory, stat points, and gold. The policy must never buy unaffordable equipment or bypass the game rules.

Store prediction, model version, confidence/score if supported, fallback status, policy reasoning, selected action, and actual outcome. This makes adaptation debuggable.

### 7.5 How data grows

- Manual play creates canonical observations and outcomes.
- Batch simulations use the same schema and explicit simulation provenance.
- New records append after validation.
- Dataset statistics show total records, eligible training rows, invalid/duplicate rows, source split, and target distribution.
- Training is an explicit command/UI action unless a different safe policy is implemented and documented.
- New data does not mean the active model changes automatically. Change models only after a documented train/evaluate/activate step.
- Preserve older model versions and record which model made each decision.

Simulation quality matters: a simulator that repeats one strategy can teach the model that narrow pattern. Document the simulation agents/strategies that actually exist; don't claim varied training coverage unless implemented.

## 8. What to inspect when manually tweaking ML

The actual `docs/ML_WALKTHROUGH.md` should point to the real code files for:
1. Feature construction and schema version.
2. Target/label mapping.
3. Dataset filters and leakage prevention.
4. Model configuration and preprocessing.
5. Train/test split.
6. Evaluation metrics and baseline.
7. Minimum-data/activation rules.
8. Inference and fallback.
9. Boss decision policy and legal-action validator.
10. Model artifact/version handling.

When changing features or labels, update the schema version, dataset builder, tests, and docs. Retrain/evaluate. Do not compare scores across incompatible feature/label versions without explanation.

## 9. Simulations and repeatability

The simulation runner should accept a documented count and seed/configuration. It should show progress and save:
- Batch ID and configuration.
- Seed(s) and simulator version.
- Runs/rounds completed and failed.
- Outcomes and summary statistics.
- Dataset rows created.
- Errors with enough context to debug.

A seed should make a simulation repeatable as far as the implementation promises. Keep long-running simulation batches separate from normal web request handling if necessary.

## 10. Testing checklist

Test at least:
- Every formula and equipment value/cost.
- DEX mitigation clamps to zero when the defender has no DEX advantage.
- XP progression uses the 1.12 multiplier (Level 2 = 100, Level 3 = 112, Level 4 ≈ 125).
- Win/loss XP and gold rewards and level-up gold.
- Automatic level-up increases and stat allocation.
- Two-slot equipment restrictions.
- Ranged opening attack and DEX priority if both sides have ranged weapons.
- DEX bonus-attack thresholds.
- Pierce chance and DEF-ignore percentage.
- Boss cannot make illegal/unaffordable choices.
- Round/events/rewards/decisions persist after restart.
- Simulation seed/configuration is reproducible where promised.
- Training rows do not leak future information.
- Fallback works when no model is trained or model loading fails.
- Metadata accurately reports what was trained/loaded/used.
- Full round → rewards → analysis → next-round adaptation works.

## 11. Operational checklist

Follow the actual repository's `README.md` and verify:
- [ ] Dependencies install cleanly.
- [ ] `.env.example` is complete and no secrets are committed.
- [ ] Database setup/migrations work.
- [ ] Web app starts and is playable.
- [ ] A full multi-round run works.
- [ ] History persists after restart.
- [ ] Simulation batches run and increase stored data.
- [ ] Dataset export works.
- [ ] Model training/evaluation commands run.
- [ ] UI/API accurately reports model vs fallback.
- [ ] Tests pass, or failures are clearly reported.
- [ ] Source/config files have useful comments.
- [ ] `docs/FILE_GUIDE.md` covers actual files.
- [ ] Mechanics, architecture, database, ML, and simulation docs match implementation.

## 12. Project truths to keep visible

- Game rules and ML policy are separate.
- The boss follows the same economy/progression rules as the player.
- A large dataset does not automatically mean a reliable model.
- Simulated data is not human data; track provenance.
- More data helps only if valid and sufficiently varied.
- Transparent fallback is better than a misleading “AI” label.
- Every important boss adaptation needs an inspectable reason.
- Never silently change formulas or invent unapproved mechanics.
