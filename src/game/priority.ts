import { normalizeApl } from '../sim/apl';
import { actionKey } from '../sim/result';
import type { ActionId, AplRotation } from '../sim/types';
import { escapeHtml, iconUrl, label } from './names';

// The sim's rotation as a list you can read: one line per entry of its priority list, top to bottom, each with the
// spell it casts and, in words, when. The sim casts the first line whose spell is ready and whose condition holds.

export interface PriorityEntry {
  /** The entry's index in the (normalized) rotation's priority list; the engine names it with its hint. */
  index: number;
  /** The spells (or items) the entry casts; empty for an entry like "major cooldowns". */
  keys: string[];
  title: string;
  /** When it is cast, in words; empty when always. */
  when: string;
  /** When a channel is cut short, in words. */
  stop?: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Node = Record<string, any>;

const OPS: Record<string, string> = { OpLt: '<', OpLe: '≤', OpGt: '>', OpGe: '≥', OpEq: '=', OpNe: '≠' };
const MATH: Record<string, string> = { OpAdd: '+', OpSub: '−', OpMul: '×', OpDiv: '÷' };

const name = (id: ActionId | undefined) => (id ? label(actionKey(id)) : '?');

/** A number, a duration ("1.5s" → "1,5 s") or a percentage, as written in the rotation. */
function constant(val: string): string {
  const m = val.match(/^(-?[\d.]+)(ms|s|%|y)?$/);
  if (!m) return val;
  const n = Number(m[1]) / (m[2] === 'ms' ? 1000 : 1);
  const text = n.toLocaleString('de-DE', { maximumFractionDigits: 2 });
  return m[2] === 's' || m[2] === 'ms' ? `${text} s` : m[2] === '%' ? `${text} %` : m[2] === 'y' ? `${text} m` : text;
}

/** A value in a comparison: a number, a resource, a remaining time … */
function value(v: Node): string {
  if (v.const) return constant(String(v.const.val));
  if (v.currentMana) return 'Mana';
  if (v.currentManaPercent) return 'Mana';
  if (v.currentRage) return 'Wut';
  if (v.currentEnergy) return 'Energie';
  if (v.currentComboPoints) return 'Combopunkte';
  if (v.currentHealthPercent) return 'Boss-Leben';
  if (v.remainingTime) return 'Restzeit des Fights';
  if (v.currentTime) return 'Fightzeit';
  if (v.numberTargets) return 'Anzahl Ziele';
  if (v.dotRemainingTime) return `Restzeit ${name(v.dotRemainingTime.spellId)}`;
  if (v.auraRemainingTime) return `Restzeit ${name(v.auraRemainingTime.auraId)}`;
  if (v.auraNumStacks) return `Stacks ${name(v.auraNumStacks.auraId)}`;
  if (v.spellTimeToReady) return `Cooldown ${name(v.spellTimeToReady.spellId)}`;
  if (v.spellCastTime) return `Castzeit ${name(v.spellCastTime.spellId)}`;
  if (v.spellCurrentCost) return `Kosten ${name(v.spellCurrentCost.spellId)}`;
  if (v.spellTravelTime) return `Flugzeit ${name(v.spellTravelTime.spellId)}`;
  if (v.spellExpectedDpet) return `Schaden pro Sekunde Cast von ${name(v.spellExpectedDpet.spellId)}`;
  if (v.autoTimeToNext) return 'Zeit bis zum nächsten Autohit';
  if (v.autoSwingTime) return 'Schlagtempo';
  if (v.currentSealRemainingTime) return 'Restzeit des Siegels';
  if (v.totemRemainingTime) return `Restzeit ${v.totemRemainingTime.totemType === 'Fire' ? 'Feuertotem' : 'Totem'}`;
  if (v.spellChanneledTicks) return `Ticks ${name(v.spellChanneledTicks.spellId)}`;
  if (v.hunterHawkCount) return 'Hawk-Stacks';
  if (v.hunterHawkRemainingTime) return 'Restzeit Hawk';
  if (v.math) return `(${value(v.math.lhs)} ${MATH[v.math.op] ?? '?'} ${value(v.math.rhs)})`;
  return '…';
}

/** A condition in words; inner: it sits inside an "and"/"or" and needs brackets if it is one itself. */
function condition(c: Node, inner = false): string {
  if (c.const) return c.const.val === 'false' ? 'nie' : '';
  if (c.and || c.or) {
    const parts = ((c.and ?? c.or).vals as Node[]).map((v) => condition(v, true)).filter(Boolean);
    const text = parts.join(c.and ? ' und ' : ' oder ');
    return inner && parts.length > 1 ? `(${text})` : text;
  }
  if (c.not) {
    const v = c.not.val as Node;
    if (v.auraIsActive) return `${name(v.auraIsActive.auraId)} nicht aktiv`;
    if (v.dotIsActive) return `${name(v.dotIsActive.spellId)} nicht auf dem Ziel`;
    if (v.isExecutePhase) return `Boss über ${executeAt(v.isExecutePhase.threshold)}`;
    if (v.auraIsKnown) return `ohne ${name(v.auraIsKnown.auraId)}`;
    if (v.spellIsKnown) return `ohne ${name(v.spellIsKnown.spellId)}`;
    if (v.spellCanCast) return `${name(v.spellCanCast.spellId)} nicht wirkbar`;
    return `nicht ${condition(v, true)}`;
  }
  if (c.cmp) return `${value(c.cmp.lhs)} ${OPS[c.cmp.op] ?? '?'} ${value(c.cmp.rhs)}`;
  if (c.auraIsActive) return `${name(c.auraIsActive.auraId)} aktiv`;
  if (c.dotIsActive) return `${name(c.dotIsActive.spellId)} auf dem Ziel`;
  if (c.isExecutePhase) return `Boss unter ${executeAt(c.isExecutePhase.threshold)}`;
  if (c.auraIsKnown) return `mit ${name(c.auraIsKnown.auraId)}`;
  if (c.spellIsKnown) return `mit ${name(c.spellIsKnown.spellId)}`;
  if (c.spellCanCast) return `${name(c.spellCanCast.spellId)} wirkbar`;
  if (c.auraShouldRefresh) return `${name(c.auraShouldRefresh.auraId)} läuft bald aus`;
  return 'unter einer Bedingung';
}

const executeAt = (threshold: string | undefined) => `${(threshold ?? 'E20').replace(/^E/, '')} %`;

/** The rotation's priority list in words. Entries whose spells the character does not have (have) are left out. */
export function priorityEntries(rotation: AplRotation, have: Set<string>): PriorityEntry[] {
  const list = (normalizeApl(rotation).priorityList ?? []) as Array<{ action?: Node }>;
  const out: PriorityEntry[] = [];
  list.forEach((item, index) => {
    const a = item.action ?? {};
    const when = a.condition ? condition(a.condition) : '';
    if (when === 'nie') return;
    let keys: string[] = [];
    let title: string;
    let stop: string | undefined;
    if (a.castSpell || a.channelSpell) {
      keys = [actionKey((a.castSpell ?? a.channelSpell).spellId)];
      title = label(keys[0]);
      if (a.channelSpell?.interruptIf) stop = condition(a.channelSpell.interruptIf);
    } else if (a.strictSequence) {
      keys = ((a.strictSequence.actions ?? []) as Node[]).flatMap((s) => (s.castSpell ? [actionKey(s.castSpell.spellId)] : []));
      title = keys.map(label).join(' → ');
    } else if (a.autocastOtherCooldowns) {
      title = 'Große Cooldowns (Trinkets, Racials …), sobald bereit';
    } else if (a.castPaladinPrimarySeal) {
      title = 'Dein Hauptsiegel';
    } else if (a.move) {
      const to = a.move.rangeFromTarget?.const?.val;
      title = to ? `Laufen auf ${constant(String(to)).replace(/ m$/, '')} Meter` : 'Laufen';
      keys = to ? [`move:${String(to).replace(/y$/, '')}`] : [];
    } else if (a.wait) {
      title = 'Warten';
    } else {
      return;
    }
    if (keys.length && keys.every((k) => !have.has(k))) return; // another race's racial, say
    out.push({ index, keys, title, when, ...(stop ? { stop } : {}) });
  });
  return out;
}

export function priorityHtml(entries: PriorityEntry[]): string {
  if (!entries.length) return '<p class="muted small">Diese Rota hat keine Prioliste.</p>';
  return `<ol class="prio">${entries
    .map((e) => {
      const url = e.keys.length ? iconUrl(e.keys[0]) : null;
      return `<li data-entry="${e.index}">${url ? `<img src="${url}" alt="" onerror="this.remove()">` : '<span class="ph"></span>'}<div><strong>${escapeHtml(e.title)}</strong>${e.when ? `<small>wenn ${escapeHtml(e.when)}</small>` : ''}${e.stop ? `<small>abbrechen bei ${escapeHtml(e.stop)}</small>` : ''}</div></li>`;
    })
    .join('')}</ol>`;
}
