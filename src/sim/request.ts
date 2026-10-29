import { normalizeApl } from './apl';
import type { SimJob } from './types';

/**
 * Turns a job into the sim's RaidSimRequest (as JSON) for a fight of this many seconds. (A health fight is run as a
 * timed fight whose length is found by runJob: the sim's own health mode reports its DPS over a wrong length.)
 */
export function buildRequest(job: SimJob, seconds: number): Record<string, unknown> {
  const { profile } = job;
  const player = structuredClone(profile.player);
  const rotation = job.rotation ?? player.rotation;
  if (rotation) player.rotation = normalizeApl(rotation);

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
