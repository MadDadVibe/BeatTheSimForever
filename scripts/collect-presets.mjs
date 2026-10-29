// Gathers the sim's ranked profiles listed in sim.lock.json into one file per class: { race: profile }.
import fs from 'node:fs';
import path from 'node:path';

const [src, out] = process.argv.slice(2);
const lock = JSON.parse(fs.readFileSync(new URL('../sim.lock.json', import.meta.url)));
for (const [classKey, pattern] of Object.entries(lock.presets)) {
  const dir = path.join(src, path.dirname(pattern));
  const match = new RegExp('^' + path.basename(pattern).replace('.', '\\.').replace('*', '(.+)') + '$');
  const byRace = {};
  for (const file of fs.readdirSync(dir).sort()) {
    const m = file.match(match);
    if (m) byRace[m[1]] = JSON.parse(fs.readFileSync(path.join(dir, file)));
  }
  if (!Object.keys(byRace).length) throw new Error('no presets for ' + classKey);
  fs.writeFileSync(path.join(out, classKey + '.json'), JSON.stringify(byRace));
}

// Names and icon names of every spell and item, so results can be shown without the full database.
const db = JSON.parse(fs.readFileSync(path.join(src, 'assets/database/db.json')));
const names = { spell: {}, item: {} };
for (const s of db.spellIcons) names.spell[s.id] = [s.name, s.icon];
for (const i of db.itemIcons) names.item[i.id] = [i.name, i.icon];
names.enchant = {};
for (const e of db.enchants) names.enchant[e.effectId] = e.name;
fs.writeFileSync(path.join(out, '..', 'names.json'), JSON.stringify(names));

// Icons of everything the class modules show (src/classes/*/class.json), the talents and the gear of the profiles,
// from the sim's copy of Wowhead's icons.
const classesDir = new URL('../src/classes/', import.meta.url);
const iconDir = path.join(out, '..', 'icons');
fs.mkdirSync(iconDir, { recursive: true });
const copyIcon = (icon) => {
  const from = icon && path.join(src, 'assets/img/wowhead/icons/large', icon + '.jpg');
  if (from && fs.existsSync(from)) fs.copyFileSync(from, path.join(iconDir, icon + '.jpg'));
};

// Talent trees of every class (names, places, ranks), for showing a profile's talents.
const talentDir = path.join(out, '..', 'talents');
fs.mkdirSync(talentDir, { recursive: true });
const treesDir = path.join(src, 'ui/core/talents/trees');
for (const file of fs.readdirSync(treesDir)) {
  const trees = JSON.parse(fs.readFileSync(path.join(treesDir, file))).map((tree) => ({
    name: tree.name,
    talents: tree.talents.map((t) => {
      copyIcon(t.icon);
      return { name: t.name, icon: t.icon, maxPoints: t.maxPoints, row: t.location.rowIdx, col: t.location.colIdx };
    }),
  }));
  fs.writeFileSync(path.join(talentDir, file), JSON.stringify(trees));
}
for (const file of fs.readdirSync(out)) {
  for (const profile of Object.values(JSON.parse(fs.readFileSync(path.join(out, file))))) {
    for (const item of profile.player.equipment?.items ?? []) copyIcon(names.item[item.id]?.[1]);
  }
}
for (const dir of fs.readdirSync(classesDir)) {
  const file = new URL(`${dir}/class.json`, classesDir);
  if (!fs.existsSync(file)) continue;
  const cls = JSON.parse(fs.readFileSync(file));
  const keys = [...cls.bar.map((b) => b.key), ...cls.targetAuras, ...cls.playerAuras];
  for (const k of keys) {
    const [kind, id] = k.split(':');
    const icon = names[kind]?.[id]?.[1];
    const from = icon && path.join(src, 'assets/img/wowhead/icons/large', icon + '.jpg');
    if (from && fs.existsSync(from)) fs.copyFileSync(from, path.join(iconDir, icon + '.jpg'));
    else console.warn(`no icon for ${k}`);
  }
}
