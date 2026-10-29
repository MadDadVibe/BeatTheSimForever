// The live fight the player drives: the same engine as the sim, run step by step. Class-neutral.

/** A castable spell (or item) of the character, as the engine lists it. */
export interface LiveSpell {
  index: number;
  key: string;
  rank: number;
  castTime: number;
  gcd: number;
  cooldown: number;
  channeled: boolean;
  cost: number;
}

export interface LiveAura { key: string; label: string; remaining: number; duration: number; stacks: number }

export interface LiveState {
  time: number;
  duration: number;
  mana: number;
  maxMana: number;
  gcd: number;
  cooldowns: number[];
  costs: number[];
  auras: LiveAura[];
  cast?: { key: string; ends: number };
  channel?: { key: string; ends: number; ticks: number; tick: number };
  targets: Array<{ auras: LiveAura[] }>;
  damageTaken: number;
  /** All bosses' health together in a health fight; 0 in a timed fight. */
  health: number;
}

export type CastBlock = 'casting' | 'gcd' | 'cooldown' | 'mana' | 'cannot';

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
    advance: (to: number) => call<LiveStep>(engine.playAdvance, { to }),
    cast: (index: number, target: number) => call<LiveCast>(engine.playCast, { index, target }),
  };
}
