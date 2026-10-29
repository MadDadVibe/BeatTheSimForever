import type { ReviewConfig } from '../classes/types';
import { runSim } from '../sim/client';
import type { AplRotation, SimSummary } from '../sim/types';
import { analyse, compare, type FightFacts, type Finding } from './analysis';
import type { FightLog } from './fight';
import { escapeHtml, iconUrl, label } from './names';

// After the fight: your numbers next to what the sim reaches in the same fight, what cost you the most, and both
// fights drawn one above the other.

const nf = (x: number) => Math.round(x).toLocaleString('de-DE');
const pct = (x: number) => `${Math.round(100 * x)} %`;
const icon = (key: string, cls = '') => {
  const url = iconUrl(key);
  return url ? `<img class="${cls}" src="${url}" alt="" onerror="this.remove()">` : '';
};

export async function showResults(root: HTMLElement, log: FightLog, rotation: AplRotation, again: () => void, settings: () => void) {
  const { setup } = log;
  const review = setup.spec.review;
  const you = analyse(log.timeline, log.duration, setup.targets, review);
  const myDps = you.damage / log.duration;

  root.innerHTML = `
    <div class="results">
      <h1>${log.abandoned ? 'Fight beendet' : 'Geschafft!'}</h1>
      <div class="score">
        <div><small>Du</small><strong>${nf(myDps)}</strong><small>DPS</small></div>
        <div data-el="sim"><small>Sim</small><strong>…</strong><small>rechnet</small></div>
        <div data-el="share"><small>Anteil</small><strong>…</strong><small>vom Sim</small></div>
      </div>
      <p class="muted">${log.duration.toFixed(1)} s Fight · ${setup.targets} ${setup.targets === 1 ? 'Boss' : 'Bosse'}<span data-el="best"></span></p>
      <section data-el="findings"><p class="muted">Der Sim spielt denselben Fight …</p></section>
      <h2>Kennzahlen</h2>
      <table class="compare"><thead><tr><th></th><th>Du</th><th>Sim</th></tr></thead><tbody data-el="stats"></tbody></table>
      <h2>Spells</h2>
      <table class="compare">
        <thead><tr><th>Spell</th><th>Casts<br><small>du / Sim</small></th><th>Schaden<br><small>du / Sim</small></th></tr></thead>
        <tbody data-el="rows"></tbody>
      </table>
      <h2>Ablauf</h2>
      <p class="muted small">Oben du, unten der erste Fight des Sims. Wischen zum Scrollen.</p>
      <div class="lanes" data-el="lanes"></div>
      <div class="actions">
        <button type="button" data-el="again">Nochmal</button>
        <button type="button" class="secondary" data-el="settings">Einstellungen</button>
      </div>
    </div>`;
  const el = (name: string) => root.querySelector<HTMLElement>(`[data-el="${name}"]`)!;
  el('again').addEventListener('click', again);
  el('settings').addEventListener('click', settings);
  spellRows(el('rows'), you, null);
  el('lanes').innerHTML = lanes(you, null, setup.countdown);

  let sim: SimSummary;
  try {
    // The same fight for the sim. A fight you ended early is compared over the time it lasted.
    const fight = log.abandoned ? { kind: 'time' as const, seconds: log.duration } : setup.fight;
    sim = await runSim({ profile: setup.profile, rotation, startBuffs: setup.spec.startBuffs, targets: setup.targets, fight, iterations: 1000, seed: Date.now() % 1e9 });
  } catch (err) {
    el('sim').innerHTML = `<small>Sim</small><strong>–</strong><small>${escapeHtml(err instanceof Error ? err.message : String(err))}</small>`;
    el('findings').innerHTML = '';
    return;
  }
  const share = myDps / sim.dps;
  el('sim').innerHTML = `<small>Sim</small><strong>${nf(sim.dps)}</strong><small>DPS</small>`;
  el('share').innerHTML = `<small>Anteil</small><strong class="${share >= 0.95 ? 'good' : share < 0.8 ? 'bad' : ''}">${pct(share)}</strong><small>vom Sim</small>`;
  el('best').textContent = bestShare(log, share);

  const simFacts = analyse(sim.timeline, sim.duration, setup.targets, review);
  const simCasts = Object.fromEntries(sim.spells.map((s) => [s.key, s.castsPerFight]));
  const simDamage = Object.fromEntries(sim.spells.map((s) => [s.key, s.damagePerFight]));
  const findings = compare(you, simFacts, simCasts, simDamage, review);
  el('findings').innerHTML = findingsHtml(findings, you, review);
  el('stats').innerHTML = statsRows(you, simFacts, review);
  spellRows(el('rows'), you, sim);
  el('lanes').innerHTML = lanes(you, simFacts, setup.countdown);
}

