import { defineClass } from '../types';
import elemental from './elemental.json';
import stormcaller from './stormcaller.json';
import enhancement from './enhancement.json';

export const shaman = defineClass('shaman', 'Shaman', [elemental, stormcaller, enhancement]);
