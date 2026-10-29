import type { ReviewConfig } from '../classes/types';
import type { TimelineEvent } from '../sim/types';

// Reads one fight (yours, or the sim's first) out of its timeline: how busy you were, how long the DoTs were up,
// how full the channels ran. Class-neutral: the class says which spells are DoTs, channels and cooldowns.

export interface FightFacts {
  duration: number;
  targets: number;
  damage: number;
  /** Seconds from the pull to the end in which you were casting, channelling or on the global cooldown. */
  busy: number;
  idle: number;
  casts: Record<string, number>;
  damageBy: Record<string, number>;
  /** Per DoT, per boss: the share of the fight it was up (0 to 1). */
  dotUptime: Record<string, number[]>;
  /** Per DoT: how often it was cast again while still running. */
  dotRefreshes: Record<string, number>;
  /** How many channels ended after 0, 1, 2 … ticks. */
  channelTicks: number[];
  /** Ticks lost to channels cut short by the same channel or with no tick at all. */
  channelTicksLost: number;
  /** Each cast with when it kept you busy, for drawing the fight. */
  spans: Array<{ key: string; start: number; end: number }>;
}

export function analyse(timeline: TimelineEvent[], duration: number, targets: number, review: ReviewConfig): FightFacts {
  const casts: Record<string, number> = {};
  const damageBy: Record<string, number> = {};
  let damage = 0;
  for (const e of timeline) {
    if (e.type === 'cast') casts[e.key] = (casts[e.key] ?? 0) + 1;
    if (e.type === 'damage' && e.t <= duration + 1e-6) {
      damageBy[e.key] = (damageBy[e.key] ?? 0) + e.amount;
      damage += e.amount;
    }
  }

  // When each cast kept you busy. A channel lasts until its effect fades or the next cast cuts it.
  const castEvents = timeline.filter((e): e is Extract<TimelineEvent, { type: 'cast' }> => e.type === 'cast');
  const spans: FightFacts['spans'] = [];
  const channelTicks: number[] = Array((review.channel?.ticks ?? 0) + 1).fill(0);
  let channelTicksLost = 0;
  castEvents.forEach((c, i) => {
    const next = castEvents.slice(i + 1).find((n) => n.effective > 0 || n.castTime > 0);
    let end = c.t + Math.max(c.effective, c.castTime);
    if (review.channel && c.key === review.channel.key) {
      const fade = timeline.find((e) => e.type === 'auraOff' && e.key === c.key && e.t > c.t);
      let chEnd = Math.min(fade?.t ?? Infinity, c.t + review.channel.seconds, next?.t ?? Infinity, duration);
      if (chEnd < c.t) chEnd = c.t;
      end = Math.max(end, chEnd);
      const ticks = timeline.filter((e) => e.type === 'damage' && e.tick && e.key === c.key && e.t > c.t && e.t <= chEnd + 1e-6).length;
      channelTicks[Math.min(ticks, channelTicks.length - 1)]++;
      const cutByItself = next?.key === c.key && Math.abs((next?.t ?? -1) - chEnd) < 1e-6;
      if (ticks < review.channel.ticks && (ticks === 0 || cutByItself)) channelTicksLost += review.channel.ticks - ticks;
    }
    if (end > c.t) spans.push({ key: c.key, start: c.t, end });
  });

  // Busy time from the pull on: the union of the spans.
  let busy = 0;
  let reach = 0;
  for (const s of [...spans].sort((a, b) => a.start - b.start)) {
    const start = Math.max(s.start, reach, 0);
    const end = Math.min(s.end, duration);
    if (end > start) busy += end - start;
    reach = Math.max(reach, s.end);
  }

  const dotUptime: Record<string, number[]> = {};
  const dotRefreshes: Record<string, number> = {};
  for (const key of review.dots) {
    const up = Array(targets).fill(0);
    const since: Array<number | null> = Array(targets).fill(null);
    dotRefreshes[key] = 0;
    for (const e of timeline) {
      if ((e.type !== 'auraOn' && e.type !== 'auraOff' && e.type !== 'auraRefresh') || e.key !== key) continue;
      const i = e.target ?? 0;
      if (i >= targets) continue;
      if (e.type === 'auraOn' && since[i] === null) since[i] = e.t;
      else if (e.type === 'auraOff' && since[i] !== null) {
        up[i] += overlap(since[i]!, e.t, duration);
        since[i] = null;
      } else if (e.type === 'auraRefresh' && e.t >= 0) dotRefreshes[key]++;
    }
    since.forEach((s, i) => { if (s !== null) up[i] += overlap(s, duration, duration); });
    dotUptime[key] = up.map((u) => (duration > 0 ? u / duration : 0));
  }

  return { duration, targets, damage, busy, idle: Math.max(0, duration - busy), casts, damageBy, dotUptime, dotRefreshes, channelTicks, channelTicksLost, spans };
}

