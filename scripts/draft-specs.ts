// Drafts the spec files (src/classes/<class>/<spec>.json) for the sim's profiles listed in sim.lock.json: the action
// bar, the effects shown, the resources, the stats and what the review looks at, read from the profile's rotation
// and from what the engine says about each spell. A spec file that exists is left alone (they are edited by hand
// afterwards); pass --force to redraft them all.
//
//   npm run sim && npx vite-node scripts/draft-specs.ts [--force]
import fs from 'node:fs';
import path from 'node:path';
import { liveApi, type LiveEngine, type LiveSpell } from '../src/sim/live';
import { buildLiveRequest } from '../src/sim/request';
import { runJob } from '../src/sim/run';
import type { SimProfile } from '../src/sim/types';
import { loadSim, profiles } from '../tests/sim-node';

const ROOT = path.resolve(__dirname, '..');
const SIM_SRC = path.join(ROOT, '.sim-src/wow-forever-sim');
const force = process.argv.includes('--force');

const lock = JSON.parse(fs.readFileSync(path.join(ROOT, 'sim.lock.json'), 'utf8')) as { presets: Record<string, string> };
const names = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/sim/names.json'), 'utf8')) as Record<string, Record<string, [string, string]>>;
const ranked = JSON.parse(fs.readFileSync(path.join(SIM_SRC, 'artifacts/modelled_gear/ui_profiles/index.json'), 'utf8')) as Array<{ build: string; file: string; dps: number }>;
const nameOf = (key: string) => names[key.split(':')[0]]?.[key.split(':')[1]]?.[0] ?? key;

