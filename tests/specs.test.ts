import { describe, expect, it } from 'vitest';
import { SPECS } from '../src/classes';
import { liveApi, type LiveEngine, type LiveSpell, type LiveState } from '../src/sim/live';
import { withOptions, type SetupOptions } from '../src/sim/options';
import { buildLiveRequest } from '../src/sim/request';
import { parseTimeline } from '../src/sim/result';
import { runJob } from '../src/sim/run';
import { loadSim, profiles, simBuilt } from './sim-node';

// Every spec: its file fits what the engine knows, and a player who presses what the hint says reaches about what
// the sim reaches with the same rotation. That checks the live fight for each class (rage, energy, combo points,
// white hits, pets) against the sim.

const ALL_ON: SetupOptions = { potions: true, conjured: true, explosives: true, raidBuffs: true, raidDebuffs: true };

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
    const profile = withOptions(all[spec.defaultRace], ALL_ON);
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

describe.skipIf(!simBuilt)('start buffs', () => {
  it.each(SPECS.filter((s) => s.startBuffs?.length).map((s) => [s.key, s] as const))('%s has its lasting buffs up at the start', async (_key, spec) => {
    await loadSim();
    const api = liveApi(globalThis as unknown as LiveEngine);
    const profile = withOptions(profiles(spec.key)[spec.defaultRace], ALL_ON);
    const { state } = api.start(buildLiveRequest(profile, 1, { kind: 'time', seconds: 30 }, spec.defaultRotation ?? profile.player.rotation, spec.startBuffs), 1, 5);
    const up = new Set([...state.auras, ...state.targets[0].auras].map((a) => a.key));
    const lasting = spec.startBuffs!.filter((k) => !/^spell:(688|712|18788)$/.test(k)); // summons and the sacrifice leave other effects
    for (const k of lasting) expect(up.has(k), k).toBe(true);
    expect(state.mana).toBeGreaterThan(0.9 * state.maxMana);
  });
});

describe.skipIf(!simBuilt)('setup switches', () => {
  const job = { targets: 1, fight: { kind: 'time' as const, seconds: 60 }, iterations: 100, seed: 1 };
  const live = (p: ReturnType<typeof withOptions>, startBuffs?: string[]) =>
    liveApi(globalThis as unknown as LiveEngine).start(buildLiveRequest(p, 1, { kind: 'time', seconds: 30 }, p.player.rotation, startBuffs), 1, 5);

  it('leave potions, runes and explosives out of the fight and the sim', async () => {
    const sim = await loadSim();
    const base = withOptions(profiles('fury-warrior').orc, ALL_ON);
    const off = withOptions(profiles('fury-warrior').orc, { ...ALL_ON, potions: false, conjured: false, explosives: false });
    const items = (p: typeof base) => live(p).spells.map((s) => s.key).filter((k) => k.startsWith('item:'));
    expect(items(base).length).toBeGreaterThan(0);
    expect(items(off)).toEqual([]);
    const casts = (p: typeof base) => runJob(sim, { profile: p, ...job }).spells.filter((s) => s.key.startsWith('item:') && s.castsPerFight > 0).length;
    expect(casts(base)).toBeGreaterThan(0);
    expect(casts(off)).toBe(0);
  });

  it('take the raid buffs and debuffs away, for you and the sim', async () => {
    const sim = await loadSim();
    const raw = profiles('fury-warrior').orc;
    const on = withOptions(raw, ALL_ON);
    const noBuffs = withOptions(raw, { ...ALL_ON, raidBuffs: false });
    const noDebuffs = withOptions(raw, { ...ALL_ON, raidDebuffs: false });
    const keys = (auras: Array<{ key: string }>) => auras.map((a) => a.key);
    expect(keys(live(on).state.auras)).toContain('spell:20217'); // Blessing of Kings
    expect(keys(live(noBuffs).state.auras)).not.toContain('spell:20217');
    expect(live(on).state.targets[0].auras.length).toBeGreaterThan(0);
    expect(live(noDebuffs).state.targets[0].auras).toEqual([]);
    const dps = (p: typeof on) => runJob(sim, { profile: p, ...job }).dps;
    expect(dps(noBuffs)).toBeLessThan(0.9 * dps(on));
    expect(dps(noDebuffs)).toBeLessThan(0.9 * dps(on));
  });

  it('never give the Tier 1 set bonuses', async () => {
    await loadSim();
    const labels = live(withOptions(profiles('shadow-priest').undead, ALL_ON)).state.auras.map((a) => a.label);
    expect(labels.some((l) => l.startsWith('Tier 1'))).toBe(false);
  });

  it("show only a balance druid's own Insect Swarm on the boss", async () => {
    await loadSim();
    const spec = SPECS.find((s) => s.key === 'balance-druid')!;
    const { state } = live(withOptions(profiles(spec.key)[spec.defaultRace], ALL_ON), spec.startBuffs);
    expect(state.targets[0].auras.map((a) => a.key)).not.toContain('spell:24977');
  });

  it('give a shaman their totems and weapon imbue from the start, the imbue as picked', async () => {
    await loadSim();
    const spec = SPECS.find((s) => s.key === 'enhancement-shaman')!;
    const raw = profiles(spec.key)[spec.defaultRace];
    for (const [imbue, aura] of [['WindfuryImbue', 'spell:16362'], ['FlametongueImbue', 'spell:16342']]) {
      const { state } = live(withOptions(raw, { ...ALL_ON, raidBuffs: false, imbue }), spec.startBuffs);
      const up = state.auras.map((a) => a.key);
      expect(up).toContain(aura);
      for (const totem of spec.startBuffs!) expect(up, totem).toContain(totem);
      expect(state.mana).toBeGreaterThan(0.9 * state.maxMana);
    }
  });
});
