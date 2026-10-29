import type { ClassModule } from '../classes/types';
import { computeStats, loadTalentTrees, type TalentTree } from '../sim/client';
import type { SimProfile } from '../sim/types';
import { enchantName, escapeHtml, iconUrl, label, namedIconUrl } from './names';

// The character the fight is played with, as the sim set it up: talents, gear, consumables and stats.

const SLOTS = ['Kopf', 'Hals', 'Schultern', 'Rücken', 'Brust', 'Handgelenke', 'Hände', 'Taille', 'Beine', 'Füße',
  'Finger', 'Finger', 'Schmuck', 'Schmuck', 'Waffenhand', 'Schildhand', 'Distanz'];

// The sim's Stat list, in order.
const STATS = ['Strength', 'Agility', 'Stamina', 'Intellect', 'Spirit', 'SpellPower', 'ArcanePower', 'FirePower',
  'FrostPower', 'HolyPower', 'NaturePower', 'ShadowPower', 'MP5', 'SpellHit', 'SpellCrit', 'SpellHaste',
  'SpellPenetration', 'AttackPower', 'MeleeHit', 'MeleeCrit', 'MeleeHaste', 'ArmorPenetration', 'Expertise', 'Mana',
  'Energy', 'Rage', 'Armor', 'RangedAttackPower', 'Defense', 'Block', 'BlockValue', 'Dodge', 'Parry', 'Resilience',
  'Health'];
const STAT_NAMES: Record<string, string> = {
  Strength: 'Stärke', Agility: 'Beweglichkeit', Stamina: 'Ausdauer', Intellect: 'Intelligenz', Spirit: 'Willenskraft',
  SpellPower: 'Zaubermacht', ArcanePower: 'Arkanmacht', FirePower: 'Feuermacht', FrostPower: 'Frostmacht',
  HolyPower: 'Heiligmacht', NaturePower: 'Naturmacht', ShadowPower: 'Schattenmacht', MP5: 'Mana alle 5 s',
  SpellHit: 'Zaubertrefferchance', SpellCrit: 'Zauberkrit', SpellHaste: 'Zaubertempo', AttackPower: 'Angriffskraft',
  MeleeHit: 'Trefferchance', MeleeCrit: 'Krit', MeleeHaste: 'Tempo', Mana: 'Mana', Health: 'Leben', Armor: 'Rüstung',
  RangedAttackPower: 'Distanzangriffskraft', Expertise: 'Waffenkunde', Defense: 'Verteidigung',
};
const PERCENT = new Set(['SpellHit', 'SpellCrit', 'SpellHaste', 'MeleeHit', 'MeleeCrit', 'MeleeHaste', 'Dodge', 'Parry', 'Block']);

const decamel = (s: string) => s.replace(/([a-z])([A-Z])/g, '$1 $2');
const simClassOf = (profile: SimProfile) => String(profile.player.class ?? '').replace(/^Class/, '').toLowerCase();

/** Points per tree and the talents taken, from the sim's talent code ("50500500102--5054…"). */
export function readTalents(code: string, trees: TalentTree[]) {
  return trees.map((tree, i) => {
    const digits = (code.split('-')[i] ?? '').split('').map(Number);
    const taken = tree.talents
      .map((t, j) => ({ ...t, points: digits[j] ?? 0 }))
      .filter((t) => t.points > 0)
      .sort((a, b) => a.row - b.row || a.col - b.col);
    return { name: tree.name, points: digits.reduce((a, b) => a + b, 0), taken };
  });
}

export function sheetSkeleton(cls: ClassModule, profile: SimProfile): string {
  const race = String(profile.player.race ?? '').replace(/^Race/, '').replace(/([a-z])([A-Z])/g, '$1 $2');
  return `
    <h2 class="sheet-title">${escapeHtml(cls.name)} · ${escapeHtml(race)}</h2>
    <details class="sheet-part" open><summary>Talente <span data-sheet="spec"></span></summary><div data-sheet="talents">…</div></details>
    <details class="sheet-part"><summary>Werte <small>mit Gear, Buffs und Verbrauchsgütern</small></summary><div data-sheet="stats">…</div></details>
    <details class="sheet-part"><summary>Gear</summary>${gearHtml(profile)}</details>
    <details class="sheet-part"><summary>Verbrauchsgüter</summary>${consumesHtml(profile)}</details>`;
}

