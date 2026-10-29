import { buildRequest } from './request';
import { parseResult } from './result';
import type { SimJob, SimSummary } from './types';

/** The loaded sim: takes a RaidSimRequest as JSON, returns a RaidSimResult as JSON. */
export type RaidSimJson = (requestJson: string) => string | null;

function runFor(raidSimJson: RaidSimJson, job: SimJob, seconds: number): SimSummary {
  const out = raidSimJson(JSON.stringify(buildRequest(job, seconds)));
  if (!out) throw new Error('The sim could not read the request (see the console)');
  return parseResult(out, seconds);
}

export function runJob(raidSimJson: RaidSimJson, job: SimJob): SimSummary {
  if (job.fight.kind === 'time') return runFor(raidSimJson, job, job.fight.seconds);
  // A fight until the bosses are dead: the fight length is adjusted until the sim's damage equals their health.
  const health = job.fight.healthPerTarget * Math.max(1, Math.min(3, Math.round(job.targets)));
  let seconds = health / 1000;
  let result = runFor(raidSimJson, job, seconds);
  for (let round = 0; round < 6; round++) {
    const next = health / result.dps;
    if (Math.abs(next - seconds) / seconds < 0.005) break;
    seconds = next;
    result = runFor(raidSimJson, job, seconds);
  }
  return result;
}
