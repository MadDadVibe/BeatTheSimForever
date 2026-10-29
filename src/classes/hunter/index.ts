import { defineClass } from '../types';
import beastMastery from './beast-mastery.json';
import marksmanshipRanged from './marksmanship-ranged.json';
import marksmanship from './marksmanship.json';
import survival from './survival.json';
import survivalWeave from './survival-weave.json';
import petMelee from './pet-melee.json';

export const hunter = defineClass('hunter', 'Hunter', [beastMastery, marksmanshipRanged, marksmanship, survival, survivalWeave, petMelee]);
