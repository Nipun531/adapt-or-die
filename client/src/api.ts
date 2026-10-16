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
export interface Combatant {
  side: Side; level: number; xp: number; gold: number; statPoints: number;
  stats: Stats; inventory: string[]; loadout: Loadout; derived: Derived; xpToNext: number;
}
export interface Item {
  id: string; name: string; category: 'melee' | 'ranged' | 'shield' | 'armour'; cost: number;
  mods: { str: number; def: number; dex: number };
  pierce?: { chance: number; defIgnore: number; placeholder: boolean };
}
export interface Catalog {
  items: Item[];
  rules: {
    baseStats: Stats; levelUpIncrease: Stats; statAllocationIncrease: Stats; statPointsPerLevel: number; initialStatPoints: number;
    rewards: { xpWin: number; xpLoss: number; goldWin: number; goldLoss: number; goldLevelUp: number };
    xpCurve: { level: number; xpToNext: number }[];
    dexBonusThresholds: { advantage: number; attacks: number }[];
    mitigationRoll: [number, number];
    defaultMaxRounds: number;
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
  pierce: { chance: number; defIgnore: number; roll: number; success: boolean; placeholder: boolean } | null;
  defUsed: number; netDamage: number; attackerDex: number; defenderDex: number; dexRatio: number;
  mitigationUniform: number; mitigationRoll: number; rawMitigation: number; mitigation: number;
  mitigationClamped: boolean; finalDamage: number;
}
export interface CombatEvent {
  seq: number; turn: number; phase: 'opening' | 'regular' | 'dex_bonus'; attacker: Side; defender: Side;
  mode: AttackMode; weaponId: string | null; choiceSource: string; choiceReason?: string;
  calc: AttackCalc; damage: number; defenderHpBefore: number; defenderHpAfter: number; attackerHp: number;
}
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
export interface ScoredPlan {
  label: string; cost: number; weighted: number;
  analytic: { ranged: number; melee: number }; winRate?: { ranged: number; melee: number };
  allocation: Partial<Stats>; purchases: string[]; loadout: Loadout;
}
export interface Decision {
  id: number; for_round_number: number;
  predictor: { kind: 'model' | 'fallback'; probabilityRanged: number; baselineProbability: number; modelVersion: string | null; fallbackReason: string | null; featureSchemaVersion: string };
  evidence: {
    sourceRound: number | null;
    weaknesses: { code: string; evidence: string; addressedBy: string[]; addressed: boolean }[];
    observedPlayer: { level: number; stats: Stats; loadout: string[] };
    scenarios: { kind: string; preferredMode: string; hypotheticalItems: string[] }[];
    deltas: Record<string, number>;
    constraints: { goldAvailable: number; statPointsAvailable: number };
  };
  options: { candidatesEvaluated: number; current: ScoredPlan; alternatives: ScoredPlan[] };
  selected: { plan: ScoredPlan; rationale: string[] };
  actions: { kind: string; detail: any }[];
  gold_spent: number;
}
export interface Initiative {
  tieBreakRoll: number; tieWinner: Side; dexTie: boolean; openingOrder: Side[]; turnOrder: [Side, Side];
  bonusAttacks: Record<Side, number>;
}
export interface Snapshot { side: Side; level: number; stats: Stats; loadout: Loadout; derived: Derived }
export interface ProgressionRow { id: number; side: Side; kind: string; actor: string; payload: any }
export interface RoundDetail {
  round: RoundRow & {
    run_id: number; seed: number; engine_version: string; initiative: Initiative;
    player_snapshot: Snapshot; boss_snapshot: Snapshot;
    pending_choice: { side: Side; options: AttackMode[]; phase: string; turn: number } | null;
    hp: Record<Side, number> | null; error: string | null;
  };
  events: CombatEvent[];
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
  latestDecision: { run_id: number; for_round_number: number; kind: string; model_version: string | null; fallback_reason: string | null; probability_ranged: number; source: string; created_at: string } | null;
  decisionUsage: Record<string, number>;
  python: { ok: boolean; detail: string } | null;
}

export class ApiError extends Error {}

async function call<T>(method: string, url: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${url}`, {
      method,
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError('Cannot reach the server. Is `npm run dev` running?');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(data.error ?? `${res.status} ${res.statusText}`);
  return data as T;
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
  buy: (id: number, itemId: string) => call<RunView>('POST', `/runs/${id}/buy`, { itemId }),
  setLoadout: (id: number, loadout: Loadout) => call<RunView>('POST', `/runs/${id}/loadout`, loadout),
  startRound: (id: number) => call<RoundDetail>('POST', `/runs/${id}/rounds`),
  getRound: (id: number) => call<RoundDetail>('GET', `/rounds/${id}`),
  choose: (id: number, mode: AttackMode, repeat: boolean) => call<RoundDetail>('POST', `/rounds/${id}/choice`, { mode, repeat }),
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
