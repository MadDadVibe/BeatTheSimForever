# Beat the Sim: Forever

A rotation practice game for **World of Warcraft: Forever**. You play your rotation against one to three bosses,
then compare your fight with what a simulation reaches on the same setup and see what you did better or worse.

Version 1 is for Shadow Priest. Later versions add the other classes.

## Playing

Pick a race, one to three bosses and a fight (a set time, or until the bosses are dead), then press your spells:
tap the buttons, or use the keys 1 to 0, -, =, Q, E, R. Tap a boss (or press Tab or F1 to F3) to aim at it. A
5-second countdown before the pull lets you precast. A spell pressed shortly before the global cooldown or a cast ends
goes off right after it, and a new spell during Mind Flay clips the channel.

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
- `src/classes/`: one folder per class: `class.json` (action bar, effects shown, what the review looks at) and the
  default rotation. Version 1 has Shadow Priest; a new class is a new folder.

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
