import { rotationFromExport } from '../../sim/apl';
import { defineClass } from '../types';
import shadow from './shadow.json';
import smite from './smite.json';
import shadowRotation from './shadow.rotation.json';

// Shadow plays its own hand-written rotation; every other spec the rotation of the sim's profile.
export const priest = defineClass('priest', 'Priest', [{ ...shadow, defaultRotation: rotationFromExport(shadowRotation) }, smite]);