// ---------- what cost you ----------

function findingText(f: Finding, review: ReviewConfig): { title: string; detail: string; tip: string } {
  const name = f.key ? label(f.key) : '';
  switch (f.kind) {
    case 'idle':
      return {
        title: 'Leerlauf',
        detail: `${f.you.toFixed(1)} s ohne Cast oder GCD (Sim: ${f.sim.toFixed(1)} s)`,
        tip: 'Drück den nächsten Spell schon kurz vor Ende von GCD oder Cast, dann geht er direkt danach los.',
      };
    case 'dot':
      return {
        title: `${name}-Uptime`,
        detail: `${pct(f.you)} auf den Bossen (Sim: ${pct(f.sim)})`,
        tip: `Halte ${name} auf jedem Boss und erneuere ihn, sobald er ausläuft.`,
      };
    case 'refresh':
      return {
        title: `${name} zu früh erneuert`,
        detail: `${Math.round(f.you)}× neu gewirkt, während er noch lief (Sim: ${Math.round(f.sim)}×)`,
        tip: `Warte, bis ${name} ausläuft; jeder frühe Cast kostet einen GCD.`,
      };
    case 'cooldown':
      return {
        title: name,
        detail: `${Math.round(f.you)} Casts (Sim: ${f.sim.toFixed(1)})`,
        tip: `Wirk ${name}, sobald er bereit ist.`,
      };
    case 'channel':
      return {
        title: `${name} verschenkt`,
        detail: `${Math.round(f.you)} Ticks durch abgebrochene Channels verloren`,
        tip: `Unterbrich ${name} nicht mit sich selbst. Lass ihn auslaufen${review.keepOnCooldown.length ? ` oder clippe ihn nur für ${review.keepOnCooldown.map(label).join(' oder ')}` : ''}.`,
      };
  }
}

function findingsHtml(findings: Finding[], you: FightFacts, review: ReviewConfig): string {
  const threshold = Math.max(1, 0.01 * you.damage);
  const worse = findings.filter((f) => f.damage > threshold).slice(0, 5);
  const better = findings.filter((f) => f.damage < -threshold).slice(-3).reverse();
  const item = (f: Finding, sign: string) => {
    const t = findingText(f, review);
    return `<li class="finding">${f.key ? icon(f.key) : '<span class="ph"></span>'}<div><strong>${escapeHtml(t.title)}</strong>
      <span class="cost ${sign === '+' ? 'good' : 'bad'}">${sign}${nf(Math.abs(f.damage) / you.duration)} DPS</span>
      <p>${escapeHtml(t.detail)}</p>${sign === '−' ? `<p class="tip">${escapeHtml(t.tip)}</p>` : ''}</div></li>`;
  };
  let html = '';
  if (worse.length) html += `<h2>Was dich am meisten gekostet hat</h2><ul class="findings">${worse.map((f) => item(f, '−')).join('')}</ul>`;
  else html += '<h2>Sauber gespielt</h2><p class="muted">Nichts, was dich deutlich mehr gekostet hat als den Sim.</p>';
  if (better.length) html += `<h2>Besser als der Sim</h2><ul class="findings">${better.map((f) => item(f, '+')).join('')}</ul>`;
  return html + '<p class="muted small">Die DPS-Werte sind Schätzungen aus deinem und dem Sim-Fight.</p>';
}

// ---------- tables ----------

