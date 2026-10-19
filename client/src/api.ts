/**
 * Thin typed wrapper over the server's REST API (see server/src/api/app.ts).
 * The client never computes rules itself: every number shown comes from these responses.
 */

export type Side = 'player' | 'boss';
export type StatKey = 'hp' | 'str' | 'def' | 'dex';
export type AttackMode = 'melee' | 'ranged' | 'unarmed';

export interface Loadout { hand1: string | null; hand2: string | null; armour: string | null }
export interface Stats { hp: number; str: number; def: number; dex: number }
export interface Derived {
  maxHp: number; strModSum: number; defModSum: number; dexModSum: number;
  netAtk: number; netDef: number; netDexRaw: number; effDex: number;
  attackModes: AttackMode[]; rangedWeaponId: string | null; meleeWeaponId: string | null;
}
export type SupplyAction = 'buy_stim' | 'upgrade_slots' | 'upgrade_effectiveness';
export interface Supplies { stims: number; slots: number; effectiveness: number }
export interface Combatant {
  side: Side; level: number; xp: number; gold: number; statPoints: number;
  stats: Stats; inventory: string[]; loadout: Loadout; derived: Derived; xpToNext: number;
  /** V3 healing stims (absent on pre-V3 runs). */
  supplies?: Supplies;
  /** V3: heal size and the price / blocking reason of each supply action (server-computed). */
  supplyInfo?: { healFraction: number; actions: Record<SupplyAction, { cost: number; problem: string | null }> } | null;
}
export interface Item {
  id: string; name: string; category: 'melee' | 'ranged' | 'shield' | 'armour';
  family: 'blade' | 'blunt' | 'polearm' | 'bow' | 'shield' | 'armour'; cost: number;
  mods: { str: number; def: number; dex: number };
  pierce?: { chance: number; defIgnore: number; placeholder: boolean };
  /** V3 combat properties. */
  combat?: { blockBonus?: number; stunBoost?: number; canStun?: boolean; dodgeCounter?: number };
}
export interface Catalog {
  items: Item[];
  /** Ids that only exist in older engines (shown for historical runs). */
  legacyItems: Item[];
  rules: {
    engineVersion: string;
    baseStats: Stats; levelUpIncrease: Stats; statAllocationIncrease: Stats; statPointsPerLevel: number; initialStatPoints: number;
    rewards: { xpWin: number; xpLoss: number; goldWin: number; goldLoss: number; goldLevelUp: number };
    xpCurve: { level: number; xpToNext: number }[];
    dexBonusThresholds: { advantage: number; attacks: number }[];
    mitigationRoll: [number, number];
    defaultMaxRounds: number;
    startingGold?: number;
    /** V3 combat numbers (null before engine 3.0.0). */
    combat?: {
      dodge: { perDexPoint: number; cap: number; base: number };
      block: { defFactor: number; cap: number };
      counter: { blockMultiplier: number; dodgeMultiplier: number; blockCounterStun: number };
      stun: { threshold: number; extraDamageFraction: number };
      round: { turnLimit: number };
    } | null;
  };
}
export interface RoundRow {
  id: number; round_number: number; status: string; winner: Side | null;
  player_hp_end: number | null; boss_hp_end: number | null; attack_count: number;
}
export interface RunRow {
  id: number; engine_version: string; source: 'manual' | 'simulation'; status: string; end_reason: string | null; max_rounds: number;
  seed: string; player_strategy: string | null; simulation_batch_id: number | null; created_at: string;
}
export interface RunView {
  run: RunRow;
  player: Combatant;
  boss: Combatant;
  rounds: RoundRow[];
  record: { wins: number; losses: number };
  inProgressRoundId: number | null;
  lastAnalysis: { analysis: Analysis; round_number: number } | null;
  lastDecision: Decision | null;
}
export interface AttackCalc {
  attackValueSource: 'netAtk' | 'effDex'; attackValue: number; defenderNetDef: number;
  pierce: { chance: number; defIgnore: number; roll: number; success: boolean; placeholder: boolean; weaponId?: string; extraDamage?: number } | null;
  defUsed: number; netDamage: number; attackerDex: number; defenderDex: number; dexRatio: number;
  mitigationUniform: number; mitigationRoll: number; rawMitigation: number; mitigation: number;
  mitigationClamped: boolean; finalDamage: number;
}
export type DefenseAction = 'block' | 'dodge';
export interface DefenseResult {
  action: DefenseAction | 'none'; source: string; reason?: string; chance: number; roll: number; success: boolean;
  shaved: number; wouldBeDamage: number; heavy?: boolean;
  counter: { type: DefenseAction; chance: number; roll: number; success: boolean } | null;
  noCounterReason?: string;
}
export interface StunChange {
  gains: { side: Side; amount: number; cause: 'hit' | 'heavy_block' | 'block_counter' }[];
  triggered: { target: Side; extraDamage: number; weaponId: string } | null;
  meters: Record<Side, number>;
}
export interface CombatEvent {
  seq: number; turn: number; phase: 'opening' | 'regular' | 'dex_bonus' | 'counter'; attacker: Side; defender: Side;
  mode: AttackMode; weaponId: string | null; choiceSource: string; choiceReason?: string;
  calc: AttackCalc; damage: number; defenderHpBefore: number; defenderHpAfter: number; attackerHp: number;
  /** V3 only. */
  kind?: 'attack' | 'counter'; parentSeq?: number; defense?: DefenseResult; stun?: StunChange;
}
/** V3: lost turns, stims used and the turn limit, in order with the events (shared seq). */
export interface CombatNote {
  seq: number; turn: number; side: Side; kind: 'skip' | 'stim' | 'turn_limit';
  detail: { reason?: string; heal?: number; hpBefore?: number; hpAfter?: number; stimsLeft?: number; hpShare?: Record<Side, number> };
}
export interface DefenseOdds {
  block: { chance: number; counterPossible: boolean; heavy: boolean };
  dodge: { chance: number; counterPossible: boolean; counterChance: number };
  expectedDamage: number; expectedShaved: number;
}
export interface PendingChoice {
  side: Side; kind?: 'attack_mode' | 'defense' | 'stim'; options: string[]; phase: string; turn: number;
  incoming?: { attacker: Side; mode: AttackMode; weaponId: string | null; phase: string; turn: number; counterable: boolean };
  odds?: DefenseOdds; heal?: number;
}
/** Answer to a paused round: exactly one of mode / defense / stim. */
export interface PlayerAnswer { mode?: AttackMode; repeat?: boolean; defense?: DefenseAction; stim?: boolean }
export interface Weakness { code: string; severity: number; evidence: string; metrics: Record<string, number> }
export interface Analysis {
  roundNumber: number; outcome: 'boss_won' | 'boss_lost';
  hp: { playerEnd: number; playerMax: number; bossEnd: number; bossMax: number };
  playerProfile: { loadout: string[]; netAtk: number; netDef: number; effDex: number; attacksByMode: Record<string, number>; rangedShare: number | null };
  damageTaken: { total: number; byMode: Record<string, number>; pierces: number; defIgnoredTotal: number };
  damageDealt: { total: number; perAttack: number };
  initiative: { bossEffDex: number; playerEffDex: number; actedFirst: Side; playerBonusPerTurn: number; bossBonusPerTurn: number };
  weaknesses: Weakness[];
  conclusions: string[];
}
type StyleScores = { ranged: number | null; melee: number | null };
export type Archetype = 'bruiser' | 'bulwark' | 'duelist' | 'marksman' | 'piercer' | 'hybrid';
export interface ScoredPlan {
  label: string; cost: number;
  /** Policy v2: weighted expected HP margin (−1..1). Older decisions: weighted win rate (0..1). */
  weighted: number;
  analytic: StyleScores; winRate?: StyleScores; margin?: StyleScores;
  /** Policy v2 only. */
  archetype?: Archetype;
  allocation: Partial<Stats>; purchases: string[]; loadout: Loadout;
}
export interface Decision {
  id: number; for_round_number: number;
  predictor: {
    kind: 'model' | 'fallback';
    /** Engine ≥ 2.0.0 only. */
    basis?: 'rule' | 'unknown' | 'model' | 'baseline';
    probabilityRanged: number | null; baselineProbability: number | null;
    feasibility?: { rangedFeasible: boolean; reason: string };
    modelVersion: string | null; fallbackReason: string | null; featureSchemaVersion: string;
  };
  evidence: {
    sourceRound: number | null;
    weaknesses: { code: string; evidence: string; addressedBy: string[]; addressed: boolean }[];
    observedPlayer: { level: number; stats: Stats; loadout: string[] };
    scenarios: { kind: string; label?: string; weight?: number; preferredMode: string; hypotheticalItems: string[] }[];
    deltas: Record<string, number>;
    constraints: { goldAvailable: number; statPointsAvailable: number };
  };
  options: { candidatesEvaluated: number; current: ScoredPlan; alternatives: ScoredPlan[] };
  selected: {
    plan: ScoredPlan; rationale: string[];
    /** Policy v2 (engine ≥ 2.0.0) only. */
    policyVersion?: 'v2-diverse' | 'v1-deterministic';
    band?: { label: string; archetype: Archetype; weighted: number; cost: number; probability: number }[] | null;
    draw?: number | null;
  };
  actions: { kind: string; detail: any }[];
  gold_spent: number;
}
export interface Initiative {
  tieBreakRoll: number; tieWinner: Side; dexTie: boolean; openingOrder: Side[]; turnOrder: [Side, Side];
  /** Engine ≥ 2.0.0 only. */
  openingEligible?: Side[]; openingRule?: 'none' | 'single' | 'dex_advantage' | 'tie_none';
  bonusAttacks: Record<Side, number>;
}
export interface Snapshot { side: Side; level: number; stats: Stats; loadout: Loadout; derived: Derived }
export interface ProgressionRow { id: number; side: Side; kind: string; actor: string; payload: any }
export interface RoundDetail {
  round: RoundRow & {
    run_id: number; seed: number; engine_version: string; initiative: Initiative;
    player_snapshot: Snapshot; boss_snapshot: Snapshot;
    pending_choice: PendingChoice | null;
    hp: Record<Side, number> | null; error: string | null;
    /** V3: live meters while in progress; how the round ended. */
    stun?: Record<Side, number> | null; stims?: Record<Side, number> | null; end_reason?: string | null;
  };
  events: CombatEvent[];
  notes?: CombatNote[];
  analysis: Analysis | null;
  decision: Decision | null;
  progression: ProgressionRow[];
}
export interface Batch {
  id: number; seed: string; status: string; config: { runs: number; maxRounds: number; strategies: string[]; seed: string };
  simulator_version: string; runs_requested: number; runs_completed: number; runs_failed: number;
  rounds_completed: number; examples_created: number; created_at: string; finished_at: string | null;
  summary: { byStrategy?: { strategy: string; runs: number; rounds: number; player_wins: number; boss_wins: number; boss_win_rate: number | null }[]; labelDistribution?: { ranged: number; melee: number; invalid: number } };
  errors: { runIndex?: number; strategy?: string; seed?: string; message: string }[];
}
export interface ModelRow {
  id: number; version: string; model_type: string; feature_schema_version: string; engine_version: string; artifact_path: string;
  params?: { blend_weight?: number } & Record<string, unknown>;
  metrics: Record<string, number | null>; baseline_metrics: Record<string, number | null>;
  data_stats: Record<string, any>; eligible: boolean; eligibility_reasons: string[]; is_active: boolean;
  training_seconds: number; trained_at: string; activated_at: string | null; snapshot_rows: number | null;
}
export interface MlStatus {
  task: string; featureSchemaVersion: string; engineVersion: string; featureNames: string[];
  dataset: {
    total: number; valid: number; invalid: number; distinctRuns: number;
    labelDistribution: { ranged: number; melee: number }; sourceDistribution: Record<string, number>;
    otherSchemaRows: number; otherEngineRows: number;
    byEngine: { engine_version: string; valid: number; invalid: number; runs: number }[];
    rawRoundsCompleted: number; roundsMissingExamples: number;
  };
  snapshots: { id: number; row_count: number; file_path: string; created_at: string }[];
  models: { total: number; eligible: number };
  activeModel: { version: string; eligible: boolean; engine_version: string } | null;
  trainingInProgress: boolean;
  latestDecision: { run_id: number; for_round_number: number; kind: string; model_version: string | null; fallback_reason: string | null; probability_ranged: number | null; source: string; created_at: string } | null;
  decisionUsage: Record<string, number>;
  /** Current-engine decisions by prediction basis (rule / unknown / model / baseline). */
  decisionBasis?: Record<string, number>;
  python: { ok: boolean; detail: string } | null;
}

