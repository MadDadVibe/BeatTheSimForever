import './style.css';
import { CLASSES } from './classes';
import type { ClassModule } from './classes/types';
import { runFight, type FightSetup } from './game/fight';
import { loadNames } from './game/names';
import { showResults } from './game/results';
import { rotationFromExport } from './sim/apl';
import { loadEngine, loadProfiles } from './sim/client';
import type { AplRotation, FightSpec, SimProfile } from './sim/types';

// The setup screen, and the way from it into a fight and on to its results.
const app = document.querySelector<HTMLElement>('#app')!;
const setupView = document.querySelector<HTMLElement>('#setup-view')!;
const stage = document.querySelector<HTMLElement>('#stage')!;
const form = document.querySelector<HTMLFormElement>('#setup')!;
const status = document.querySelector<HTMLElement>('#status')!;
const field = <T extends HTMLElement>(name: string) => form.elements.namedItem(name) as unknown as T;

let profiles: Record<string, SimProfile> = {};
let customRotation: AplRotation | null = null;
let engineReady = false;

const currentClass = (): ClassModule => CLASSES.find((c) => c.key === field<HTMLSelectElement>('class').value)!;
const raceName = (key: string) => key.split('_').map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');

async function loadClass() {
  const cls = currentClass();
  profiles = await loadProfiles(cls.key);
  const race = field<HTMLSelectElement>('race');
  race.innerHTML = Object.keys(profiles).map((r) => `<option value="${r}">${raceName(r)}</option>`).join('');
  race.value = cls.defaultRace in profiles ? cls.defaultRace : Object.keys(profiles)[0];
}

function syncFightFields() {
  const kind = field<HTMLSelectElement>('fight').value;
  form.querySelectorAll<HTMLElement>('[data-for]').forEach((el) => (el.hidden = el.dataset.for !== kind));
}

function readSetup(): FightSetup {
  const fight: FightSpec = field<HTMLSelectElement>('fight').value === 'time'
    ? { kind: 'time', seconds: Number(field<HTMLInputElement>('seconds').value) }
    : { kind: 'health', healthPerTarget: Number(field<HTMLInputElement>('health').value) };
  return {
    cls: currentClass(),
    profile: profiles[field<HTMLSelectElement>('race').value],
    targets: Number(field<HTMLSelectElement>('targets').value),
    fight,
    countdown: 5,
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
    await showResults(stage, log, customRotation ?? setup.cls.defaultRotation, () => void play(setup), showSetup);
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

field<HTMLInputElement>('rotation').addEventListener('change', async () => {
  const file = field<HTMLInputElement>('rotation').files?.[0];
  try {
    customRotation = file ? rotationFromExport(JSON.parse(await file.text())) : null;
    status.textContent = file ? `Eigene Rota geladen: ${file.name}` : '';
  } catch (err) {
    customRotation = null;
    status.textContent = `Rota nicht lesbar: ${err instanceof Error ? err.message : err}`;
  }
});

field<HTMLSelectElement>('class').innerHTML = CLASSES.map((c) => `<option value="${c.key}">${c.name}</option>`).join('');
field<HTMLSelectElement>('fight').addEventListener('change', syncFightFields);
field<HTMLSelectElement>('class').addEventListener('change', () => void loadClass());

const start = form.querySelector<HTMLButtonElement>('button[type=submit]')!;
start.disabled = true;
start.textContent = 'Lade die Engine …';
Promise.all([loadClass(), loadNames(), loadEngine()])
  .then(() => {
    engineReady = true;
    start.disabled = false;
    start.textContent = 'Fight starten';
  })
  .catch((err) => (status.textContent = `Laden fehlgeschlagen: ${err.message}`));
