import { describe, expect, it } from 'vitest';
import { liveApi, type LiveEngine, type LiveState } from '../src/sim/live';
import { buildLiveRequest } from '../src/sim/request';
import { parseTimeline } from '../src/sim/result';
import { runJob } from '../src/sim/run';
import { loadSim, profiles, simBuilt } from './sim-node';

const SWP = 'spell:10894', DP = 'spell:19280', MB = 'spell:10947', MF = 'spell:18807', SHADOWFORM = 'spell:15473';

describe.skipIf(!simBuilt)('live fight (Shadow Priest)', () => {
  const profile = simBuilt ? profiles('shadow-priest').undead : (null as never);

  // A simple player: Shadowform, keep SW:P and Devouring Plague up, Mind Blast on cooldown, otherwise Mind Flay.
  async function play(seconds: number, targets = 1) {
    await loadSim();
    const api = liveApi(globalThis as unknown as LiveEngine);
    const { spells, state: first } = api.start(buildLiveRequest(profile, targets, { kind: 'time', seconds }), 42);
    const idx = (key: string) => {
      const all = spells.filter((s) => s.key === key);
      return all.reduce((a, b) => (b.rank > a.rank ? b : a)).index;
    };
    let state: LiveState = first;
    let logs = '';
    const has = (key: string, auras: LiveState['auras']) => auras.some((a) => a.key === key && (a.remaining < 0 || a.remaining > 0.3));
    const tryCast = (key: string, target = 0) => {
      const r = api.cast(idx(key), target);
      logs += r.logs;
      state = r.state;
      return r.ok;
    };
    let finished = false;
    for (let t = 0; !finished; t += 0.05) {
      const step = api.advance(t);
      logs += step.logs;
      state = step.state;
      finished = step.finished;
      if (finished || state.gcd > 0 || state.cast || state.channel) continue;
      if (!has(SHADOWFORM, state.auras) && tryCast(SHADOWFORM)) continue;
      let done = false;
      for (let i = 0; i < targets && !done; i++) {
        if (!has(SWP, state.targets[i].auras)) done = tryCast(SWP, i);
      }
      if (done) continue;
      if (!has(DP, state.targets[0].auras) && tryCast(DP)) continue;
      if (state.cooldowns[idx(MB)] === 0 && tryCast(MB)) continue;
      tryCast(MF);
    }
    return { state, timeline: parseTimeline(logs, 'Shadow'), spells };
  }

  it('lists the Shadow Priest spells', async () => {
    await loadSim();
    const api = liveApi(globalThis as unknown as LiveEngine);
    const { spells, targets } = api.start(buildLiveRequest(profile, 2, { kind: 'time', seconds: 60 }));
    expect(targets).toBe(2);
    for (const k of [SWP, DP, MB, MF, SHADOWFORM]) expect(spells.some((s) => s.key === k)).toBe(true);
    expect(spells.find((s) => s.key === MF)!.channeled).toBe(true);
  });

  it('plays a fight and lands close to the sim', async () => {
    const { state, timeline } = await play(120);
    expect(state.time).toBeGreaterThanOrEqual(120);
    const damage = timeline.filter((e) => e.type === 'damage').reduce((s, e) => s + (e as { amount: number }).amount, 0);
    const sim = runJob(await loadSim(), { profile, targets: 1, fight: { kind: 'time', seconds: 120 }, iterations: 200, seed: 1 });
    const dps = damage / 120;
    expect(dps).toBeGreaterThan(sim.dps * 0.8);
    expect(dps).toBeLessThan(sim.dps * 1.15);
  });

  it('clips Mind Flay when another spell is cast during it', async () => {
    await loadSim();
    const api = liveApi(globalThis as unknown as LiveEngine);
    const { spells } = api.start(buildLiveRequest(profile, 1, { kind: 'time', seconds: 60 }), 1);
    const mf = spells.filter((s) => s.key === MF).sort((a, b) => b.rank - a.rank)[0].index;
    const swp = spells.filter((s) => s.key === SWP).sort((a, b) => b.rank - a.rank)[0].index;
    api.advance(0);
    expect(api.cast(mf, 0).ok).toBe(true);
    const mid = api.advance(1.6).state;
    expect(mid.channel?.key).toBe(MF);
    const clip = api.cast(swp, 0);
    expect(clip.ok).toBe(true);
    expect(clip.state.channel).toBeUndefined();
  });

  it('refuses a spell during the global cooldown without ending the channel', async () => {
    await loadSim();
    const api = liveApi(globalThis as unknown as LiveEngine);
    const { spells } = api.start(buildLiveRequest(profile, 1, { kind: 'time', seconds: 60 }), 1);
    const mf = spells.filter((s) => s.key === MF).sort((a, b) => b.rank - a.rank)[0].index;
    const swp = spells.filter((s) => s.key === SWP).sort((a, b) => b.rank - a.rank)[0].index;
    api.advance(0);
    api.cast(mf, 0);
    api.advance(0.5);
    const r = api.cast(swp, 0);
    expect(r).toMatchObject({ ok: false, reason: 'gcd' });
    expect(r.state.channel?.key).toBe(MF);
  });

  it('ends a health fight when the boss dies', async () => {
    await loadSim();
    const api = liveApi(globalThis as unknown as LiveEngine);
    const { spells } = api.start(buildLiveRequest(profile, 1, { kind: 'health', healthPerTarget: 20000 }), 3);
    const mb = spells.filter((s) => s.key === MB).sort((a, b) => b.rank - a.rank)[0].index;
    const mf = spells.filter((s) => s.key === MF).sort((a, b) => b.rank - a.rank)[0].index;
    let step = api.advance(0);
    for (let t = 0; !step.finished && t < 300; t += 0.1) {
      step = api.advance(t);
      if (!step.finished && step.state.gcd === 0 && !step.state.cast && !step.state.channel) {
        if (!api.cast(mb, 0).ok) api.cast(mf, 0);
      }
    }
    expect(step.finished).toBe(true);
    expect(step.state.damageTaken).toBeGreaterThanOrEqual(20000);
    expect(step.state.time).toBeLessThan(120);
  });
});