function statsRows(you: FightFacts, sim: FightFacts, review: ReviewConfig): string {
  const rows: Array<[string, string, string]> = [['Aktive Zeit', pct(you.busy / you.duration), pct(sim.busy / sim.duration)]];
  for (const key of review.dots) {
    (you.dotUptime[key] ?? []).forEach((u, i) => {
      rows.push([`${label(key)}${you.targets > 1 ? ` (Boss ${i + 1})` : ''}`, pct(u), pct(sim.dotUptime[key]?.[i] ?? 0)]);
    });
  }
  if (review.channel) {
    const full = review.channel.ticks;
    const dist = (f: FightFacts) => {
      const n = f.channelTicks.reduce((a, b) => a + b, 0);
      return n ? `${f.channelTicks[full] ?? 0} von ${n} voll` : '–';
    };
    rows.push([`${label(review.channel.key)} (${full} Ticks)`, dist(you), dist(sim)]);
  }
  return rows.map(([a, b, c]) => `<tr><td>${escapeHtml(a)}</td><td>${b}</td><td>${c}</td></tr>`).join('');
}

function spellRows(tbody: HTMLElement, you: FightFacts, sim: SimSummary | null) {
  const keys = new Set([...Object.keys(you.casts), ...Object.keys(you.damageBy), ...(sim?.spells.filter((s) => s.castsPerFight > 0 || s.damagePerFight > 0).map((s) => s.key) ?? [])]);
  // Of the other actions only white hits and auto shots do damage worth listing.
  const list = [...keys].filter((k) => !k.startsWith('other:') || /^other:[78](:|$)/.test(k)).map((key) => ({
    key,
    casts: you.casts[key] ?? 0,
    damage: you.damageBy[key] ?? 0,
    s: sim?.spells.find((x) => x.key === key),
  }));
  list.sort((a, b) => Math.max(b.damage, b.s?.damagePerFight ?? 0) - Math.max(a.damage, a.s?.damagePerFight ?? 0));
  tbody.innerHTML = list
    .map(({ key, casts, damage, s }) => `<tr><td>${icon(key)}${escapeHtml(label(key))}</td>
      <td>${casts} / ${s ? s.castsPerFight.toFixed(1) : '…'}</td>
      <td>${nf(damage)} / ${s ? nf(s.damagePerFight) : '…'}</td></tr>`)
    .join('');
}

// ---------- the fight drawn ----------

const PX = 26; // per second

function lanes(you: FightFacts, sim: FightFacts | null, countdown: number): string {
  const end = Math.max(you.duration, sim?.duration ?? 0);
  const width = (end + countdown) * PX;
  const x = (t: number) => (t + countdown) * PX;
  const lane = (name: string, f: FightFacts) => `<div class="lane"><span class="lane-name">${name}</span>${f.spans
    .filter((s) => s.start >= -countdown && s.start <= end)
    .map((s) => {
      const url = iconUrl(s.key);
      return `<span class="span" title="${escapeHtml(label(s.key))} ${s.start.toFixed(1)} s" style="left:${x(s.start)}px;width:${Math.max(6, (s.end - s.start) * PX - 2)}px;${url ? `background-image:url('${url}')` : ''}"></span>`;
    })
    .join('')}</div>`;
  const marks = [];
  for (let t = 0; t <= end; t += 5) marks.push(`<span class="mark" style="left:${x(t)}px">${t}</span>`);
  return `<div class="lanes-inner" style="width:${width + 40}px">${lane('Du', you)}${sim ? lane('Sim', sim) : ''}<div class="axis">${marks.join('')}</div></div>`;
}

// ---------- your best ----------

function bestShare(log: FightLog, share: number): string {
  const { setup } = log;
  const fight = setup.fight.kind === 'time' ? `t${setup.fight.seconds}` : `h${setup.fight.healthPerTarget}`;
  const key = `best:${setup.spec.key}:${String(setup.profile.player.race)}:${setup.targets}:${fight}`;
  if (log.abandoned) return '';
  try {
    const before = Number(localStorage.getItem(key) ?? 0);
    if (share > before) localStorage.setItem(key, String(share));
    return before > 0 ? ` · bisher bester Versuch: ${pct(before)}${share > before ? ' (neuer Rekord!)' : ''}` : '';
  } catch {
    return '';
  }
}
