import './style.css';
import { CLASSES, SPECS } from './classes';
import type { SpecModule } from './classes/types';
import { runFight, type FightSetup } from './game/fight';
import { iconUrl, loadNames } from './game/names';
import { showResults } from './game/results';
import { loadEngine, loadProfiles, simFile } from './sim/client';
import { CONSUMABLES, withOptions } from './sim/options';
import type { FightSpec, SimProfile } from './sim/types';

// The setup screen, and the way from it into a fight and on to its results.
const app = document.querySelector<HTMLElement>('#app')!;
const setupView = document.querySelector<HTMLElement>('#setup-view')!;
const stage = document.querySelector<HTMLElement>('#stage')!;
const form = document.querySelector<HTMLFormElement>('#setup')!;
const status = document.querySelector<HTMLElement>('#status')!;
const field = <T extends HTMLElement>(name: string) => form.elements.namedItem(name) as unknown as T;

let profiles: Record<string, SimProfile> = {};
let engineReady = false;

const currentClass = () => CLASSES.find((c) => c.key === field<HTMLSelectElement>('class').value)!;
const currentSpec = (): SpecModule => SPECS.find((s) => s.key === field<HTMLSelectElement>('spec').value)!;
const raceName = (key: string) => key.split('_').map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');

/** The spec picked last time, remembered in this browser. */
function remember(key: string, value?: string): string | null {
  try {
    if (value !== undefined) localStorage.setItem(key, value);
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function fillSpecs(pick?: string) {
  const specs = currentClass().specs;
  const select = field<HTMLSelectElement>('spec');
  select.innerHTML = specs.map((s) => `<option value="${s.key}">${s.name}</option>`).join('');
  select.value = specs.some((s) => s.key === pick) ? pick! : specs[0].key;
}

async function loadSpec() {
  const spec = currentSpec();
  remember('spec', spec.key);
  const race = field<HTMLSelectElement>('race');
  const before = race.value;
  profiles = await loadProfiles(spec.key);
  if (currentSpec() !== spec) return; // another spec was picked meanwhile
  race.innerHTML = Object.keys(profiles).map((r) => `<option value="${r}">${raceName(r)}</option>`).join('');
  race.value = before in profiles ? before : spec.defaultRace in profiles ? spec.defaultRace : Object.keys(profiles)[0];
  // A spec that picks its weapon imbue (an enhancement shaman) offers the choice, starting from the sim's.
  const enh = Object.values(profiles)[0]?.player.enhancementShaman as { options?: { mainHandImbue?: string } } | undefined;
  form.querySelector<HTMLElement>('[data-imbue]')!.hidden = !enh;
  if (enh) field<HTMLSelectElement>('imbue').value = remember('imbue') ?? enh.options?.mainHandImbue ?? 'WindfuryImbue';
}

function syncFightFields() {
  const kind = field<HTMLSelectElement>('fight').value;
  form.querySelectorAll<HTMLElement>('[data-for]').forEach((el) => (el.hidden = el.dataset.for !== kind));
}

/** The setup's switches that change the profile, each on unless switched off. */
const SWITCHES = [...Object.keys(CONSUMABLES), 'raidBuffs', 'raidDebuffs'] as const;
const on = (name: string) => field<HTMLInputElement>(name).checked;

function readSetup(): FightSetup {
  const fight: FightSpec = field<HTMLSelectElement>('fight').value === 'time'
    ? { kind: 'time', seconds: Number(field<HTMLInputElement>('seconds').value) }
    : { kind: 'health', healthPerTarget: Number(field<HTMLInputElement>('health').value) };
  const profile = withOptions(profiles[field<HTMLSelectElement>('race').value], {
    potions: on('potions'),
    conjured: on('conjured'),
    explosives: on('explosives'),
    raidBuffs: on('raidBuffs'),
    raidDebuffs: on('raidDebuffs'),
    imbue: field<HTMLSelectElement>('imbue').value,
  });
  return {
    spec: currentSpec(),
    profile,
    targets: Number(field<HTMLSelectElement>('targets').value),
    fight,
    countdown: 5,
    rotation: currentSpec().defaultRotation ?? profile.player.rotation!,
    hints: field<HTMLInputElement>('hints').checked,
  };
}

function showSetup() {
  stage.hidden = true;
  stage.innerHTML = '';
  setupView.hidden = false;
  app.classList.remove('in-fight');
}

async function play(setup: FightSetup) {
  setupView.hidden = true;
  stage.hidden = false;
  app.classList.add('in-fight');
  stage.innerHTML = '<p class="loading">Lade …</p>';
  try {
    const log = await runFight(stage, setup);
    app.classList.remove('in-fight');
    // The hint may have been switched in the fight; the next one starts the same way.
    const again = { ...setup, hints: readHints() };
    await showResults(stage, log, setup.rotation, () => void play(again), showSetup);
  } catch (err) {
    showSetup();
    status.textContent = `Fehler: ${err instanceof Error ? err.message : err}`;
  }
}

form.addEventListener('submit', (e) => {
  e.preventDefault();
  if (!engineReady) return;
  void play(readSetup());
});

function readHints(): boolean {
  try {
    return localStorage.getItem('hints') === '1';
  } catch {
    return false;
  }
}
field<HTMLInputElement>('hints').checked = readHints();
for (const name of SWITCHES) {
  const box = field<HTMLInputElement>(name);
  try {
    box.checked = localStorage.getItem(name) !== '0';
  } catch { /* on */ }
  box.addEventListener('change', () => {
    try { localStorage.setItem(name, box.checked ? '1' : '0'); } catch { /* not remembered */ }
  });
}
field<HTMLSelectElement>('imbue').addEventListener('change', () => remember('imbue', field<HTMLSelectElement>('imbue').value));
field<HTMLInputElement>('hints').addEventListener('change', () => {
  try { localStorage.setItem('hints', field<HTMLInputElement>('hints').checked ? '1' : '0'); } catch { /* not remembered */ }
});

const lastSpec = SPECS.find((s) => s.key === remember('spec')) ?? SPECS.find((s) => s.key === 'shadow-priest')!;
field<HTMLSelectElement>('class').innerHTML = CLASSES.map((c) => `<option value="${c.key}">${c.name}</option>`).join('');
field<HTMLSelectElement>('class').value = CLASSES.find((c) => c.specs.includes(lastSpec))!.key;
fillSpecs(lastSpec.key);
field<HTMLSelectElement>('fight').addEventListener('change', syncFightFields);
field<HTMLSelectElement>('class').addEventListener('change', () => { fillSpecs(); void loadSpec(); });
field<HTMLSelectElement>('spec').addEventListener('change', () => void loadSpec());

const start = form.querySelector<HTMLButtonElement>('button[type=submit]')!;
start.disabled = true;
start.textContent = 'Lade die Engine …';
Promise.all([loadSpec(), loadNames(), loadEngine()])
  .then(() => {
    engineReady = true;
    start.disabled = false;
    start.textContent = 'Fight starten';
  })
  .catch((err) => (status.textContent = `Laden fehlgeschlagen: ${err.message}`));

// Offline play and "add to home screen".
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
  // On the first visit the page loaded before the offline cache existed: hand it what the game needs.
  navigator.serviceWorker.ready.then((reg) => {
    const loaded = performance.getEntriesByType('resource').map((e) => e.name);
    const engine = ['lib.wasm', 'wasm_exec.js', 'names.json', ...SPECS.map((s) => `presets/${s.key}.json`)].map(simFile);
    const icons = [...new Set(SPECS.flatMap((s) => [...s.bar.map((b) => b.key), ...s.targetAuras, ...s.playerAuras]))].map(iconUrl).filter((u): u is string => !!u);
    reg.active?.postMessage({ cache: [location.href.split('#')[0], ...loaded, ...engine, ...icons] });
  });
}
if (!window.matchMedia('(display-mode: standalone)').matches && matchMedia('(pointer: coarse)').matches) {
  document.querySelector<HTMLElement>('.install')!.hidden = false;
}
