import { defineClass } from '../types';
import affliction from './affliction.json';
import demonology from './demonology.json';
import destruction from './destruction.json';
import dsRuin from './ds-ruin.json';

export const warlock = defineClass('warlock', 'Warlock', [affliction, demonology, destruction, dsRuin]);
