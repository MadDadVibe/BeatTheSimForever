import { normalizeApl } from './apl';
import type { FightSpec, SimJob, SimProfile } from './types';

const STAT_HEALTH = 34;
// A live fight until the bosses are dead stops here at the latest.
const LIVE_HEALTH_LIMIT_SECONDS = 1200;

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

/** The request for a live fight the player drives: no rotation, and a health fight really ends when the bosses die. */
export function buildLiveRequest(profile: SimProfile, targets: number, fight: FightSpec): Record<string, unknown> {
  const seconds = fight.kind === 'time' ? fight.seconds : LIVE_HEALTH_LIMIT_SECONDS;
  const req = buildRequest({ profile, targets, fight, iterations: 1, seed: 1 }, seconds) as {
    raid: { parties: Array<{ players: Array<Record<string, unknown>> }> };
    encounter: { useHealth?: boolean; targets: Array<{ stats: number[] }> };
  };
  // The player presses the buttons; no rotation may act for them.
  req.raid.parties[0].players[0].rotation = { type: 'TypeAPL', priorityList: [] };
  if (fight.kind === 'health') {
    req.encounter.useHealth = true;
    for (const t of req.encounter.targets) {
      t.stats = [...t.stats];
      t.stats[STAT_HEALTH] = fight.healthPerTarget;
    }
  }
  return req;
}
