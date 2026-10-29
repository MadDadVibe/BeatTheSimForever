import type { Resource } from '../sim/live';
import type { AplRotation } from '../sim/types';

export interface ReviewConfig {
  /** Damage over time effects that should stay up on every boss. */
  dots: string[];
  /** A channelled filler: its full number of ticks and how long a full channel lasts. */
  channel?: { key: string; ticks: number; seconds: number };
  /** Spells that should be cast whenever they are ready. */
  keepOnCooldown: string[];
}

/** A button on the action bar: the spell (or item) it casts and a short name for it. */
export interface BarButton { key: string; short: string }

/** A bar shown under the cast bar; "combo" is the rogue's and the cat's combo points. */
export type ResourceBar = Resource | 'combo';

// Everything the game needs to know about one spec, beyond what the engine already knows (spells, costs, cooldowns,
// cast times). One file per spec (src/classes/<class>/<spec>.json), drafted from the sim's profile by
// scripts/draft-specs.ts and edited by hand.
export interface SpecModule {
  /** File name of the sim's profiles for this spec (public/sim/presets/<key>.json). */
  key: string;
  /** The spec's name, as the sim's rankings call the build ("Fury", "Fury (Sunder)", "MM Weave"). */
  name: string;
  /** The class's name (set by the class module). */
  className: string;
  /** The talent tree the spec lives in, as the sim names it (e.g. "Shadow" for "Shadow Magic"). */
  tree: string;
  /** Race used when nothing else is picked; one of the keys in the profiles file. */
  defaultRace: string;
  /** The resource bars shown, in this order. */
  resources: ResourceBar[];
  /** Lasting buffs that are up before the fight starts (e.g. Shadowform), for you and for the sim. */
  startBuffs?: string[];
  /** The action bar, in order. Buttons the character does not have (another race's racial, say) are left out. */
  bar: BarButton[];
  /** Effects shown on each boss (the spec's DoTs) and on the player (its buffs), in this order. */
  targetAuras: string[];
  playerAuras: string[];
  /** The character stats worth showing for this spec, by the sim's names (Intellect, SpellCrit, …). */
  stats: string[];
  /** What the review after a fight looks at. */
  review: ReviewConfig;
  /** The rotation the sim plays unless you load your own; without one, the rotation of the sim's profile. */
  defaultRotation?: AplRotation;
}

/** A class: its specs, each one a file in the class's folder. */
export interface ClassModule {
  key: string;
  name: string;
  specs: SpecModule[];
}

/** What a spec file holds: a spec module without the class's name. */
export type SpecFile = Omit<SpecModule, 'className' | 'resources'> & { resources: string[] };

export function defineClass(key: string, name: string, specs: SpecFile[]): ClassModule {
  return { key, name, specs: specs.map((s) => ({ ...s, className: name, resources: s.resources as ResourceBar[] })) };
}
