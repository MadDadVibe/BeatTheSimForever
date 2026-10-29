import type { SpecModule } from '../classes/types';

// Your action bar for a spec: which spell sits where and on which key. Saved in this browser only.

export interface BarSlot { key: string; short: string; hotkey: string }

/** The keys handed out by default, in bar order. */
export const DEFAULT_HOTKEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '-', '=', 'q', 'e', 'r', 't', 'f', 'g', 'z', 'x', 'c', 'v', 'b'];
/** Keys the game itself uses; they cannot be bound to a spell. */
const RESERVED = new Set([' ', 'tab', 'escape', 'enter', 'backspace', 'delete', 'f1', 'f2', 'f3', 'shift', 'control', 'alt', 'meta', 'capslock', 'contextmenu']);

export function bindable(key: string): boolean {
  return key.length > 0 && !RESERVED.has(key.toLowerCase()) && !key.startsWith('Arrow') && key !== 'Dead' && key !== 'Unidentified';
}

export function keyLabel(key: string): string {
  return key.length === 1 ? key.toUpperCase() : key.replace(/^F(\d+)$/i, 'F$1');
}

interface Saved { order: string[]; keys: Record<string, string> }
const storageKey = (spec: SpecModule) => `bar:${spec.key}`;

function read(spec: SpecModule): Saved | null {
  try {
    const raw = localStorage.getItem(storageKey(spec));
    return raw ? (JSON.parse(raw) as Saved) : null;
  } catch {
    return null;
  }
}

/** The bar for the spells the character has (available), your saved order and keys applied. */
export function loadLayout(spec: SpecModule, available: Set<string>): BarSlot[] {
  const own = spec.bar.filter((b) => available.has(b.key));
  const saved = read(spec);
  const rank = (key: string) => {
    const i = saved?.order.indexOf(key) ?? -1;
    return i < 0 ? 1000 + own.findIndex((b) => b.key === key) : i;
  };
  const ordered = [...own].sort((a, b) => rank(a.key) - rank(b.key));
  return ordered.map((b, i) => ({
    key: b.key,
    short: b.short,
    hotkey: saved && b.key in saved.keys ? saved.keys[b.key] : (DEFAULT_HOTKEYS[i] ?? ''),
  }));
}

export function saveLayout(spec: SpecModule, slots: BarSlot[]): void {
  // Keep the places of spells this character lacks (another race's racial, say) as they were.
  const before = read(spec);
  const order = [...slots.map((s) => s.key), ...(before?.order ?? []).filter((k) => !slots.some((s) => s.key === k))];
  const keys = { ...(before?.keys ?? {}), ...Object.fromEntries(slots.map((s) => [s.key, s.hotkey])) };
  try {
    localStorage.setItem(storageKey(spec), JSON.stringify({ order, keys }));
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

/** Swaps two spells' places; each keeps its key's place (the key stays with the slot). */
export function swapSlots(slots: BarSlot[], a: number, b: number): BarSlot[] {
  const out = [...slots];
  out[a] = { ...slots[b], hotkey: slots[a].hotkey };
  out[b] = { ...slots[a], hotkey: slots[b].hotkey };
  return out;
}
