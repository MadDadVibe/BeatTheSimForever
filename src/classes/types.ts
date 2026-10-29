import type { AplRotation } from '../sim/types';

// Everything the game needs to know about one class. Version 1 has Shadow Priest only; each later class is another
// module of this shape. (The fight itself, spells, resources and the action bar, joins this in the next step.)
export interface ClassModule {
  /** File name of the sim's profiles for this class (public/sim/presets/<key>.json). */
  key: string;
  name: string;
  /** The rotation the sim plays unless you load your own. */
  defaultRotation: AplRotation;
  /** Race used when nothing else is picked; one of the keys in the profiles file. */
  defaultRace: string;
}
