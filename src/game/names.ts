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

const OTHER: Record<string, string> = { 'other:OtherActionManaGain': 'Mana', 'other:OtherActionManaRegen': 'Mana-Regeneration' };

export function label(key: string): string {
  const [kind, id] = key.split(':');
  if (kind === 'spell') return names.spell[id]?.[0] ?? `Spell ${id}`;
  if (kind === 'item') return names.item[id]?.[0] ?? `Item ${id}`;
  return OTHER[key] ?? key;
}

export function iconUrl(key: string): string | null {
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
