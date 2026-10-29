import type { ClassModule } from '../classes/types';
import { live } from '../sim/client';
import type { CastBlock, LiveSpell, LiveState } from '../sim/live';
import { parseTimeline } from '../sim/result';
import type { FightSpec, SimProfile, TimelineEvent } from '../sim/types';
import { escapeHtml, iconUrl, label } from './names';

// The fight screen: bosses at the top, you in the middle, your action bar at the bottom. The engine runs the fight;
// this screen moves its clock along with the real one, sends your button presses and shows what it reports.

export interface FightSetup {
  cls: ClassModule;
  profile: SimProfile;
  targets: number;
  fight: FightSpec;
  /** Seconds before the pull: spells cast then land at the pull at the earliest. */
  countdown: number;
}

export interface FightLog {
  setup: FightSetup;
  /** How long the fight lasted (from the pull). */
  duration: number;
  timeline: TimelineEvent[];
  /** You ended it before the time ran out or the bosses died. */
  abandoned: boolean;
}

const HOTKEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '-', '=', 'q', 'e', 'r', 't'];
// A press this close to the end of a cast or the global cooldown is kept and cast as soon as possible, as in game.
const QUEUE_WINDOW = 0.4;

const BLOCK_TEXT: Record<CastBlock, string> = {
  casting: 'Noch am Casten',
  gcd: 'Globaler Cooldown',
  cooldown: 'Noch nicht bereit',
  mana: 'Nicht genug Mana',
  cannot: 'Geht gerade nicht',
};

interface Button { key: string; short: string; spell: LiveSpell; hotkey: string; el: HTMLButtonElement }

export function runFight(root: HTMLElement, setup: FightSetup): Promise<FightLog> {
  return new Promise((resolve, reject) => {
    live.start(setup.profile, setup.targets, setup.fight, setup.countdown).then((start) => {
      new FightScreen(root, setup, start.spells, start.state, resolve);
    }, reject);
  });
}

class FightScreen {
  private state: LiveState;
  private stateAt = 0; // performance.now() when state arrived
  private startedAt = performance.now();
  private buttons: Button[] = [];
  private target = 0;
  private events: TimelineEvent[] = [];
  private damageBy: number[];
  private busy = false; // a request to the engine is on its way
  private queued: Button | null = null;
  private done = false;
  private frame = 0;
  private flashTimer = 0;
  private channelEnds = 0;
  private channelLength = 1;
  private playerName: string;
  private el: Record<string, HTMLElement> = {};

  constructor(
    private root: HTMLElement,
    private setup: FightSetup,
    spells: LiveSpell[],
    state: LiveState,
    private finish: (log: FightLog) => void,
  ) {
    this.state = state;
    this.stateAt = performance.now();
    this.damageBy = Array(setup.targets).fill(0);
    this.playerName = String(setup.profile.player.name ?? 'Player');
    this.render(spells);
    this.onKey = this.onKey.bind(this);
    window.addEventListener('keydown', this.onKey);
    this.frame = requestAnimationFrame(() => this.tick());
  }

  /** The fight's time now, in seconds from the pull. */
  private now(): number {
    return -this.setup.countdown + (performance.now() - this.startedAt) / 1000;
  }

  private render(spells: LiveSpell[]) {
    const { cls, targets } = this.setup;
    this.root.innerHTML = `
      <div class="fight">
        <header class="fight-top">
          <span class="clock" data-el="clock"></span>
          <span class="meter" data-el="meter"></span>
          <button class="quit" data-el="quit" type="button">Beenden</button>
        </header>
        <section class="bosses" style="--n:${targets}">
          ${Array.from({ length: targets }, (_, i) => `
            <button class="boss" type="button" data-boss="${i}">
              <span class="boss-name">Boss ${i + 1}</span>
              <span class="bar boss-bar"><span data-el="bossFill${i}"></span><em data-el="bossText${i}"></em></span>
              <span class="auras" data-el="bossAuras${i}"></span>
            </button>`).join('')}
        </section>
        <section class="me">
          <div class="countdown" data-el="countdown"></div>
          <div class="auras player-auras" data-el="playerAuras"></div>
          <div class="bar cast-bar" data-el="castBar"><span data-el="castFill"></span><em data-el="castText"></em></div>
          <div class="bar mana-bar"><span data-el="manaFill"></span><em data-el="manaText"></em></div>
          <div class="flash" data-el="flash" aria-live="polite"></div>
        </section>
        <nav class="action-bar" data-el="bar"></nav>
      </div>`;
    this.root.querySelectorAll<HTMLElement>('[data-el]').forEach((el) => (this.el[el.dataset.el!] = el));

    let hotkey = 0;
    for (const b of cls.bar) {
      const spell = spells.find((s) => s.key === b.key);
      if (!spell) continue;
      const el = document.createElement('button');
      el.type = 'button';
      el.className = 'action';
      const icon = iconUrl(b.key);
      const key = HOTKEYS[hotkey++] ?? '';
      el.innerHTML = `${icon ? `<img src="${icon}" alt="" onerror="this.remove()">` : ''}<span class="short">${escapeHtml(b.short)}</span><span class="hotkey">${key.toUpperCase()}</span><span class="cd"></span>`;
      el.title = label(b.key);
      el.setAttribute('aria-label', label(b.key));
      const button: Button = { key: b.key, short: b.short, spell, hotkey: key, el };
      el.addEventListener('pointerdown', (e) => { e.preventDefault(); this.press(button); });
      el.addEventListener('click', (e) => { if (e.detail === 0) this.press(button); }); // keyboard "click"
      this.el.bar.appendChild(el);
      this.buttons.push(button);
    }
    this.root.querySelectorAll<HTMLElement>('[data-boss]').forEach((el) =>
      el.addEventListener('pointerdown', (e) => { e.preventDefault(); this.target = Number(el.dataset.boss); }));
    this.el.quit.addEventListener('click', () => this.end(true));
  }