// Short names on the buttons. Anything not listed is shortened by rule (see short()).
const SHORT: Record<string, string> = {
  'Shadow Word: Pain': 'SW:P', 'Shadow Word: Death': 'SW:D', 'Mind Blast': 'MB', 'Mind Flay': 'MF', 'Inner Focus': 'IF',
  'Devouring Plague': 'DP', 'Shadowform': 'Form', 'Holy Fire': 'HF', 'Penance': 'Pen',
  'Mana Agate': 'Agate', 'Mana Jade': 'Jade', 'Mana Citrine': 'Citrin', 'Mana Ruby': 'Ruby',
  'Bloodthirst': 'BT', 'Mortal Strike': 'MS', 'Whirlwind': 'WW', 'Heroic Strike': 'HS', 'Execute': 'Exec',
  'Overpower': 'OP', 'Hamstring': 'Ham', 'Bloodrage': 'Blood', 'Berserker Rage': 'BRage', 'Recklessness': 'Reck',
  'Death Wish': 'DW', 'Battle Stance': 'Battle', 'Berserker Stance': 'Bers.', 'Defensive Stance': 'Def',
  'Sunder Armor': 'Sunder', 'Battle Shout': 'Shout', 'Demoralizing Shout': 'Demo', 'Thunder Clap': 'TC',
  'Shield Slam': 'SS', 'Shield Block': 'Block', 'Shield Wall': 'Wall', 'Last Stand': 'LS', 'Revenge': 'Rev',
  'Spearing Strike': 'Spear', 'Cleave': 'Cleave',
  'Sinister Strike': 'SS', 'Slice and Dice': 'SnD', 'Eviscerate': 'Evis', 'Adrenaline Rush': 'AR', 'Blade Flurry': 'BF',
  'Cold Blood': 'CB', 'Garrote': 'Garr', 'Ambush': 'Amb', 'Vanish': 'Van', 'Mutilate': 'Muti', 'Hemorrhage': 'Hemo',
  'Rupture': 'Rupt', 'Ghostly Strike': 'Ghost', 'Premeditation': 'Premed', 'Stealth': 'Stealth', 'Backstab': 'BS',
  'Shadow Bolt': 'SB', 'Corruption': 'Corr', 'Curse of Agony': 'CoA', 'Curse of Doom': 'CoD', 'Curse of the Elements': 'CoE',
  'Immolate': 'Immo', 'Life Tap': 'Tap', 'Searing Pain': 'SP', 'Soul Fire': 'SF', 'Shadowburn': 'SBurn',
  'Conflagrate': 'Conf', 'Demonic Sacrifice': 'Sac', 'Amplify Curse': 'Amp', 'Soul Link': 'Link',
  'Summon Imp': 'Imp', 'Summon Succubus': 'Succ', 'Summon Voidwalker': 'Void', 'Summon Felhunter': 'Fel',
  'Frostbolt': 'FrB', 'Fireball': 'FB', 'Fire Blast': 'FBlast', 'Pyroblast': 'Pyro', 'Scorch': 'Scorch',
  'Arcane Missiles': 'AM', 'Arcane Blast': 'AB', 'Arcane Wrath': 'AW', 'Evocation': 'Evo', 'Ice Lance': 'IL',
  'Cone of Cold': 'CoC', 'Frostfire Bolt': 'FFB', 'Presence of Mind': 'PoM', 'Arcane Power': 'AP', 'Combustion': 'Comb',
  'Starfire': 'SF', 'Moonfire': 'MF', 'Insect Swarm': 'IS', 'Wrath': 'Wrath', 'Ferocious Bite': 'Bite', 'Shred': 'Shred',
  'Rake': 'Rake', 'Rip': 'Rip', 'Shifting Power': 'Shift', 'Faerie Fire': 'FF', 'Demoralizing Roar': 'Roar',
  'Frenzied Regeneration': 'FR', 'Barkskin': 'Bark', 'Primal Bite': 'PBite', 'Lacerate': 'Lac', 'Maul': 'Maul',
  'Swipe': 'Swipe', 'Berserk': 'Bers.', 'Innervate': 'Inn', 'Enrage': 'Enrage', 'Cat Form': 'Cat',
  'Lightning Bolt': 'LB', 'Flame Shock': 'FS', 'Earth Shock': 'ES', 'Lava Burst': 'LvB', 'Searing Totem': 'Sear',
  'Magma Totem': 'Magma', 'Stormstrike': 'SS', 'Fire Nova': 'Nova', 'Elemental Mastery': 'EM',
  'Aimed Shot': 'Aimed', 'Arcane Shot': 'Arc', 'Multi-Shot': 'Multi', 'Serpent Sting': 'Sting', 'Rapid Fire': 'RF',
  'Raptor Strike': 'Raptor', 'Mongoose Bite': 'Mong.', 'Wing Clip': 'Clip', "Hunter's Mark": 'Mark',
  'Immolation Trap': 'ITrap', 'Explosive Trap': 'ETrap', 'Aspect of the Hawk': 'Hawk', 'Aspect of the Beast': 'Beast',
  'Summon Hawk': 'SHawk', 'Strider Kick': 'Kick', 'Intimidation': 'Intim', 'Bestial Wrath': 'BW', 'Sniper Shot': 'Sniper',
  'Seal of Command': 'SoC', 'Seal of Righteousness': 'SoR', 'Judgement': 'Judge', 'Holy Strike': 'HStr',
  'Consecration': 'Cons', 'Hammer of Wrath': 'HoW', 'Holy Shock': 'Shock', 'Divine Favor': 'DF', 'Holy Shield': 'HS',
  'Swift Judgement': 'SJ', "Templar's Bulwark": 'Bulw.', 'Righteous Fury': 'RF',
  'Stoneform': 'Stone', 'Berserking': 'Zerk', 'Blood Fury': 'BFury', 'Demonic Rune': 'Rune', 'Thistle Tea': 'Tea',
  'Goblin Sapper Charge': 'Sapper', 'Thorium Grenade': 'Nade', 'Starshards': 'Star', 'Dark Sacrifice': 'DS',
  'Elune\'s Grace': 'Elune', 'Rage of the Farseer': 'RotF', 'Eureka!': 'Eureka',
};

