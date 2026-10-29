import { defineClass } from '../types';
import combat from './combat.json';
import mutilate from './mutilate.json';
import subtlety from './subtlety.json';

export const rogue = defineClass('rogue', 'Rogue', [combat, mutilate, subtlety]);
