# Beat the Sim: Forever

A rotation practice game for **World of Warcraft: Forever**. You play your rotation against one to three bosses,
then compare your fight with what a simulation reaches on the same setup and see what you did better or worse.

Every class and spec the sim ranks is playable: 35 builds of all nine classes, from Fury Warrior to Feral Druid, with
the sim's gear, talents and rotation for each.

## Playing

Pick a class, spec and race, one to three bosses and a fight (a set time, or until the bosses are dead), and whether
potions, Demonic Runes or Thistle Tea, explosives, the raid's buffs and the raid's debuffs on the bosses are there (for
you and the sim alike; an enhancement shaman also picks a weapon imbue). Lasting buffs of your own (Shadowform, aspects,
a shaman's totems) are up from the start. The Tier 1 set bonuses are always off, since the sim's values for them are
placeholders. Before the fight you see
the character the sim plays (talents, stats with gear and buffs, gear, consumables) and can rearrange your action bar:
drag a spell onto another to swap them, point at a spell and press a key to bind it (Backspace clears it). Your bar is
remembered in this browser. Press the space bar or "Bereit" to start a 5-second countdown in which you may precast.

In the fight, tap the buttons or use your keys. Tap a boss (or press Tab or F1 to F3) to aim at it. The hint, which
you can switch on and off, lights up the spell the sim's rotation would cast next. A spell pressed shortly before the global cooldown or a cast ends
goes off right after it, and a new spell during a channel (Mind Flay, say)
clips it. Rage, energy and combo points get their own bars, pets fight on their own, and a hunter who weaves melee
between shots has a button for each distance.

After the fight the sim plays the same fight a thousand times. The results show your DPS against the sim's, what cost
you the most (with an estimate in DPS and a tip), key numbers such as DoT uptime and full Mind Flays, and both fights
on one timeline.

On a phone, "Add to Home Screen" installs it as an app that also works offline.

## How it works

The simulation is the [WoW Forever sim](https://github.com/gunba/wow-forever-sim) (MIT licence), built to
WebAssembly and run in the browser. Its version is pinned in [`sim.lock.json`](sim.lock.json). The game sends it the
character, the rotation (in the sim's APL format, as its rotation editor exports it) and the fight, and gets back
the DPS, casts and damage per spell, and the first simulated fight event by event.

The fight you play runs in the same engine, in its interactive mode: you press the buttons instead of a rotation,
so every spell value, talent, proc and mana tick is the sim's own.

- `engine/`: the WebAssembly entry point (Go): the sim (`raidSimJson`) and the live fight (`playStart`,
  `playAdvance`, `playCast`).
- `src/sim/`: the page's side of the engine, the same for every class.
- `src/game/`: the fight screen, the analysis of a fight and the results.
- `src/classes/`: one folder per class, one file per spec (`<spec>.json`: action bar, resources, effects shown, stats,
  what the review looks at). A spec plays the rotation of the sim's profile unless it brings its own
  (`shadow.rotation.json`). New specs are drafted from the sim's profiles with `npx vite-node scripts/draft-specs.ts`
  (after `npm run sim`) and then edited by hand.

## Run it locally

Needs Node 22 and Go 1.24 (protoc is downloaded on first use).

```bash
npm install
npm run sim     # builds the sim into public/sim/ (first time: a few minutes)
npm run dev     # http://localhost:5173/
npm test
```

## Notice

Unofficial fan project, not affiliated with or endorsed by Blizzard Entertainment. World of Warcraft is a trademark
of Blizzard Entertainment, Inc.
