import { normalizeApl } from './apl';
import type { AplRotation, FightSpec, SimJob, SimProfile } from './types';

const STAT_HEALTH = 34;
// A live fight until the bosses are dead stops here at the latest.
const LIVE_HEALTH_LIMIT_SECONDS = 1200;

/**
 * When lasting buffs are cast: long before the pull (and before any countdown), so they are simply up. The last one
 * goes at -20 s, each one before it a further START_BUFF_GAP earlier, enough for a 10-second summon and its global
 * cooldown (a warlock's pet, then sacrificed, then the next pet).
 */
const START_BUFF_LAST = -20;
const START_BUFF_GAP = 11;

/**
 * The rotation with the start buffs cast in their order before anything else. A pre-pull cast of the same spell is
 * dropped (it would only cast it again).
 */
export function withStartBuffs(rotation: AplRotation, buffs: string[] = []): AplRotation {
  const ids = buffs.filter((k) => k.startsWith('spell:')).map((k) => Number(k.slice(6)));
  if (!ids.length) return rotation;
  type Pre = { action?: { castSpell?: { spellId?: { spellId?: number } } } };
  const others = ((rotation.prepullActions as Pre[] | undefined) ?? []).filter((p) => !ids.includes(p.action?.castSpell?.spellId?.spellId ?? -1));
  const at = (i: number) => `${START_BUFF_LAST - START_BUFF_GAP * (ids.length - 1 - i)}s`;
  const buffActions = ids.map((spellId, i) => ({ action: { castSpell: { spellId: { spellId } } }, doAtValue: { const: { val: at(i) } } }));
  return { ...rotation, prepullActions: [...buffActions, ...others] };
}

/**
 * Turns a job into the sim's RaidSimRequest (as JSON) for a fight of this many seconds. (A health fight is run as a
 * timed fight whose length is found by runJob: the sim's own health mode reports its DPS over a wrong length.)
 */
export function buildRequest(job: SimJob, seconds: number): Record<string, unknown> {
  const { profile } = job;
  const player = structuredClone(profile.player);
  const rotation = job.rotation ?? player.rotation;
  if (rotation) player.rotation = withStartBuffs(normalizeApl(rotation), job.startBuffs);

  const targetCount = Math.max(1, Math.min(3, Math.round(job.targets)));
  const boss = profile.encounter.targets[0];
  const targets = Array.from({ length: targetCount }, () => structuredClone(boss));

  const encounter = {
    ...structuredClone(profile.encounter),
    duration: seconds,
    durationVariation: 0,
    targets,
  };

  return {
    raid: {
      parties: [{ players: [player], buffs: profile.partyBuffs }],
      buffs: profile.raidBuffs,
      debuffs: profile.debuffs,
      tanks: profile.tanks ?? [],
      numActiveParties: 1,
    },
    encounter,
    simOptions: {
      iterations: job.iterations,
      randomSeed: String(job.seed),
      ruleset: (profile.settings.ruleset as string) ?? 'RulesetForever',
      debugFirstIteration: true,
    },
  };
}

/**
 * The request for a live fight the player drives; a health fight really ends when the bosses die. The rotation, if
 * given, never acts (the engine waits for the player); it only answers which spell it would cast next (the hint).
 * Its pre-pull actions are left out, since those would run by themselves; only the start buffs are cast for you.
 */
export function buildLiveRequest(profile: SimProfile, targets: number, fight: FightSpec, rotation?: AplRotation, startBuffs?: string[]): Record<string, unknown> {
  const seconds = fight.kind === 'time' ? fight.seconds : LIVE_HEALTH_LIMIT_SECONDS;
  const req = buildRequest({ profile, targets, fight, iterations: 1, seed: 1 }, seconds) as {
    raid: { parties: Array<{ players: Array<Record<string, unknown>> }> };
    encounter: { useHealth?: boolean; targets: Array<{ stats: number[] }> };
  };
  const { prepullActions: _pre, ...hintOnly } = rotation ? normalizeApl(rotation) : { type: 'TypeAPL', priorityList: [] };
  req.raid.parties[0].players[0].rotation = withStartBuffs(hintOnly, startBuffs);
  if (fight.kind === 'health') {
    req.encounter.useHealth = true;
    for (const t of req.encounter.targets) {
      t.stats = [...t.stats];
      t.stats[STAT_HEALTH] = fight.healthPerTarget;
    }
  }
  return req;
}
