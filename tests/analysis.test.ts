import { describe, expect, it } from 'vitest';
import { SPECS } from '../src/classes';
import { analyse, compare } from '../src/game/analysis';
import { runJob } from '../src/sim/run';
import type { TimelineEvent } from '../src/sim/types';
import { loadSim, profiles, simBuilt } from './sim-node';

const shadowPriest = SPECS.find((s) => s.key === 'shadow-priest')!;

const review = shadowPriest.review;
const SWP = 'spell:10894', MF = 'spell:18807', MB = 'spell:10947';
const cast = (t: number, key: string, effective = 1.5, castTime = 0): TimelineEvent => ({ t, type: 'cast', key, cost: 0, castTime, effective });
const tick = (t: number, key: string, amount = 100): TimelineEvent => ({ t, type: 'damage', key, target: 0, amount, crit: false, tick: true });
const aura = (t: number, type: 'auraOn' | 'auraOff' | 'auraRefresh', key: string, target = 0): TimelineEvent => ({ t, type, key, target });

describe('analyse', () => {
  it('counts busy and idle time from the pull on', () => {
    const f = analyse([cast(-1.5, MB, 1.5, 1.5), cast(0, SWP), cast(5, MB, 1.5, 1.5)], 10, 1, review);
    expect(f.busy).toBeCloseTo(3);
    expect(f.idle).toBeCloseTo(7);
  });

  it('follows a channel until it fades or the next cast cuts it', () => {
    const t: TimelineEvent[] = [
      cast(0, MF), aura(0, 'auraOn', MF), tick(1, MF), tick(2, MF), tick(3, MF), aura(3, 'auraOff', MF),
      cast(3, MF), aura(3, 'auraOn', MF), tick(4, MF), cast(4.5, MF), aura(4.5, 'auraOff', MF),
      tick(5.5, MF), tick(6.5, MF), tick(7.5, MF), aura(7.5, 'auraOff', MF),
    ];
    const f = analyse(t, 10, 1, review);
    expect(f.channelTicks).toEqual([0, 1, 0, 2]);
    expect(f.channelTicksLost).toBe(2); // the second channel was cut by the third after one tick
    expect(f.busy).toBeCloseTo(7.5);
  });

  it('measures DoT uptime per boss and refreshes', () => {
    const t = [aura(2, 'auraOn', SWP, 0), aura(5, 'auraRefresh', SWP, 0), aura(8, 'auraOff', SWP, 0), aura(6, 'auraOn', SWP, 1)];
    const f = analyse(t, 10, 2, review);
    expect(f.dotUptime[SWP][0]).toBeCloseTo(0.6);
    expect(f.dotUptime[SWP][1]).toBeCloseTo(0.4);
    expect(f.dotRefreshes[SWP]).toBe(1);
  });
});

describe.skipIf(!simBuilt)('analyse the sim', () => {
  it('finds the sim busy, its DoTs up and its channels full', async () => {
    const s = runJob(await loadSim(), {
      profile: profiles('shadow-priest').undead, rotation: shadowPriest.defaultRotation, targets: 1,
      fight: { kind: 'time', seconds: 180 }, iterations: 20, seed: 3,
    });
    const f = analyse(s.timeline, 180, 1, review);
    expect(f.idle).toBeLessThan(10);
    expect(f.dotUptime[SWP][0]).toBeGreaterThan(0.9);
    expect(f.channelTicks[3]).toBeGreaterThan(f.channelTicks[1] + f.channelTicks[2]);
    expect(f.damage / 180).toBeGreaterThan(s.dps * 0.85);

    // Against itself, nothing should cost much.
    const casts = Object.fromEntries(s.spells.map((x) => [x.key, x.castsPerFight]));
    const dmg = Object.fromEntries(s.spells.map((x) => [x.key, x.damagePerFight]));
    for (const finding of compare(f, f, casts, dmg, review)) expect(Math.abs(finding.damage)).toBeLessThan(0.08 * f.damage);
  });
});
