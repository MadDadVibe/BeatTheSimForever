import { defineClass } from '../types';
import retribution from './retribution.json';
import retributionPhysical from './retribution-physical.json';
import shockadin from './shockadin.json';
import protection from './protection.json';

export const paladin = defineClass('paladin', 'Paladin', [retribution, retributionPhysical, shockadin, protection]);
