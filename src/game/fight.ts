import type { ClassModule } from '../classes/types';
import { live } from '../sim/client';
import type { CastBlock, LiveSpell, LiveState } from '../sim/live';
import { parseTimeline } from '../sim/result';
import type { AplRotation, FightSpec, SimProfile, TimelineEvent } from '../sim/types';
import { bindable, bindKey, keyLabel, loadLayout, saveLayout, swapSlots, type BarSlot } from './layout';
import { escapeHtml, iconUrl, label } from './names';
import { fillSheet, sheetSkeleton } from './sheet';

// The fight screen: bosses at the top, you in the middle, your action bar at the bottom. The engine runs the fight;
// this screen moves its clock along with the real one, sends your button presses and shows what it reports.
// Before the fight it is a preparation screen: your character sheet, and an action bar you can rearrange (drag a
// spell onto another to swap them) and rebind (point at a spell and press a key). The countdown starts when you are
// ready (space bar or the button).

export interface FightSetup {
  cls: ClassModule;
  profile: SimProfile;
  targets: number;
  fight: FightSpec;
  /** Seconds before the pull: spells cast then land at the pull at the earliest. */
  countdown: number;
  /** The sim's rotation: it answers which spell it would cast next (the hint), and gives the pre-pull casts. */
  rotation: AplRotation;
  /** Show that hint on the action bar. */
  hints: boolean;
}

export interface FightLog {
  setup: FightSetup;
  /** How long the fight lasted (from the pull). */
  duration: number;
  timeline: TimelineEvent[];
  /** You ended it before the time ran out or the bosses died. */
  abandoned: boolean;
}

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

type Phase = 'prep' | 'fight';

export function runFight(root: HTMLElement, setup: FightSetup): Promise<FightLog> {
  return new Promise((resolve, reject) => {
    live.start(setup.profile, setup.targets, setup.fight, setup.countdown, setup.rotation).then((start) => {
      new FightScreen(root, setup, start.spells, start.state, resolve);
    }, reject);
  });
}

/** The rotation's pre-pull casts with a fixed time, e.g. Mind Blast 1.5 s before the pull. */
function prepullCasts(rotation: AplRotation): Array<{ key: string; at: number }> {
  const list = (rotation.prepullActions as Array<{ action?: { castSpell?: { spellId?: { spellId?: number } } }; doAtValue?: { const?: { val?: string } } }> | undefined) ?? [];
  return list.flatMap((p) => {
    const id = p.action?.castSpell?.spellId?.spellId;
    const m = p.doAtValue?.const?.val?.match(/^(-?[\d.]+)(ms|s)$/);
    return id && m ? [{ key: `spell:${id}`, at: Number(m[1]) / (m[2] === 'ms' ? 1000 : 1) }] : [];
  });
}

