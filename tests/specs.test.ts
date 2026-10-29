import { describe, expect, it } from 'vitest';
import { SPECS } from '../src/classes';
import { liveApi, type LiveEngine, type LiveSpell, type LiveState } from '../src/sim/live';
import { buildLiveRequest } from '../src/sim/request';
import { parseTimeline } from '../src/sim/result';
import { runJob } from '../src/sim/run';
import { loadSim, profiles, simBuilt } from './sim-node';

// Every spec: its file fits what the engine knows, and a player who presses what the hint says reaches about what
// the sim reaches with the same rotation. That checks the live fight for each class (rage, energy, combo points,
// white hits, pets) against the sim.

describe('spec files', () => {
  it.each(SPECS.map((s) => [s.key, s] as const))('%s is complete', (_key, spec) => {
    const bar = new Set(spec.bar.map((b) => b.key));
    expect(bar.size).toBe(spec.bar.length);
    for (const k of [...spec.review.dots, ...spec.review.keepOnCooldown]) expect(bar.has(k)).toBe(true);
    expect(spec.resources.length).toBeGreaterThan(0);
    expect(spec.stats.length).toBeGreaterThan(0);
  });
});

describe.skipIf(!simBuilt)('every spec in the live fight', () => {
  it.each(SPECS.map((s) => [s.key, s] as const))('%s plays close to the sim', async (_key, spec) => {
    const sim = await loadSim();
    const all = profiles(spec.key);
    expect(spec.defaultRace in all).toBe(true);
    const profile = all[spec.defaultRace];
    const rotation = spec.defaultRotation ?? profile.player.rotation!;
    const seconds = 90;

    const api = liveApi(globalThis as unknown as LiveEngine);
    const start = api.start(buildLiveRequest(profile, 1, { kind: 'time', seconds }, rotation, spec.startBuffs), 11);
    const byKey = new Map<string, LiveSpell>(start.spells.map((s) => [s.key, s]));
    // Every button on the bar is a spell this character has, or another race's.
    const anyRace = new Set<string>();
    for (const p of Object.values(all)) api.start(buildLiveRequest(p, 1, { kind: 'time', seconds: 10 }, rotation), 1).spells.forEach((s) => anyRace.add(s.key));
    for (const b of spec.bar) expect(anyRace.has(b.key), `${b.key} (${b.short})`).toBe(true);

    api.start(buildLiveRequest(profile, 1, { kind: 'time', seconds }, rotation, spec.startBuffs), 11);
    let logs = '';
    let state: LiveState = start.state;
    let finished = false;
    for (let t = 0; !finished; t += 0.05) {
      const step = api.advance(t);
      logs += step.logs;
      state = step.state;
      finished = step.finished;
      // Press what the hint says, once nothing is being cast; a hinted spell off the global cooldown goes at once.
      for (let i = 0; i < 3 && !finished && state.hint && !state.cast && !state.channel; i++) {
        const spell = byKey.get(state.hint);
        if (!spell || (spell.gcd > 0 && state.gcd > 0)) break;
        const r = api.cast(spell.index, 0);
        logs += r.logs;
        state = r.state;
        if (!r.ok) break;
      }
    }
    const damage = parseTimeline(logs, String(profile.player.name)).reduce((s, e) => s + (e.type === 'damage' ? e.amount : 0), 0);
    const reference = runJob(sim, { profile, rotation, startBuffs: spec.startBuffs, targets: 1, fight: { kind: 'time', seconds }, iterations: 200, seed: 1 });
    const share = damage / seconds / reference.dps;
    console.log(`${spec.key}: ${Math.round(damage / seconds)} DPS live, ${Math.round(reference.dps)} sim (${Math.round(100 * share)} %)`);
    expect(share).toBeGreaterThan(0.75);
    expect(share).toBeLessThan(1.25);
  });
});
