// The live fight the player drives: the same engine as the sim, run step by step. Class-neutral.

/** A castable spell (or item) of the character, as the engine lists it; "move:<yards>" walks to that distance. */
export interface LiveSpell {
  index: number;
  key: string;
  rank: number;
  castTime: number;
  gcd: number;
  cooldown: number;
  channeled: boolean;
  cost: number;
  /** The resource it costs; empty when it is free. */
  costType: Resource | '';
  /** A major cooldown (trinket, racial, class cooldown): the sim's rotation uses these whenever they are ready. */
  major: boolean;
  /** A major cooldown for staying alive; the sim's rotation leaves these alone. */
  survival: boolean;
}

export type Resource = 'mana' | 'rage' | 'energy' | 'focus';

export interface LiveAura { key: string; label: string; remaining: number; duration: number; stacks: number }

export interface LiveState {
  time: number;
  duration: number;
  mana: number;
  maxMana: number;
  /** Only for characters with a rage bar (warriors, druids). */
  rage?: number;
  /** Only for characters with an energy bar (rogues, druids), with their combo points. */
  energy?: number;
  maxEnergy?: number;
  combo?: number;
  gcd: number;
  cooldowns: number[];
  costs: number[];
  auras: LiveAura[];
  cast?: { key: string; ends: number };
  channel?: { key: string; ends: number; ticks: number; tick: number };
  targets: Array<{ auras: LiveAura[] }>;
  damageTaken: number;
  /** The spell the sim's rotation would cast next (when the fight was started with one). */
  hint?: string;
  /** The boss the hinted spell goes on, when the rotation picks one (a DoT kept up on every boss). */
  hintTarget?: number;
  /** The entry of the rotation's priority list that chose the hint (its index). */
  hintEntry?: number;
  /** Only when the rotation moves (a hunter weaving melee between shots): your distance to the boss, in yards. */
  distance?: number;
  moving?: boolean;
  /** Where you are walking to, while you walk. */
  movingTo?: number;
  /** Melee attacks reach up to meleeRange yards, shots need at least rangedRange; in between is the dead zone. */
  meleeRange?: number;
  rangedRange?: number;
  /** Whether each spell (by index, moves after the spells) could be cast now, leaving the global cooldown and a cast
   *  under way aside: its own conditions (the distance it needs), its resource, nothing with a cast time while walking. */
  usable: boolean[];
  /** All bosses' health together in a health fight; 0 in a timed fight. */
  health: number;
}

export type CastBlock = 'casting' | 'gcd' | 'cooldown' | Resource | 'cannot';

export interface LiveStart { spells: LiveSpell[]; targets: number; state: LiveState }
export interface LiveStep { logs: string; state: LiveState; finished: boolean }
export interface LiveCast { ok: boolean; reason: CastBlock | ''; logs: string; state: LiveState }

/** The engine's live-fight functions (set on the global object by the WebAssembly module). */
export interface LiveEngine {
  playStart(json: string): string;
  playAdvance(json: string): string;
  playCast(json: string): string;
}

function call<T>(fn: (json: string) => string, arg: unknown): T {
  const out = JSON.parse(fn(JSON.stringify(arg))) as T & { error?: string };
  if (out.error) throw new Error(out.error);
  return out;
}

export function liveApi(engine: LiveEngine) {
  return {
    start: (request: Record<string, unknown>, seed = 0, countdown = 0) => call<LiveStart>(engine.playStart, { request, seed, countdown }),
    advance: (to: number, target = 0) => call<LiveStep>(engine.playAdvance, { to, target }),
    cast: (index: number, target: number) => call<LiveCast>(engine.playCast, { index, target }),
  };
}
