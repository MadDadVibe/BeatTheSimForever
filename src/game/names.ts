import { simFile } from '../sim/client';

// Names and icons of spells and items, from the sim's database (public/sim/names.json).
let names: { spell: Record<string, [string, string]>; item: Record<string, [string, string]>; enchant?: Record<string, string> } = { spell: {}, item: {} };

export async function loadNames(): Promise<void> {
  try {
    names = await (await fetch(simFile('names.json'))).json();
  } catch {
    // Without names the game still works; it shows ids instead.
  }
}

const OTHER: Record<string, string> = {
  'other:OtherActionManaGain': 'Mana',
  'other:OtherActionManaRegen': 'Mana-Regeneration',
  'other:7': 'Nahkampf',
  'other:7:1': 'Nahkampf (Haupthand)',
  'other:7:2': 'Nahkampf (Nebenhand)',
  'other:7:3': 'Nahkampf (Extraangriff)',
  'other:8': 'Autoschuss',
};
const PET = 'pet:';

export function label(key: string): string {
  if (key.startsWith(PET)) return `Pet: ${label(key.slice(PET.length))}`;
  if (key.startsWith('move:')) return `Laufen auf ${key.slice(5)} Meter`;
  const [kind, id] = key.split(':');
  if (kind === 'spell') return names.spell[id]?.[0] ?? `Spell ${id}`;
  if (kind === 'item') return names.item[id]?.[0] ?? `Item ${id}`;
  return OTHER[key] ?? key;
}

/** A walk's icon: an arrow up towards the boss into melee range, down away from it to shooting range. */
function arrow(up: boolean): string {
  const path = up ? 'M32 8 L56 36 H42 V56 H22 V36 H8 Z' : 'M32 56 L56 28 H42 V8 H22 V28 H8 Z';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="${up ? '#2f5f3f' : '#3f3466'}"/><path d="${path}" fill="${up ? '#8ff0ad' : '#cdb6ff'}" stroke="#000" stroke-width="2"/></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

/** Melee attacks reach this far, in yards; a walk to here or closer goes into melee range. */
const MELEE_YARDS = 5;

export function iconUrl(key: string): string | null {
  if (key.startsWith('move:')) return arrow(Number(key.slice(5)) <= MELEE_YARDS);
  if (key.startsWith(PET)) key = key.slice(PET.length);
  const [kind, id] = key.split(':');
  const icon = (kind === 'spell' ? names.spell : kind === 'item' ? names.item : {})[id]?.[1];
  return icon ? simFile(`icons/${icon}.jpg`) : null;
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

export function enchantName(id: number): string | null {
  return names.enchant?.[id] ?? null;
}

/** An icon by its name in the sim's icon set (e.g. a talent's). */
export function namedIconUrl(icon: string | undefined): string | null {
  return icon ? simFile(`icons/${icon}.jpg`) : null;
}