function short(key: string): string {
  const name = nameOf(key);
  if (SHORT[name]) return SHORT[name];
  if (/potion/i.test(name)) return 'Pot';
  const words = name.replace(/[^\w\s'-]/g, '').split(/\s+/).filter(Boolean);
  if (words.length === 1) return name.length <= 6 ? name : name.slice(0, 5) + '.';
  return words.map((w) => (/^(of|the|and)$/i.test(w) ? w[0].toLowerCase() : w[0].toUpperCase())).join('');
}

/** Spells a rotation casts, in its order (pre-pull last), and what its conditions look at. */
function readRotation(rotation: unknown) {
  const casts: string[] = [];
  const dots = new Set<string>();
  const selfAuras = new Set<string>();
  const targetAuras = new Set<string>();
  const id = (x: { spellId?: number; itemId?: number } | undefined) => (x?.spellId ? `spell:${x.spellId}` : x?.itemId ? `item:${x.itemId}` : null);
  const walk = (node: unknown) => {
    if (Array.isArray(node)) return node.forEach(walk);
    if (!node || typeof node !== 'object') return;
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      const o = v as Record<string, unknown>;
      if ((k === 'castSpell' || k === 'channelSpell') && id(o.spellId as never)) casts.push(id(o.spellId as never)!);
      if (k === 'castPaladinPrimarySeal') casts.push('primarySeal');
      if ((k === 'dotIsActive' || k === 'dotRemainingTime') && id(o.spellId as never)) dots.add(id(o.spellId as never)!);
      if (/^aura(IsActive|RemainingTime|NumStacks)$/.test(k) && id(o.auraId as never)) {
        const onTarget = (o.sourceUnit as { type?: string } | undefined)?.type === 'CurrentTarget';
        (onTarget ? targetAuras : selfAuras).add(id(o.auraId as never)!);
      }
      walk(v);
    }
  };
  const r = rotation as { priorityList?: unknown[]; prepullActions?: unknown[] };
  walk(r.priorityList);
  walk(r.prepullActions);
  return { casts: [...new Set(casts)], dots, selfAuras, targetAuras };
}

const CASTER_STATS = ['Intellect', 'Spirit', 'Stamina', 'SpellPower', 'SpellHit', 'SpellCrit', 'SpellHaste', 'MP5', 'Mana', 'Health'];
const MELEE_STATS = ['Strength', 'Agility', 'Stamina', 'AttackPower', 'MeleeHit', 'MeleeCrit', 'MeleeHaste', 'Expertise', 'ArmorPenetration', 'Health'];
const HUNTER_STATS = ['Agility', 'Intellect', 'Stamina', 'RangedAttackPower', 'AttackPower', 'MeleeHit', 'MeleeCrit', 'MeleeHaste', 'Mana', 'Health'];
const TANK_STATS = ['Stamina', 'Health', 'Armor', 'Defense', 'Dodge', 'Parry', 'Block', 'BlockValue'];
const SCHOOL_POWER: Record<string, string> = { Shadow: 'ShadowPower', Fire: 'FirePower', Frost: 'FrostPower', Arcane: 'ArcanePower', Nature: 'NaturePower', Holy: 'HolyPower' };

async function draft(specKey: string, simClass: string) {
  const all = profiles(specKey);
  const build = path.basename(lock.presets[specKey]).split('__')[0];
  const rows = ranked.filter((r) => r.file.startsWith(build + '__'));
  const best = rows.sort((a, b) => b.dps - a.dps)[0];
  const defaultRace = best ? best.file.replace(/^.*__|\.json$/g, '') : Object.keys(all)[0];
  const profile: SimProfile = all[defaultRace];

  // What the engine knows about the spells, over every race (racials differ).
  const api = liveApi(globalThis as unknown as LiveEngine);
  const spells = new Map<string, LiveSpell>();
  for (const p of Object.values(all)) {
    for (const s of api.start(buildLiveRequest(p, 1, { kind: 'time', seconds: 30 }, p.player.rotation), 1).spells) if (!spells.has(s.key)) spells.set(s.key, s);
  }
  const rot = readRotation(profile.player.rotation);
  for (const p of Object.values(all)) readRotation(p.player.rotation).casts.forEach((c) => rot.casts.includes(c) || rot.casts.push(c));

  const sim = runJob(await loadSim(), { profile, targets: 1, fight: { kind: 'time', seconds: 180 }, iterations: 50, seed: 1 });
  const simSpell = new Map(sim.spells.map((s) => [s.key, s]));
  const damages = (key: string) => (simSpell.get(key)?.damagePerFight ?? 0) > 0;

  // A paladin's "cast primary seal": the highest rank of the seal the profile picks.
  const sealName = 'Seal of ' + String(Object.values(profile.player).map((v) => (v as { options?: { primarySeal?: string } })?.options?.primarySeal).find(Boolean));
  const seal = [...spells.values()].filter((s) => nameOf(s.key) === sealName).sort((a, b) => b.rank - a.rank)[0];
  rot.casts = rot.casts.map((k) => (k === 'primarySeal' ? seal?.key ?? k : k));
  const rotationSpells = rot.casts.filter((k, i, a) => spells.has(k) && a.indexOf(k) === i);
  // Major cooldowns the sim uses by itself; those for staying alive only when the rotation casts them.
  const majors = [...spells.values()].filter((s) => s.major && !s.survival && !rotationSpells.includes(s.key)).map((s) => s.key);
  const ordered = [
    ...rotationSpells.filter((k) => !spells.get(k)!.major),
    ...[...rotationSpells.filter((k) => spells.get(k)!.major), ...majors].sort((a, b) => Number(a.startsWith('item:')) - Number(b.startsWith('item:'))),
  ];
  // Several ranks of one spell (a low rank to save mana, say) get their rank on the button.
  const bar = ordered.map((key) => {
    const twice = ordered.filter((k) => nameOf(k) === nameOf(key)).length > 1;
    return { key, short: short(key) + (twice ? spells.get(key)!.rank || '' : '') };
  });
  // A rotation that moves (melee weaving) gets a button per distance: the shortest is melee range.
  const moves = [...spells.keys()].filter((k) => k.startsWith('move:')).sort((a, b) => parseFloat(a.slice(5)) - parseFloat(b.slice(5)));
  moves.forEach((key, i) => bar.splice(i, 0, { key, short: i === 0 ? 'Nah' : 'Fern' }));

  const isTotemOrTrap = (k: string) => /Totem|Trap|Hunter's Mark/.test(nameOf(k));
  const dots = [...rot.dots].filter((k) => spells.has(k) && !isTotemOrTrap(k) && damages(k));
  const procs = /^(Overpower|Revenge|Riposte|Mongoose Bite|Execute|Hammer of Wrath|Shadowburn|Ambush|Garrote|Raptor Strike)$/;
  const keepOnCooldown = rotationSpells.filter((k) => {
    const s = spells.get(k)!;
    return !s.major && !dots.includes(k) && s.cooldown >= 4 && s.cooldown <= 30 && damages(k) && !procs.test(nameOf(k)) && !isTotemOrTrap(k);
  });

  const costs = new Set(bar.map((b) => spells.get(b.key)!.costType));
  const resources: string[] = [];
  if (costs.has('energy')) resources.push('energy', 'combo');
  if (costs.has('rage')) resources.push('rage');
  if (costs.has('mana')) resources.push('mana');

  // The spec's talent tree: where most points went.
  const trees = JSON.parse(fs.readFileSync(path.join(SIM_SRC, 'ui/core/talents/trees', simClass + '.json'), 'utf8')) as Array<{ name: string }>;
  const points = String(profile.player.talentsString ?? '').split('-').map((t) => t.split('').reduce((a, b) => a + Number(b), 0));
  const tree = trees[points.indexOf(Math.max(...points))]?.name ?? trees[0].name;

  const caster = ['mage', 'warlock', 'priest'].includes(simClass) || ['balance', 'elemental', 'stormcaller', 'shockadin'].includes(build);
  const tank = /tank|protection/.test(build);
  let stats = simClass === 'hunter' ? HUNTER_STATS : caster ? CASTER_STATS : MELEE_STATS;
  if (caster) {
    const schools = new Set(sim.spells.filter((s) => s.damagePerFight > 0).flatMap((s) => Object.keys(SCHOOL_POWER).filter((sc) => nameOf(s.key).includes(sc))));
    stats = [...stats.slice(0, 4), ...[...schools].map((s) => SCHOOL_POWER[s]), ...stats.slice(4)];
  }
  if (tank) stats = [...stats.filter((s) => s !== 'Stamina' && s !== 'Health'), ...TANK_STATS];
  if (['retribution', 'retribution_physical', 'enhancement', 'feral_tank_druid', 'protection_paladin'].includes(build)) stats = [...stats, 'SpellPower', 'Mana'];

  // Lasting buffs the profile casts before the pull (aspects, marks, a warlock's pets and sacrifice): up from the start.
  const prepull = readRotation({ priorityList: (profile.player.rotation as { prepullActions?: unknown[] }).prepullActions ?? [] }).casts;
  const startBuffs = prepull.filter((k) => /^(Aspect of|Hunter's Mark|Shadowform|Demonic Sacrifice|Summon |Soul Link)/.test(nameOf(k)));

  const playerAuras = [...rot.selfAuras, ...bar.map((b) => b.key)].filter((k, i, a) => a.indexOf(k) === i && !k.startsWith('move:') && !rot.dots.has(k) && !rot.targetAuras.has(k));
  const targetAuras = [...rot.dots, ...rot.targetAuras].filter((k, i, a) => a.indexOf(k) === i);

  return {
    key: specKey,
    name: best?.build ?? build,
    tree,
    defaultRace,
    resources,
    ...(startBuffs.length ? { startBuffs } : {}),
    bar,
    targetAuras,
    playerAuras,
    stats: [...new Set(stats)],
    review: { dots, keepOnCooldown },
  };
}

async function main() {
  await loadSim();
  for (const specKey of Object.keys(lock.presets)) {
    const profile = Object.values(profiles(specKey))[0];
    const simClass = String(profile.player.class).replace(/^Class/, '').toLowerCase();
    const dir = path.join(ROOT, 'src/classes', simClass);
    const file = path.join(dir, specKey.replace(new RegExp(`-${simClass}$`), '') + '.json');
    if (fs.existsSync(file) && !force) continue;
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, JSON.stringify(await draft(specKey, simClass), null, 2) + '\n');
    console.log('drafted', path.relative(ROOT, file));
  }
}

void main();