  private onKey(e: KeyboardEvent) {
    if (e.repeat && e.key !== 'Tab') return;
    if (e.key === 'Tab') {
      e.preventDefault();
      this.target = (this.target + 1) % this.setup.targets;
      return;
    }
    if (/^F[1-3]$/.test(e.key)) {
      e.preventDefault();
      this.target = Math.min(this.setup.targets - 1, Number(e.key[1]) - 1);
      return;
    }
    const b = this.buttons.find((x) => x.hotkey === e.key.toLowerCase());
    if (b) { e.preventDefault(); this.press(b); }
  }

  /** Brings the engine up to now, then runs then(). Requests go one at a time. */
  private async sync(then?: () => Promise<void>) {
    if (this.busy || this.done) return;
    this.busy = true;
    try {
      const step = await live.advance(Math.max(this.state.time, this.now()));
      this.apply(step.logs, step.state);
      if (step.finished) { this.end(false); return; }
      if (then) await then();
      await this.castQueued();
    } catch (err) {
      this.showFlash(err instanceof Error ? err.message : String(err));
    } finally {
      this.busy = false;
    }
  }

  private apply(logs: string, state: LiveState) {
    this.state = state;
    this.stateAt = performance.now();
    if (!logs) return;
    for (const e of parseTimeline(logs, this.playerName)) {
      this.events.push(e);
      if (e.type === 'damage') {
        this.damageBy[e.target] = (this.damageBy[e.target] ?? 0) + e.amount;
        if (e.amount > 0) this.floatNumber(e.target, e.amount, e.crit);
      }
    }
  }

  private press(b: Button) {
    if (this.done) return;
    b.el.classList.add('pressed');
    setTimeout(() => b.el.classList.remove('pressed'), 120);
    if (this.busy) { this.queued = b; return; }
    void this.sync(() => this.cast(b));
  }

  private async cast(b: Button) {
    const r = await live.cast(b.spell.index, this.target);
    this.apply(r.logs, r.state);
    if (r.ok) { this.queued = null; return; }
    if ((r.reason === 'gcd' || r.reason === 'casting') && this.waitFor() <= QUEUE_WINDOW) this.queued = b;
    else this.showFlash(BLOCK_TEXT[r.reason || 'cannot']);
  }

  /** Seconds until the global cooldown and any cast are over. */
  private waitFor(): number {
    const s = this.state;
    return Math.max(s.gcd, s.cast ? s.cast.ends - s.time : 0);
  }

  private async castQueued() {
    const b = this.queued;
    if (!b || this.waitFor() > 0) return;
    this.queued = null;
    await this.cast(b);
  }

  private tick() {
    if (this.done) return;
    const t = this.now();
    if (!this.busy && (t > this.state.time + 0.03 || this.queued)) void this.sync();
    this.draw(t);
    this.frame = requestAnimationFrame(() => this.tick());
  }

