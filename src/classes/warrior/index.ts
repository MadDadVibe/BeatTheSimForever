import { defineClass } from '../types';
import fury from './fury.json';
import fury2H from './fury-2h.json';
import furySunder from './fury-sunder.json';
import arms from './arms.json';
import protection from './protection.json';

export const warrior = defineClass('warrior', 'Warrior', [fury, fury2H, furySunder, arms, protection]);
