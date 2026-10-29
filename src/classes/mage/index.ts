import { defineClass } from '../types';
import arcane from './arcane.json';
import fire from './fire.json';
import frost from './frost.json';
import frostfire from './frostfire.json';
import arcaneFrost from './arcane-frost.json';

export const mage = defineClass('mage', 'Mage', [arcane, fire, frost, frostfire, arcaneFrost]);
