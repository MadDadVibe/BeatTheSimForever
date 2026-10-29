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

// Everything the game needs to know about one class, beyond what the engine already knows (spells, costs, cooldowns,
// cast times). Version 1 has Shadow Priest only; each later class is another module of this shape.
export interface ClassModule {
  /** File name of the sim's profiles for this class (public/sim/presets/<key>.json). */
  key: string;
  name: string;
  /** Race used when nothing else is picked; one of the keys in the profiles file. */
  defaultRace: string;
  /** The action bar, in order. Buttons the character does not have (another race's racial, say) are left out. */
  bar: BarButton[];
  /** Effects shown on each boss (the class's DoTs) and on the player (its buffs), in this order. */
  targetAuras: string[];
  playerAuras: string[];
  /** What the review after a fight looks at. */
  review: ReviewConfig;
  /** The rotation the sim plays unless you load your own. */
  defaultRotation: AplRotation;
}