class FightScreen {
  private state: LiveState;
  private stateAt = 0; // performance.now() when state arrived
  private startedAt = 0;
  private phase: Phase = 'prep';
  private spells: LiveSpell[];
  private slots: BarSlot[];
  private buttons: Button[] = [];
  private pointed: number | null = null; // the bar slot under the mouse (or last tapped) while preparing
  private drag: { from: number; x: number; y: number; ghost: HTMLElement | null } | null = null;
  private hints: boolean;
  private prepull: Array<{ key: string; at: number }>;
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
  private wakeLock: WakeLockSentinel | null = null;
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
    this.spells = spells;
    this.slots = loadLayout(setup.cls, new Set(spells.map((s) => s.key)));
    this.hints = setup.hints;
    this.prepull = prepullCasts(setup.rotation);
    this.render();
    this.onKey = this.onKey.bind(this);
    window.addEventListener('keydown', this.onKey);
    this.frame = requestAnimationFrame(() => this.tick());
  }

  /** The fight's time now, in seconds from the pull. */
  private now(): number {
    if (this.phase === 'prep') return -this.setup.countdown;
    return -this.setup.countdown + (performance.now() - this.startedAt) / 1000;
  }

  private render() {
    const { cls, targets, profile } = this.setup;
    this.root.innerHTML = `
      <div class="fight prepping" data-el="fight">
        <header class="fight-top">
          <span class="clock" data-el="clock"></span>
          <span class="meter" data-el="meter"></span>
          <button class="toggle" data-el="hintToggle" type="button" aria-pressed="${this.hints}" title="Zeigt, welchen Spell der Sim als Nächstes wirken würde">Tipp</button>
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
        <section class="prep" data-el="prep">
          <div class="sheet" data-el="sheet">${sheetSkeleton(cls, profile)}</div>
          <p class="muted small prep-help">Aktionsleiste anpassen: Spell auf einen anderen ziehen tauscht die beiden. Mit der Maus
            auf einen Spell zeigen (am Handy antippen) und eine Taste drücken legt die Taste neu fest; Rücktaste entfernt sie.</p>
          <button class="ready" data-el="ready" type="button">Bereit <small>(Leertaste)</small></button>
        </section>
        <section class="focus">
          <span class="focus-name" data-el="focusName"></span>
          <div class="auras big" data-el="focusAuras"></div>
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
    void fillSheet(this.el.sheet, cls, profile);

    this.renderBar();
    this.root.querySelectorAll<HTMLElement>('[data-boss]').forEach((el) =>
      el.addEventListener('pointerdown', (e) => { e.preventDefault(); this.target = Number(el.dataset.boss); }));
    this.el.quit.addEventListener('click', () => this.end(true));
    this.el.ready.addEventListener('click', () => this.begin());
    this.el.hintToggle.addEventListener('click', () => {
      this.hints = !this.hints;
      this.el.hintToggle.setAttribute('aria-pressed', String(this.hints));
      try { localStorage.setItem('hints', this.hints ? '1' : '0'); } catch { /* not remembered */ }
    });
    window.addEventListener('pointermove', this.onDragMove);
    window.addEventListener('pointerup', this.onDragEnd);
    window.addEventListener('pointercancel', this.onDragEnd);
  }

  /** (Re)builds the action bar from the slots. */
  private renderBar() {
    this.el.bar.innerHTML = '';
    this.buttons = [];
    this.slots.forEach((slot, i) => {
      const spell = this.spells.find((s) => s.key === slot.key)!;
      const el = document.createElement('button');
      el.type = 'button';
      el.className = 'action';
      const icon = iconUrl(slot.key);
      el.innerHTML = `${icon ? `<img src="${icon}" alt="" onerror="this.remove()" draggable="false">` : ''}<span class="short">${escapeHtml(slot.short)}</span><span class="hotkey">${escapeHtml(keyLabel(slot.hotkey))}</span><span class="cd"></span>`;
      el.title = label(slot.key);
      el.setAttribute('aria-label', label(slot.key));
      el.dataset.slot = String(i);
      const button: Button = { key: slot.key, short: slot.short, spell, hotkey: slot.hotkey, el };
      el.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        if (this.phase === 'prep') this.dragStart(i, e);
        else this.press(button);
      });
      el.addEventListener('pointerenter', () => { if (this.phase === 'prep' && !this.drag) this.point(i); });
      el.addEventListener('pointerleave', () => { if (this.phase === 'prep' && !this.drag && this.pointed === i && matchMedia('(hover: hover)').matches) this.point(null); });
      el.addEventListener('click', (e) => { if (e.detail === 0 && this.phase === 'fight') this.press(button); }); // keyboard "click"
      el.classList.toggle('pointed', this.pointed === i);
      this.el.bar.appendChild(el);
      this.buttons.push(button);
    });
  }

  private point(i: number | null) {
    this.pointed = i;
    this.buttons.forEach((b, j) => b.el.classList.toggle('pointed', j === i));
  }

  // ---------- preparing: drag a spell onto another to swap them ----------

  private dragStart(i: number, e: PointerEvent) {
    this.drag = { from: i, x: e.clientX, y: e.clientY, ghost: null };
    this.point(i);
  }

  private onDragMove = (e: PointerEvent) => {
    const d = this.drag;
    if (!d) return;
    if (!d.ghost && Math.hypot(e.clientX - d.x, e.clientY - d.y) > 8) {
      d.ghost = this.buttons[d.from].el.cloneNode(true) as HTMLElement;
      d.ghost.classList.add('ghost');
      d.ghost.style.width = `${this.buttons[d.from].el.offsetWidth}px`;
      document.body.appendChild(d.ghost);
      this.buttons[d.from].el.classList.add('dragging');
    }
    if (d.ghost) {
      d.ghost.style.left = `${e.clientX}px`;
      d.ghost.style.top = `${e.clientY}px`;
      const over = this.slotAt(e.clientX, e.clientY);
      this.buttons.forEach((b, j) => b.el.classList.toggle('drop', j === over && j !== d.from));
    }
  };

  private onDragEnd = (e: PointerEvent) => {
    const d = this.drag;
    if (!d) return;
    this.drag = null;
    if (!d.ghost) return; // a tap: the spell stays pointed at, ready for a key
    d.ghost.remove();
    const to = this.slotAt(e.clientX, e.clientY);
    if (to !== null && to !== d.from) {
      this.slots = swapSlots(this.slots, d.from, to);
      saveLayout(this.setup.cls, this.slots);
      this.pointed = to;
    }
    this.renderBar();
  };

  private slotAt(x: number, y: number): number | null {
    const el = document.elementFromPoint(x, y)?.closest<HTMLElement>('.action:not(.ghost)');
    return el?.dataset.slot ? Number(el.dataset.slot) : null;
  }

  /** Ready: the countdown starts. */
  private begin() {
    if (this.phase !== 'prep') return;
    saveLayout(this.setup.cls, this.slots);
    this.phase = 'fight';
    this.point(null);
    this.el.fight.classList.remove('prepping');
    this.startedAt = performance.now();
    // Keep the screen on during the fight.
    navigator.wakeLock?.request('screen').then((l) => (this.wakeLock = l), () => {});
  }

  private onKey(e: KeyboardEvent) {
    if (this.phase === 'prep') {
      if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        this.begin();
        return;
      }
      if (this.pointed === null || e.repeat) return;
      if (e.key === 'Backspace' || e.key === 'Delete') {
        e.preventDefault();
        this.slots = this.slots.map((s, j) => (j === this.pointed ? { ...s, hotkey: '' } : s));
      } else if (bindable(e.key)) {
        e.preventDefault();
        this.slots = bindKey(this.slots, this.pointed, e.key);
      } else return;
      saveLayout(this.setup.cls, this.slots);
      this.renderBar();
      return;
    }
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
    const b = this.buttons.find((x) => x.hotkey && x.hotkey === e.key.toLowerCase());
    if (b) { e.preventDefault(); this.press(b); }
  }

  /** Brings the engine up to now, then runs then(). Requests go one at a time. */
  private async sync(then?: () => Promise<void>) {
    if (this.busy || this.done) return;
    this.busy = true;
    try {
      const step = await live.advance(Math.max(this.state.time, this.now()), this.target);
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
    if (this.phase === 'fight' && !this.busy && (t > this.state.time + 0.03 || this.queued)) void this.sync();
    this.draw(t);
    this.frame = requestAnimationFrame(() => this.tick());
  }

  private draw(t: number) {
    const s = this.state;
    const since = (performance.now() - this.stateAt) / 1000; // how far the screen is ahead of the last state
    const { fight, cls } = this.setup;

    // Clock and meter
    if (this.phase === 'prep') {
      this.el.clock.textContent = 'Vorbereitung';
    } else if (t < 0) {
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

    // The boss you aim at, large
    this.el.focusName.textContent = this.setup.targets > 1 ? `Ziel: Boss ${this.target + 1}` : '';
    this.el.focusAuras.innerHTML = auraIcons(cls.targetAuras, s.targets[this.target]?.auras ?? [], since, true);

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

    // Action bar: cooldowns, the global cooldown, mana and the hint
    const gcdLeft = Math.max(0, s.gcd - since);
    const hint = this.hintNow(t);
    for (const b of this.buttons) {
      const cd = Math.max(0, s.cooldowns[b.spell.index] - since);
      const wait = Math.max(cd, b.spell.gcd > 0 ? gcdLeft : 0);
      const cdEl = b.el.querySelector<HTMLElement>('.cd')!;
      const span = cd > gcdLeft ? Math.max(cd, b.spell.cooldown) : 1.5;
      cdEl.style.setProperty('--p', String(wait > 0 ? clamp(wait / span) : 0));
      cdEl.textContent = cd > 1.5 ? (cd >= 60 ? `${Math.ceil(cd / 60)}m` : Math.ceil(cd).toString()) : '';
      b.el.classList.toggle('no-mana', s.costs[b.spell.index] > s.mana);
      b.el.classList.toggle('queued', this.queued === b);
      b.el.classList.toggle('hint', this.hints && b.key === hint);
    }
  }

  /** The spell the sim would cast next: its pre-pull casts during the countdown, then what the engine says. */
  private hintNow(t: number): string | undefined {
    if (this.phase !== 'fight') return undefined;
    if (t < 0) {
      const done = new Set(this.events.filter((e) => e.type === 'cast').map((e) => (e as { key: string }).key));
      return this.prepull.find((p) => !done.has(p.key) && t >= p.at - 1.5)?.key;
    }
    return this.state.hint;
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
    window.removeEventListener('pointermove', this.onDragMove);
    window.removeEventListener('pointerup', this.onDragEnd);
    window.removeEventListener('pointercancel', this.onDragEnd);
    void this.wakeLock?.release().catch(() => {});
    const duration = Math.max(0.1, abandoned ? this.now() : this.state.time);
    this.finish({ setup: this.setup, duration, timeline: this.events, abandoned });
  }
}

/** The effects in show that are up, as icons with the time left. withMissing: also show those that are not up, dimmed. */
function auraIcons(show: string[], auras: LiveState['auras'], since: number, withMissing = false): string {
  return show
    .map((key) => {
      const a = auras.find((x) => x.key === key);
      if (!a) {
        const url = withMissing ? iconUrl(key) : null;
        return url ? `<span class="aura missing" title="${escapeHtml(label(key))}"><img src="${url}" alt="" onerror="this.remove()"></span>` : '';
      }
      const left = a.remaining < 0 ? '' : Math.max(0, a.remaining - since);
      const icon = iconUrl(key);
      const low = left !== '' && left < 3 ? ' low' : '';
      return `<span class="aura${low}" title="${escapeHtml(label(key))}">${icon ? `<img src="${icon}" alt="" onerror="this.remove()">` : ''}${a.stacks > 1 ? `<b>${a.stacks}</b>` : ''}<i>${left === '' ? '' : left < 10 ? left.toFixed(1) : Math.round(left)}</i></span>`;
    })
    .join('');
}

const clamp = (x: number) => Math.max(0, Math.min(1, x));
const fmtTime = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
