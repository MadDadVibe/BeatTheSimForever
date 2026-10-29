import type { ActionId, SimSummary, SpellStats, TimelineEvent } from './types';

// The sim's results name other actions by name, its combat log by number; keys use the number, as the log does.
const OTHER_IDS: Record<string, number> = { OtherActionAttack: 7, OtherActionShoot: 8 };

export function actionKey(id: ActionId): string {
  if (id.spellId) return `spell:${id.spellId}`;
  if (id.itemId) return `item:${id.itemId}`;
  return `other:${OTHER_IDS[id.otherId ?? ''] ?? id.otherId ?? 'unknown'}${id.tag ? ':' + id.tag : ''}`;
}

/** Pets' actions get their own keys ("pet:spell:…"), so a pet's melee is not counted as yours. */
export const PET_PREFIX = 'pet:';

// "{SpellID: 10894}", "{ItemID: 12662}", "{OtherID: 2, Tag: 1}" in the combat log.
function logKey(text: string): string {
  const m = text.match(/\{(SpellID|ItemID|OtherID): (\d+)(?:, Tag: (\d+))?\}/);
  if (!m) return 'other:unknown';
  if (m[1] === 'SpellID') return `spell:${m[2]}`;
  if (m[1] === 'ItemID') return `item:${m[2]}`;
  return `other:${m[2]}${m[3] && m[3] !== '0' ? ':' + m[3] : ''}`;
}

function targetIndex(text: string): number | null {
  const m = text.match(/\[Target (\d+)\]/);
  return m ? Number(m[1]) - 1 : null;
}

/** Reads the player's side of the first simulated fight out of the sim's debug log, their pets' damage included. */
export function parseTimeline(logs: string, playerName: string): TimelineEvent[] {
  const events: TimelineEvent[] = [];
  const me = `[${playerName} (#1)]`;
  const myPet = `[${playerName} (#1) - `;
  for (const line of logs.split('\n')) {
    const m = line.match(/^\[(-?\d+(?:\.\d+)?)\] (.*)$/);
    if (!m) continue;
    const t = Number(m[1]);
    const rest = m[2];
    let x2: RegExpMatchArray | null;
    if (rest.startsWith(me)) {
      const body = rest.slice(me.length).trim();
      let x: RegExpMatchArray | null;
      if ((x = body.match(/^Casting (\{[^}]*\}) \(Cost = ([\d.]+), Cast Time = ([\d.]+)(m?s), Effective Time = ([\d.]+)(m?s)/))) {
        events.push({
          t, type: 'cast', key: logKey(x[1]), cost: Number(x[2]),
          castTime: Number(x[3]) / (x[4] === 'ms' ? 1000 : 1),
          effective: Number(x[5]) / (x[6] === 'ms' ? 1000 : 1),
        });
      } else if ((x = body.match(/^\[Target \d+\] (\{[^}]*\}) (tick )?([A-Z][a-z]+)\w* for ([\d.]+) damage/))) {
        const amount = Number(x[4]);
        if (amount > 0) events.push({ t, type: 'damage', key: logKey(x[1]), target: targetIndex(body) ?? 0, amount, crit: x[3].startsWith('Crit'), tick: !!x[2] });
      } else if ((x = body.match(/^(?:Spent|Gained) [\d.]+ mana from .* --> ([\d.]+)\)/))) {
        events.push({ t, type: 'mana', mana: Number(x[1]) });
      }
    } else if (rest.startsWith(myPet)) {
      const body = rest.slice(rest.indexOf(']') + 1).trim();
      const x = body.match(/^\[Target \d+\] (\{[^}]*\}) (tick )?([A-Z][a-z]+)\w* for ([\d.]+) damage/);
      const amount = x ? Number(x[4]) : 0;
      if (x && amount > 0) events.push({ t, type: 'damage', key: PET_PREFIX + logKey(x[1]), target: targetIndex(body) ?? 0, amount, crit: x[3].startsWith('Crit'), tick: !!x[2] });
    } else if ((x2 = rest.match(/^\[Target \d+\] Aura (gained|faded|refreshed):/))) {
      const type = x2[1] === 'gained' ? 'auraOn' : x2[1] === 'faded' ? 'auraOff' : 'auraRefresh';
      events.push({ t, type, key: logKey(rest), target: targetIndex(rest) });
    }
  }
  return events;
}

interface RawAction { id: ActionId; targets: Array<{ casts: number; damage: number }> }
interface RawUnit { name: string; dps: { avg: number; stdev: number; aggregatorData?: { n: number } }; actions: RawAction[]; pets?: RawUnit[] }
interface RawResult {
  errorResult?: string;
  logs?: string;
  raidMetrics: { parties: Array<{ players: RawUnit[] }> };
}

export function parseResult(json: string, seconds: number): SimSummary {
  const raw = JSON.parse(json) as RawResult;
  if (raw.errorResult) throw new Error(raw.errorResult);
  const player = raw.raidMetrics.parties[0].players[0];
  const iterations = player.dps.aggregatorData?.n ?? 1;
  // The player's DPS includes their pets'; their actions are listed separately.
  const actions = [
    ...player.actions.map((a) => [a, ''] as const),
    ...(player.pets ?? []).flatMap((p) => (p.actions ?? []).map((a) => [a, PET_PREFIX] as const)),
  ];
  const spells: SpellStats[] = actions.map(([a, prefix]) => {
    const casts = a.targets.reduce((s, t) => s + t.casts, 0);
    const damage = a.targets.reduce((s, t) => s + t.damage, 0);
    return { id: a.id, key: prefix + actionKey(a.id), casts, damage, castsPerFight: casts / iterations, damagePerFight: damage / iterations };
  });
  spells.sort((a, b) => b.damage - a.damage);
  return { dps: player.dps.avg, dpsStdev: player.dps.stdev, iterations, duration: seconds, spells, timeline: parseTimeline(raw.logs ?? '', player.name) };
}
