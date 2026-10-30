import type { SpecModule } from '../classes/types';

// Your action bar for a spec: which spell sits where and on which key. Saved in this browser only.

/** A place on the bar and its key; key is the spell (or item) on it, '' when the place is empty. */
export interface BarSlot { key: string; short: string; hotkey: string }

/** How many buttons a row of the bar holds. The first row is the bottom one, the next ones go on top of it. */
export const ROW_LENGTH = 8;
/** The keys handed out by default, in bar order: 1 to 8 on the bottom row, Q E R F C X Y T above, then a third row. */
export const DEFAULT_HOTKEYS = ['1', '2', '3', '4', '5', '6', '7', '8', 'q', 'e', 'r', 'f', 'c', 'x', 'y', 't', '9', '0', '-', '=', 'g', 'v', 'b', 'n'];
/** Keys the game itself uses; they cannot be bound to a spell. */
const RESERVED = new Set([' ', 'tab', 'escape', 'enter', 'backspace', 'delete', 'f1', 'f2', 'f3', 'shift', 'control', 'alt', 'meta', 'capslock', 'contextmenu']);

export function bindable(key: string): boolean {
  return key.length > 0 && !RESERVED.has(key.toLowerCase()) && !key.startsWith('Arrow') && key !== 'Dead' && key !== 'Unidentified';
}

export function keyLabel(key: string): string {
  return key.length === 1 ? key.toUpperCase() : key.replace(/^F(\d+)$/i, 'F$1');
}

/** Rows of the bar that are always there, empty places included, so a spell can go on any of their keys. */
export const MIN_ROWS = 2;

// "bar3:": the bar by place: which spell sits on each place ('' for none) and each place's key. Bars saved before
// ("bar2:", "bar:") listed only the spells, in order; they keep that order from the first place on.
interface Saved { order: string[]; hotkeys: string[] }
interface OldSaved { order: string[]; keys?: Record<string, string> }
const storageKey = (spec: SpecModule) => `bar3:${spec.key}`;

function read(spec: SpecModule): Saved | null {
  try {
    const raw = localStorage.getItem(storageKey(spec));
    if (raw) return JSON.parse(raw) as Saved;
    const v2 = localStorage.getItem(`bar2:${spec.key}`);
    if (v2) {
      const old = JSON.parse(v2) as OldSaved;
      return { order: old.order, hotkeys: old.order.map((k, i) => old.keys?.[k] ?? DEFAULT_HOTKEYS[i] ?? '') };
    }
    const v1 = localStorage.getItem(`bar:${spec.key}`);
    return v1 ? { order: (JSON.parse(v1) as OldSaved).order, hotkeys: [] } : null;
  } catch {
    return null;
  }
}

/**
 * The bar for the spells the character has (available): at least MIN_ROWS full rows, spells on their saved places
 * and the rest on the first free ones, each place with its saved (or default) key.
 */
export function loadLayout(spec: SpecModule, available: Set<string>): BarSlot[] {
  const own = spec.bar.filter((b) => available.has(b.key));
  const saved = read(spec);
  const size = Math.max(MIN_ROWS, Math.ceil(own.length / ROW_LENGTH)) * ROW_LENGTH;
  const slots: BarSlot[] = Array.from({ length: size }, (_, i) => ({ key: '', short: '', hotkey: saved?.hotkeys[i] ?? DEFAULT_HOTKEYS[i] ?? '' }));
  const rest: typeof own = [];
  for (const b of own) {
    const i = saved?.order.indexOf(b.key) ?? -1;
    if (i >= 0 && i < size && !slots[i].key) slots[i] = { ...slots[i], key: b.key, short: b.short };
    else rest.push(b);
  }
  for (const b of rest) {
    const i = slots.findIndex((s) => !s.key);
    slots[i] = { ...slots[i], key: b.key, short: b.short };
  }
  return slots;
}

export function saveLayout(spec: SpecModule, slots: BarSlot[]): void {
  // A place left empty because this character lacks its spell (another race's racial, say) keeps that spell.
  const before = read(spec);
  const order = slots.map((s, i) => {
    const old = before?.order[i] ?? '';
    return s.key || (old && !slots.some((x) => x.key === old) ? old : '');
  });
  try {
    localStorage.setItem(storageKey(spec), JSON.stringify({ order, hotkeys: slots.map((s) => s.hotkey) }));
  } catch {
    // Without storage the bar still works; it is just not remembered.
  }
}

/** Puts key on slot i; a slot that had it already gets slot i's old key, so no key is bound twice. */
export function bindKey(slots: BarSlot[], i: number, key: string): BarSlot[] {
  const k = key.toLowerCase();
  const old = slots[i].hotkey;
  return slots.map((s, j) => (j === i ? { ...s, hotkey: k } : s.hotkey === k ? { ...s, hotkey: old } : s));
}

/** Swaps what sits on two places (a spell, or nothing); the keys stay with the places. */
export function swapSlots(slots: BarSlot[], a: number, b: number): BarSlot[] {
  const out = [...slots];
  out[a] = { ...slots[b], hotkey: slots[a].hotkey };
  out[b] = { ...slots[a], hotkey: slots[b].hotkey };
  return out;
}
