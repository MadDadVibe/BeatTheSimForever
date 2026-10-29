// What the game sends to the sim and what comes back. Class-neutral: nothing here knows about a particular class.

/** A rotation in the sim's APL format (the format the WoW Forever sim's rotation editor exports). */
export type AplRotation = Record<string, unknown> & { type?: string; priorityList?: unknown[] };

/** One ranked profile from the sim: character, gear, buffs, rotation and the boss it was ranked on. */
export interface SimProfile {
  settings: Record<string, unknown>;
  raidBuffs: Record<string, unknown>;
  partyBuffs: Record<string, unknown>;
  debuffs: Record<string, unknown>;
  tanks?: unknown[];
  player: Record<string, unknown> & { rotation?: AplRotation };
  encounter: { duration: number; targets: Array<Record<string, unknown> & { stats: number[] }> } & Record<string, unknown>;
}

export type FightSpec =
  /** The fight lasts a set time. */
  | { kind: 'time'; seconds: number }
  /** The fight lasts until every boss is dead; each boss has this much health. */
  | { kind: 'health'; healthPerTarget: number };

export interface SimJob {
  profile: SimProfile;
  /** Replaces the profile's own rotation when given. */
  rotation?: AplRotation;
  /** How many bosses stand in front of you (1 to 3). */
  targets: number;
  fight: FightSpec;
  iterations: number;
  seed: number;
}

/** A spell (or item, or other action) as the sim names it: {spellId} or {itemId} or {otherId}. */
export interface ActionId { spellId?: number; itemId?: number; otherId?: string; tag?: number; rank?: number }

export interface SpellStats {
  id: ActionId;
  /** Stable key for an action, e.g. "spell:10894" or "item:12662". */
  key: string;
  casts: number;
  damage: number;
  /** Per fight, averaged over all iterations. */
  castsPerFight: number;
  damagePerFight: number;
}

/** One thing that happened in the first simulated fight, read from the sim's combat log. */
export type TimelineEvent =
  | { t: number; type: 'cast'; key: string; cost: number; castTime: number }
  | { t: number; type: 'damage'; key: string; target: number; amount: number; crit: boolean; tick: boolean }
  | { t: number; type: 'auraOn' | 'auraOff'; key: string; target: number | null }
  | { t: number; type: 'mana'; mana: number };

export interface SimSummary {
  dps: number;
  dpsStdev: number;
  iterations: number;
  /** Average fight length in seconds. */
  duration: number;
  spells: SpellStats[];
  /** The first simulated fight, event by event. */
  timeline: TimelineEvent[];
}
