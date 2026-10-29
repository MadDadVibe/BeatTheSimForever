import { runSim } from '../sim/client';
import type { AplRotation, SimSummary } from '../sim/types';
import type { FightLog } from './fight';
import { escapeHtml, iconUrl, label } from './names';

// After the fight: your numbers next to what the sim reaches in the same fight.

const nf = (x: number) => Math.round(x).toLocaleString('de-DE');

interface Mine { casts: number; damage: number }

function yours(log: FightLog): Map<string, Mine> {
  const by = new Map<string, Mine>();
  for (const e of log.timeline) {
    if (e.type !== 'cast' && e.type !== 'damage') continue;
    const m = by.get(e.key) ?? { casts: 0, damage: 0 };
    if (e.type === 'cast') m.casts++;
    else m.damage += e.amount;
    by.set(e.key, m);
  }
  return by;
}

export async function showResults(root: HTMLElement, log: FightLog, rotation: AplRotation, again: () => void, settings: () => void) {
  const { setup } = log;
  const mine = yours(log);
  const myDamage = [...mine.values()].reduce((a, m) => a + m.damage, 0);
  const myDps = myDamage / log.duration;

  root.innerHTML = `
    <div class="results">
      <h1>${log.abandoned ? 'Fight beendet' : 'Geschafft!'}</h1>
      <div class="score">
        <div><small>Du</small><strong>${nf(myDps)}</strong><small>DPS</small></div>
        <div data-el="sim"><small>Sim</small><strong>…</strong><small>rechnet</small></div>
        <div data-el="share"><small>Anteil</small><strong>…</strong><small>vom Sim</small></div>
      </div>
      <p class="muted">${log.duration.toFixed(1)} s Fight · ${setup.targets} ${setup.targets === 1 ? 'Boss' : 'Bosse'}</p>
      <table class="compare">
        <thead><tr><th>Spell</th><th>Casts<br><small>du / Sim</small></th><th>Schaden<br><small>du / Sim</small></th></tr></thead>
        <tbody data-el="rows"></tbody>
      </table>
      <div class="actions">
        <button type="button" data-el="again">Nochmal</button>
        <button type="button" class="secondary" data-el="settings">Einstellungen</button>
      </div>
    </div>`;
  const el = (name: string) => root.querySelector<HTMLElement>(`[data-el="${name}"]`)!;
  el('again').addEventListener('click', again);
  el('settings').addEventListener('click', settings);

  const rows = (sim: SimSummary | null) => {
    const keys = new Set([...mine.keys(), ...(sim?.spells.filter((s) => s.castsPerFight > 0 || s.damagePerFight > 0).map((s) => s.key) ?? [])]);
    const list = [...keys].map((key) => {
      const m = mine.get(key) ?? { casts: 0, damage: 0 };
      const s = sim?.spells.find((x) => x.key === key);
      return { key, m, s };
    });
    list.sort((a, b) => Math.max(b.m.damage, b.s?.damagePerFight ?? 0) - Math.max(a.m.damage, a.s?.damagePerFight ?? 0));
    el('rows').innerHTML = list
      .filter((r) => !r.key.startsWith('other:'))
      .map(({ key, m, s }) => {
        const icon = iconUrl(key);
        return `<tr><td>${icon ? `<img src="${icon}" alt="" onerror="this.remove()">` : ''}${escapeHtml(label(key))}</td>
          <td>${m.casts} / ${s ? s.castsPerFight.toFixed(1) : '…'}</td>
          <td>${nf(m.damage)} / ${s ? nf(s.damagePerFight) : '…'}</td></tr>`;
      })
      .join('');
  };
  rows(null);

  try {
    // The same fight for the sim. A fight you ended early is compared over the time it lasted.
    const fight = log.abandoned ? { kind: 'time' as const, seconds: log.duration } : setup.fight;
    const sim = await runSim({ profile: setup.profile, rotation, targets: setup.targets, fight, iterations: 1000, seed: Date.now() % 1e9 });
    el('sim').innerHTML = `<small>Sim</small><strong>${nf(sim.dps)}</strong><small>DPS</small>`;
    el('share').innerHTML = `<small>Anteil</small><strong>${Math.round((100 * myDps) / sim.dps)} %</strong><small>vom Sim</small>`;
    rows(sim);
  } catch (err) {
    el('sim').innerHTML = `<small>Sim</small><strong>–</strong><small>${escapeHtml(err instanceof Error ? err.message : String(err))}</small>`;
  }
}
