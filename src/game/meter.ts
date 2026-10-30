import { escapeHtml, iconUrl, label } from './names';

// The damage meter during the fight: how much each spell has done so far, largest first, as in the game's own
// meters. Pets' spells are their own lines.

export class DamageMeter {
  private bySpell = new Map<string, { damage: number; hits: number; crits: number }>();
  private total = 0;

  add(key: string, amount: number, crit: boolean) {
    const row = this.bySpell.get(key) ?? { damage: 0, hits: 0, crits: 0 };
    row.damage += amount;
    row.hits++;
    if (crit) row.crits++;
    this.bySpell.set(key, row);
    this.total += amount;
  }

  private rows = new Map<string, HTMLLIElement>();

  /**
   * Draws the meter after seconds of fighting into list. Each spell keeps its line (made once, then only updated and
   * moved), so its icon is not loaded again on every update; an icon that does not load leaves an empty square of
   * the same size, so the line does not jump.
   */
  render(list: HTMLElement, seconds: number) {
    if (!this.total) {
      list.innerHTML = '<p class="muted small">Noch kein Schaden.</p>';
      this.rows.clear();
      return;
    }
    let ol = list.querySelector<HTMLOListElement>('ol.dmg');
    if (!ol) {
      list.innerHTML = '<ol class="dmg"></ol>';
      ol = list.querySelector<HTMLOListElement>('ol.dmg')!;
    }
    const sorted = [...this.bySpell.entries()].sort((a, b) => b[1].damage - a[1].damage);
    const top = sorted[0][1].damage;
    const nf = (x: number) => Math.round(x).toLocaleString('de-DE');
    const t = Math.max(1, seconds);
    for (const [key, r] of sorted) {
      let li = this.rows.get(key);
      if (!li) {
        li = document.createElement('li');
        const url = iconUrl(key);
        li.innerHTML = `<span class="ic">${url ? `<img src="${url}" alt="" onerror="this.remove()">` : ''}</span><span class="dmg-name">${escapeHtml(label(key))}</span><span class="dmg-num"></span>`;
        this.rows.set(key, li);
      }
      li.style.setProperty('--w', `${((100 * r.damage) / top).toFixed(1)}%`);
      li.title = `${label(key)}: ${r.hits} Treffer, ${r.crits} Crits`;
      li.querySelector('.dmg-num')!.innerHTML = `${nf(r.damage)} <small>(${nf(r.damage / t)}, ${Math.round((100 * r.damage) / this.total)} %)</small>`;
      ol.appendChild(li); // in order, largest first; a line already there just moves
    }
  }
}
