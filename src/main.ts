import './style.css';
import { CLASSES } from './classes';
import { rotationFromExport } from './sim/apl';
import { loadProfiles, runSim } from './sim/client';
import type { AplRotation, FightSpec, SimProfile } from './sim/types';

// Step 1 preview: pick a setup, run the sim in the browser, show what it reached.
const form = document.querySelector<HTMLFormElement>('#setup')!;
const status = document.querySelector<HTMLElement>('#status')!;
const field = <T extends HTMLElement>(name: string) => form.elements.namedItem(name) as unknown as T;

let profiles: Record<string, SimProfile> = {};
let names: { spell: Record<string, [string, string]>; item: Record<string, [string, string]> } = { spell: {}, item: {} };
const nf = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 0 });

function label(key: string): string {
  const [kind, id] = key.split(':');
  if (kind === 'spell') return names.spell[id]?.[0] ?? `Spell ${id}`;
  if (kind === 'item') return names.item[id]?.[0] ?? `Item ${id}`;
  return ({ 'other:OtherActionManaGain': 'Mana', 'other:OtherActionManaRegen': 'Mana-Regeneration' } as Record<string, string>)[key] ?? key;
}

function raceName(key: string): string {
  return key.split('_').map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');
}

async function loadClass() {
  const cls = CLASSES.find((c) => c.key === field<HTMLSelectElement>('class').value)!;
  profiles = await loadProfiles(cls.key);
  const race = field<HTMLSelectElement>('race');
  race.innerHTML = Object.keys(profiles).map((r) => `<option value="${r}">${raceName(r)}</option>`).join('');
  race.value = cls.defaultRace in profiles ? cls.defaultRace : Object.keys(profiles)[0];
}

function syncFightFields() {
  const kind = field<HTMLSelectElement>('fight').value;
  form.querySelectorAll<HTMLElement>('[data-for]').forEach((el) => (el.hidden = el.dataset.for !== kind));
}

async function chosenRotation(): Promise<AplRotation> {
  const file = field<HTMLInputElement>('rotation').files?.[0];
  if (file) return rotationFromExport(JSON.parse(await file.text()));
  return CLASSES.find((c) => c.key === field<HTMLSelectElement>('class').value)!.defaultRotation;
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const button = form.querySelector('button')!;
  button.disabled = true;
  status.textContent = 'Der Sim rechnet …';
  try {
    const fight: FightSpec = field<HTMLSelectElement>('fight').value === 'time'
      ? { kind: 'time', seconds: Number(field<HTMLInputElement>('seconds').value) }
      : { kind: 'health', healthPerTarget: Number(field<HTMLInputElement>('health').value) };
    const started = performance.now();
    const s = await runSim({
      profile: profiles[field<HTMLSelectElement>('race').value],
      rotation: await chosenRotation(),
      targets: Number(field<HTMLSelectElement>('targets').value),
      fight,
      iterations: Number(field<HTMLInputElement>('iterations').value),
      seed: Math.floor(Math.random() * 1e9),
    });
    status.textContent = `Fertig in ${((performance.now() - started) / 1000).toFixed(1)} s.`;
    document.querySelector('#dps')!.textContent = `${nf.format(s.dps)} DPS`;
    document.querySelector('#dps-detail')!.textContent = `± ${nf.format(s.dpsStdev)} · ${s.duration.toFixed(1)} s Fight · ${s.iterations} Iterationen`;
    const total = s.spells.reduce((a, x) => a + x.damagePerFight, 0);
    document.querySelector('#spells tbody')!.innerHTML = s.spells
      .filter((x) => x.castsPerFight > 0 || x.damagePerFight > 0)
      .map((x) => `<tr><td>${label(x.key)}</td><td>${x.castsPerFight.toFixed(1)}</td><td>${nf.format(x.damagePerFight)}</td><td>${total ? ((100 * x.damagePerFight) / total).toFixed(1) : 0} %</td></tr>`)
      .join('');
    document.querySelector('#timeline')!.innerHTML = s.timeline
      .filter((x) => x.type === 'cast')
      .slice(0, 40)
      .map((x) => `<li><time>${x.t.toFixed(2)} s</time> ${label(x.key)}</li>`)
      .join('');
    document.querySelector<HTMLElement>('#result')!.hidden = false;
  } catch (err) {
    status.textContent = `Fehler: ${err instanceof Error ? err.message : err}`;
  } finally {
    button.disabled = false;
  }
});

field<HTMLSelectElement>('class').innerHTML = CLASSES.map((c) => `<option value="${c.key}">${c.name}</option>`).join('');
field<HTMLSelectElement>('fight').addEventListener('change', syncFightFields);
field<HTMLSelectElement>('class').addEventListener('change', () => void loadClass());
fetch(new URL('sim/names.json', new URL(import.meta.env.BASE_URL, document.baseURI))).then((r) => r.json()).then((n) => (names = n)).catch(() => {});
loadClass().catch((err) => (status.textContent = `Sim-Daten fehlen: ${err.message}`));