  private draw(t: number) {
    const s = this.state;
    const since = (performance.now() - this.stateAt) / 1000; // how far the screen is ahead of the last state
    const { fight, cls } = this.setup;

    // Clock and meter
    if (t < 0) {
      this.el.countdown.textContent = String(Math.ceil(-t));
      this.el.clock.textContent = 'Pull in ' + (-t).toFixed(1) + ' s';
    } else {
      this.el.countdown.textContent = '';
      const left = fight.kind === 'time' ? `${fmtTime(Math.max(0, fight.seconds - t))} übrig` : fmtTime(t);
      this.el.clock.textContent = left;
    }
    const damage = this.damageBy.reduce((a, b) => a + b, 0);
    this.el.meter.textContent = `${Math.round(damage / Math.max(1, t)).toLocaleString('de-DE')} DPS`;

    // Bosses
    for (let i = 0; i < this.setup.targets; i++) {
      const fill = this.el['bossFill' + i], text = this.el['bossText' + i];
      if (fight.kind === 'health') {
        const left = Math.max(0, fight.healthPerTarget - this.damageBy[i]);
        fill.style.width = `${(100 * left) / fight.healthPerTarget}%`;
        text.textContent = `${Math.round(left / 1000).toLocaleString('de-DE')}k`;
      } else {
        fill.style.width = `${100 * Math.max(0, 1 - Math.max(0, t) / fight.seconds)}%`;
        text.textContent = `${Math.round(this.damageBy[i]).toLocaleString('de-DE')}`;
      }
      this.root.querySelector(`[data-boss="${i}"]`)!.classList.toggle('targeted', i === this.target);
      this.el['bossAuras' + i].innerHTML = auraIcons(cls.targetAuras, s.targets[i]?.auras ?? [], since);
    }

    // You
    this.el.playerAuras.innerHTML = auraIcons(cls.playerAuras, s.auras, since);
    this.el.manaFill.style.width = `${(100 * s.mana) / Math.max(1, s.maxMana)}%`;
    this.el.manaText.textContent = `${Math.round(s.mana).toLocaleString('de-DE')} / ${Math.round(s.maxMana).toLocaleString('de-DE')}`;
    const bar = this.el.castBar;
    const simNow = s.time + since;
    if (s.cast) {
      const sp = this.buttons.find((b) => b.key === s.cast!.key)?.spell;
      const total = sp?.castTime || 1.5;
      bar.className = 'bar cast-bar casting';
      this.el.castFill.style.width = `${100 * clamp(1 - (s.cast.ends - simNow) / total)}%`;
      this.el.castText.textContent = label(s.cast.key);
    } else if (s.channel) {
      if (this.channelEnds !== s.channel.ends) {
        this.channelEnds = s.channel.ends;
        this.channelLength = Math.max(0.1, s.channel.ends - s.time);
      }
      bar.className = 'bar cast-bar channeling';
      this.el.castFill.style.width = `${100 * clamp((s.channel.ends - simNow) / this.channelLength)}%`;
      this.el.castText.textContent = `${label(s.channel.key)} (${s.channel.ticks})`;
    } else {
      bar.className = 'bar cast-bar';
      this.el.castText.textContent = '';
    }

    // Action bar: cooldowns, the global cooldown and mana
    const gcdLeft = Math.max(0, s.gcd - since);
    for (const b of this.buttons) {
      const cd = Math.max(0, s.cooldowns[b.spell.index] - since);
      const wait = Math.max(cd, b.spell.gcd > 0 ? gcdLeft : 0);
      const cdEl = b.el.querySelector<HTMLElement>('.cd')!;
      const span = cd > gcdLeft ? Math.max(cd, b.spell.cooldown) : 1.5;
      cdEl.style.setProperty('--p', String(wait > 0 ? clamp(wait / span) : 0));
      cdEl.textContent = cd > 1.5 ? (cd >= 60 ? `${Math.ceil(cd / 60)}m` : Math.ceil(cd).toString()) : '';
      b.el.classList.toggle('no-mana', s.costs[b.spell.index] > s.mana);
      b.el.classList.toggle('queued', this.queued === b);
    }
  }

  private floatNumber(target: number, amount: number, crit: boolean) {
    const boss = this.root.querySelector(`[data-boss="${target}"]`);
    if (!boss) return;
    const n = document.createElement('span');
    n.className = 'float' + (crit ? ' crit' : '');
    n.textContent = Math.round(amount).toLocaleString('de-DE');
    n.style.left = `${20 + Math.random() * 60}%`;
    boss.appendChild(n);
    setTimeout(() => n.remove(), 900);
  }

  private showFlash(text: string) {
    this.el.flash.textContent = text;
    clearTimeout(this.flashTimer);
    this.flashTimer = window.setTimeout(() => (this.el.flash.textContent = ''), 900);
  }

  private end(abandoned: boolean) {
    if (this.done) return;
    this.done = true;
    cancelAnimationFrame(this.frame);
    window.removeEventListener('keydown', this.onKey);
    const duration = Math.max(0.1, abandoned ? this.now() : this.state.time);
    this.finish({ setup: this.setup, duration, timeline: this.events, abandoned });
  }
}

function auraIcons(show: string[], auras: LiveState['auras'], since: number): string {
  return show
    .map((key) => {
      const a = auras.find((x) => x.key === key);
      if (!a) return '';
      const left = a.remaining < 0 ? '' : Math.max(0, a.remaining - since);
      const icon = iconUrl(key);
      const low = left !== '' && left < 3 ? ' low' : '';
      return `<span class="aura${low}" title="${escapeHtml(label(key))}">${icon ? `<img src="${icon}" alt="" onerror="this.remove()">` : ''}${a.stacks > 1 ? `<b>${a.stacks}</b>` : ''}<i>${left === '' ? '' : left < 10 ? left.toFixed(1) : Math.round(left)}</i></span>`;
    })
    .join('');
}

const clamp = (x: number) => Math.max(0, Math.min(1, x));
const fmtTime = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
