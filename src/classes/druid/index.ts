import { defineClass } from '../types';
import balance from './balance.json';
import feral from './feral.json';
import feralTank from './feral-tank.json';

export const druid = defineClass('druid', 'Druid', [balance, feral, feralTank]);