describe.skipIf(!simBuilt)('live fight before the pull', () => {
  it('lets a spell be cast during the countdown and land at the pull', async () => {
    await loadSim();
    const api = liveApi(globalThis as unknown as LiveEngine);
    const profile = profiles('shadow-priest').undead;
    const { spells, state } = api.start(buildLiveRequest(profile, 1, { kind: 'time', seconds: 30 }), 5, 3);
    expect(state.time).toBe(-3);
    const mb = spells.filter((s) => s.key === MB).sort((a, b) => b.rank - a.rank)[0].index;
    api.advance(-1.5);
    expect(api.cast(mb, 0).ok).toBe(true);
    const at0 = api.advance(0.01);
    const hits = parseTimeline(at0.logs, 'Shadow').filter((e) => e.type === 'damage' && e.key === MB);
    expect(hits.length).toBe(1);
    expect(hits[0].t).toBeCloseTo(0, 5);
  });
});

describe.skipIf(!simBuilt)('hint', () => {
  it('names the spell the rotation would cast next, even during the global cooldown', async () => {
    await loadSim();
    const api = liveApi(globalThis as unknown as LiveEngine);
    const { shadowPriest } = await import('../src/classes/shadow-priest');
    const profile = profiles('shadow-priest').undead;
    const { spells, state } = api.start(buildLiveRequest(profile, 1, { kind: 'time', seconds: 60 }, shadowPriest.defaultRotation), 5, 3);
    expect(state.hint).toBeUndefined(); // before the pull
    const first = api.advance(0.01).state;
    expect(first.hint).toBe(SHADOWFORM); // Tobias's rotation: Shadowform first if it is not up
    const idx = (key: string) => spells.filter((s) => s.key === key).sort((a, b) => b.rank - a.rank)[0].index;
    const r = api.cast(idx(SHADOWFORM), 0);
    expect(r.ok).toBe(true);
    expect(r.state.gcd).toBeGreaterThan(0);
    expect(r.state.hint).toBeDefined();
    expect(r.state.hint).not.toBe(SHADOWFORM);
    // The rotation never acts by itself.
    const later = api.advance(10);
    expect(parseTimeline(later.logs, 'Shadow').filter((e) => e.type === 'cast')).toEqual([]);
  });
});

describe.skipIf(!simBuilt)('start buffs and set bonuses', () => {
  const DP_KEY = 'spell:19280';
  it('has Shadowform up from the start, and the full GCD free', async () => {
    await loadSim();
    const api = liveApi(globalThis as unknown as LiveEngine);
    const { shadowPriest } = await import('../src/classes/shadow-priest');
    const profile = profiles('shadow-priest').undead;
    const { state } = api.start(buildLiveRequest(profile, 1, { kind: 'time', seconds: 30 }, shadowPriest.defaultRotation, shadowPriest.startBuffs), 1, 5);
    expect(state.time).toBe(-5);
    expect(state.auras.some((a) => a.key === SHADOWFORM)).toBe(true);
    expect(state.gcd).toBe(0);
  });

  it('gives Devouring Plague its 24 s cooldown without the Tier 1 set bonus', async () => {
    await loadSim();
    const api = liveApi(globalThis as unknown as LiveEngine);
    const base = profiles('shadow-priest').undead;
    for (const [tier1, cd] of [[false, 24], [true, 0]] as const) {
      const profile = { ...base, player: { ...base.player, foreverTier1Bonuses: tier1 } };
      const { spells } = api.start(buildLiveRequest(profile, 1, { kind: 'time', seconds: 30 }), 1, 0);
      const dp = spells.find((s) => s.key === DP_KEY)!;
      api.advance(0.1);
      expect(api.cast(dp.index, 0).state.cooldowns[dp.index]).toBeCloseTo(cd, 1);
    }
  });
});
