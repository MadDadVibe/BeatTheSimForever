import type { ClassModule } from '../types';
import { rotationFromExport } from '../../sim/apl';
import info from './class.json';
import rotation from './rotation.json';

export const shadowPriest: ClassModule = { ...info, defaultRotation: rotationFromExport(rotation) };
