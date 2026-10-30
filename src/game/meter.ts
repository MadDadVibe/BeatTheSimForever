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

  /** The meter after seconds of fighting. */
  html(seconds: number): string {
    if (!this.total) return '<p class="muted small">Noch kein Schaden.</p>';
    const rows = [...this.bySpell.entries()].sort((a, b) => b[1].damage - a[1].damage);
    const top = rows[0][1].damage;
    const nf = (x: number) => Math.round(x).toLocaleString('de-DE');
    const t = Math.max(1, seconds);
    return `<ol class="dmg">${rows
      .map(([key, r]) => {
        const url = iconUrl(key);
        const share = Math.round((100 * r.damage) / this.total);
        return `<li style="--w:${((100 * r.damage) / top).toFixed(1)}%" title="${escapeHtml(label(key))}: ${r.hits} Treffer, ${r.crits} Crits">${url ? `<img src="${url}" alt="" onerror="this.remove()">` : '<span class="ph"></span>'}<span class="dmg-name">${escapeHtml(label(key))}</span><span class="dmg-num">${nf(r.damage)} <small>(${nf(r.damage / t)}, ${share} %)</small></span></li>`;
      })
      .join('')}</ol>`;
  }
}
