import { describe, expect, it } from 'vitest';
import { shadowPriest } from '../src/classes/shadow-priest';
import { runJob } from '../src/sim/run';
import type { SimJob } from '../src/sim/types';
import { loadSim, profiles, simBuilt } from './sim-node';

const MIND_FLAY = 'spell:18807';
const SWP = 'spell:10894';

describe.skipIf(!simBuilt)('sim bridge (Shadow Priest)', () => {
  const profile = simBuilt ? profiles('shadow-priest').undead : (null as never);
  const job = (over: Partial<SimJob>): SimJob => ({
    profile, rotation: shadowPriest.defaultRotation, targets: 1, fight: { kind: 'time', seconds: 120 }, iterations: 50, seed: 7, ...over,
  });

  it('plays the default rotation on one boss', async () => {
    const s = runJob(await loadSim(), job({}));
    expect(s.dps).toBeGreaterThan(500);
    expect(s.duration).toBe(120);
    expect(s.spells.find((x) => x.key === MIND_FLAY)!.castsPerFight).toBeGreaterThan(10);
    const casts = s.timeline.filter((e) => e.type === 'cast');
    expect(casts[0]).toMatchObject({ key: 'spell:10947', t: -1.5 }); // the pre-pull Mind Blast
    expect(s.timeline.some((e) => e.type === 'auraOn' && e.key === SWP && e.target === 0)).toBe(true);
  });

  it('is repeatable with the same seed', async () => {
    const sim = await loadSim();
    expect(runJob(sim, job({})).dps).toBe(runJob(sim, job({})).dps);
  });

  it('fights three bosses', async () => {
    const s = runJob(await loadSim(), job({ targets: 3 }));
    const swpTargets = new Set(s.timeline.filter((e) => e.type === 'damage' && e.key === SWP).map((e) => (e as { target: number }).target));
    expect(swpTargets.size).toBeGreaterThanOrEqual(1);
  });

  it('ends a health fight when the boss is dead', async () => {
    const s = runJob(await loadSim(), job({ fight: { kind: 'health', healthPerTarget: 60000 } }));
    expect(s.duration).toBeGreaterThan(30);
    expect(s.dps * s.duration).toBeGreaterThan(59400);
    expect(s.dps * s.duration).toBeLessThan(60600);
    expect(s.duration).toBeLessThan(150);
    const lastDamage = Math.max(...s.timeline.filter((e) => e.type === 'damage').map((e) => e.t));
    expect(lastDamage).toBeLessThan(150);
  });

  it('plays the profile rotation when none is given', async () => {
    const s = runJob(await loadSim(), job({ rotation: undefined }));
    expect(s.dps).toBeGreaterThan(500);
  });
});
