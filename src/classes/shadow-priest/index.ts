import type { ClassModule } from '../types';
import { rotationFromExport } from '../../sim/apl';
import rotation from './rotation.json';

export const shadowPriest: ClassModule = {
  key: 'shadow-priest',
  name: 'Shadow Priest',
  defaultRotation: rotationFromExport(rotation),
  defaultRace: 'undead',
};