/** Fills in what needs loading (talent trees, stats from the engine). */
export async function fillSheet(root: HTMLElement, cls: ClassModule, profile: SimProfile) {
  const part = (name: string) => root.querySelector<HTMLElement>(`[data-sheet="${name}"]`);
  const code = String(profile.player.talentsString ?? '');
  try {
    const trees = readTalents(code, await loadTalentTrees(simClassOf(profile)));
    const spec = part('spec');
    if (spec) spec.textContent = trees.map((t) => t.points).join(' / ');
    const talents = part('talents');
    if (talents) {
      talents.innerHTML = trees
        .filter((t) => t.points > 0)
        .map((t) => `<div class="tree${t.name.startsWith(cls.spec) ? ' main' : ''}"><h3>${escapeHtml(t.name)} <small>${t.points}</small></h3>
          <div class="talent-grid">${t.taken.map((x) => {
            const url = namedIconUrl(x.icon);
            return `<span class="talent" title="${escapeHtml(x.name)} ${x.points}/${x.maxPoints}">${url ? `<img src="${url}" alt="" onerror="this.remove()">` : ''}<b>${x.points}/${x.maxPoints}</b><em>${escapeHtml(x.name)}</em></span>`;
          }).join('')}</div></div>`)
        .join('') + `<p class="muted small">Talent-Code: <code>${escapeHtml(code)}</code></p>`;
    }
  } catch {
    const talents = part('talents');
    if (talents) talents.innerHTML = `<p class="muted">Talent-Code: <code>${escapeHtml(code)}</code></p>`;
  }
  try {
    const stats = await computeStats(profile);
    const el = part('stats');
    if (el) {
      el.innerHTML = `<table class="stats">${cls.stats
        .map((name) => {
          const v = stats[STATS.indexOf(name)] ?? 0;
          const shown = PERCENT.has(name) ? `${v.toFixed(2)} %` : Math.round(v).toLocaleString('de-DE');
          return `<tr><td>${escapeHtml(STAT_NAMES[name] ?? decamel(name))}</td><td>${shown}</td></tr>`;
        })
        .join('')}</table>`;
    }
  } catch (err) {
    const el = part('stats');
    if (el) el.textContent = `Werte nicht verfügbar: ${err instanceof Error ? err.message : err}`;
  }
}

function gearHtml(profile: SimProfile): string {
  const items = ((profile.player.equipment as { items?: Array<{ id?: number; enchant?: number }> } | undefined)?.items) ?? [];
  return `<ul class="gear">${items
    .map((it, i) => {
      if (!it?.id) return '';
      const key = `item:${it.id}`;
      const url = iconUrl(key);
      const name = label(key).replace(/^Modeled: /, '');
      const enchant = it.enchant ? enchantName(it.enchant) : null;
      return `<li>${url ? `<img src="${url}" alt="" onerror="this.remove()">` : '<span class="ph"></span>'}<div><small>${SLOTS[i] ?? ''}</small>
        <span>${escapeHtml(name)}</span>${enchant ? `<small class="enchant">${escapeHtml(enchant)}</small>` : ''}</div></li>`;
    })
    .join('')}</ul>`;
}

function consumesHtml(profile: SimProfile): string {
  const c = (profile.player.consumes ?? {}) as Record<string, unknown>;
  const rows = Object.entries(c).filter(([, v]) => typeof v === 'string' && v);
  if (!rows.length) return '<p class="muted">Keine.</p>';
  return `<ul class="consumes">${rows.map(([, v]) => `<li>${escapeHtml(decamel(String(v)))}</li>`).join('')}</ul>`;
}
