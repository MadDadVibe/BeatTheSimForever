import type { ClassModule } from './types';
import { warrior } from './warrior';
import { paladin } from './paladin';
import { hunter } from './hunter';
import { rogue } from './rogue';
import { priest } from './priest';
import { shaman } from './shaman';
import { mage } from './mage';
import { warlock } from './warlock';
import { druid } from './druid';

// One folder per class, one file per spec in it.
export const CLASSES: ClassModule[] = [warrior, paladin, hunter, rogue, priest, shaman, mage, warlock, druid];

export const SPECS = CLASSES.flatMap((c) => c.specs);