const overlap = (from: number, to: number, duration: number) => Math.max(0, Math.min(to, duration) - Math.max(from, 0));

/** One thing you did worse (or better) than the sim, with roughly what it cost (or gained) in damage. */
export interface Finding {
  kind: 'idle' | 'dot' | 'cooldown' | 'channel' | 'refresh';
  key?: string;
  /** Estimated damage lost; negative when you did better than the sim. */
  damage: number;
  /** What happened, in numbers: you and the sim. */
  you: number;
  sim: number;
}

/**
 * Compares your fight with the sim's. simFacts is the sim's first fight; simCasts and simDamage are its averages per
 * fight (steadier than one fight). The sim's numbers are scaled to your fight's length.
 */
export function compare(you: FightFacts, sim: FightFacts, simCasts: Record<string, number>, simDamage: Record<string, number>, review: ReviewConfig): Finding[] {
  const out: Finding[] = [];
  const scale = sim.duration > 0 ? you.duration / sim.duration : 1;
  const busyRate = you.busy > 0 ? you.damage / you.busy : 0;

  // Time doing nothing.
  const simIdle = sim.idle * scale;
  out.push({ kind: 'idle', damage: (you.idle - simIdle) * busyRate, you: you.idle, sim: simIdle });

  // DoTs: the damage a DoT does per second it is up, from the sim.
  for (const key of review.dots) {
    const yu = avg(you.dotUptime[key] ?? []), su = avg(sim.dotUptime[key] ?? []);
    const simUpSeconds = su * sim.duration * sim.targets;
    const perSecond = simUpSeconds > 0 ? (simDamage[key] ?? 0) / simUpSeconds : 0;
    out.push({ kind: 'dot', key, damage: (su - yu) * you.duration * you.targets * perSecond, you: yu, sim: su });
    const extra = (you.dotRefreshes[key] ?? 0) - (sim.dotRefreshes[key] ?? 0) * scale;
    if (extra >= 1) out.push({ kind: 'refresh', key, damage: extra * 1.5 * busyRate * 0.5, you: you.dotRefreshes[key] ?? 0, sim: (sim.dotRefreshes[key] ?? 0) * scale });
  }

  // Spells to keep on cooldown: casts you missed, at what the sim's casts of it did.
  for (const key of review.keepOnCooldown) {
    const simN = (simCasts[key] ?? 0) * scale, youN = you.casts[key] ?? 0;
    const perCast = (simCasts[key] ?? 0) > 0 ? (simDamage[key] ?? 0) / simCasts[key] : 0;
    if (simN > 0 || youN > 0) out.push({ kind: 'cooldown', key, damage: (simN - youN) * perCast, you: youN, sim: simN });
  }

  // Channels cut short for nothing.
  if (review.channel && you.channelTicksLost > 0) {
    const ch = review.channel.key;
    const ticks = you.channelTicks.reduce((a, n, i) => a + n * i, 0);
    const perTick = ticks > 0 ? (you.damageBy[ch] ?? 0) / ticks : 0;
    out.push({ kind: 'channel', key: ch, damage: you.channelTicksLost * perTick, you: you.channelTicksLost, sim: sim.channelTicksLost * scale });
  }
  return out.sort((a, b) => b.damage - a.damage);
}

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