/** kind: 'network' = the API (or its database) could not be reached; 'rule' = the server refused the action (400);
 *  'http' = any other server error. The UI words each one differently. */
export class ApiError extends Error {
  constructor(message: string, public kind: 'network' | 'rule' | 'http' = 'http') {
    super(message);
  }
}

const UNREACHABLE = 'The API at port 4000 is not answering. Start it with `npm run dev` (and Docker for the database), then try again.';

async function call<T>(method: string, url: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${url}`, {
      method,
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(UNREACHABLE, 'network');
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    // The dev proxy answers 500/502/504 with no JSON body when the API process is down.
    if (!data && res.status >= 500) throw new ApiError(UNREACHABLE, 'network');
    const msg: string = data?.error ?? `${res.status} ${res.statusText}`;
    if (/database|PostgreSQL|ECONNREFUSED/i.test(msg) && res.status >= 500) throw new ApiError(msg, 'network');
    throw new ApiError(msg, res.status === 400 ? 'rule' : 'http');
  }
  return data as T;
}

export interface BuildPreview {
  current: Derived;
  /** null when the loadout is illegal (see `problem`). */
  preview: Derived | null;
  stats: Stats; loadout: Loadout; purchases: string[]; cost: number; affordable: boolean; problem: string | null;
}

export const api = {
  health: () => call<{ ok: boolean; database: string; engineVersion: string }>('GET', '/health'),
  catalog: () => call<Catalog>('GET', '/catalog'),
  listRuns: (source?: string, offset = 0) => call<{ runs: (RunRow & { rounds_completed: number; player_wins: number; boss_wins: number })[]; total: number }>(
    'GET', `/runs?limit=25&offset=${offset}${source ? `&source=${source}` : ''}`),
  createRun: (maxRounds: number) => call<RunView>('POST', '/runs', { maxRounds }),
  getRun: (id: number) => call<RunView>('GET', `/runs/${id}`),
  endRun: (id: number) => call<RunView>('POST', `/runs/${id}/end`),
  allocate: (id: number, stat: StatKey, points: number) => call<RunView>('POST', `/runs/${id}/allocate`, { stat, points }),
  buy: (id: number, itemId: string, loadout?: Loadout) => call<RunView>('POST', `/runs/${id}/buy`, loadout ? { itemId, loadout } : { itemId }),
  preview: (id: number, req: { loadout?: Loadout; allocation?: Partial<Stats> }) => call<BuildPreview>('POST', `/runs/${id}/preview`, req),
  setLoadout: (id: number, loadout: Loadout) => call<RunView>('POST', `/runs/${id}/loadout`, loadout),
  startRound: (id: number) => call<RoundDetail>('POST', `/runs/${id}/rounds`),
  getRound: (id: number) => call<RoundDetail>('GET', `/rounds/${id}`),
  choose: (id: number, mode: AttackMode, repeat: boolean) => call<RoundDetail>('POST', `/rounds/${id}/choice`, { mode, repeat }),
  answer: (id: number, a: PlayerAnswer) => call<RoundDetail>('POST', `/rounds/${id}/choice`, a),
  supplies: (id: number, action: SupplyAction) => call<RunView>('POST', `/runs/${id}/supplies`, { action }),
  strategies: () => call<{ strategies: { name: string; description: string }[]; limits: { maxRuns: number; maxRounds: number }; running: number | null }>('GET', '/simulations/strategies'),
  listBatches: () => call<{ batches: Batch[]; running: number | null }>('GET', '/simulations'),
  getBatch: (id: number) => call<Batch>('GET', `/simulations/${id}`),
  startBatch: (cfg: { runs: number; maxRounds: number; strategies: string[]; seed?: string }) => call<Batch>('POST', '/simulations', cfg),
  mlStatus: (ping = false) => call<MlStatus>('GET', `/ml/status${ping ? '?ping=1' : ''}`),
  models: () => call<{ models: ModelRow[] }>('GET', '/ml/models'),
  buildDataset: () => call<{ inserted: number; scanned: number }>('POST', '/ml/build-dataset'),
  exportDataset: () => call<{ snapshotId: number; csvPath: string; jsonPath: string; rowCount: number }>('POST', '/ml/export'),
  train: (activate: boolean) => call<any>('POST', '/ml/train', { activate }),
  activate: (version: string | null) => call<MlStatus>('POST', '/ml/activate', { version }),
};
