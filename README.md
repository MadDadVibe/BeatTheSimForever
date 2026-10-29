# Beat the Sim: Forever

A rotation practice game for **World of Warcraft: Forever**. You play your rotation against one to three bosses,
then compare your fight with what a simulation reaches on the same setup and see what you did better or worse.

Version 1 is for Shadow Priest. Later versions add the other classes.

## How it works

The simulation is the [WoW Forever sim](https://github.com/gunba/wow-forever-sim) (MIT licence), built to
WebAssembly and run in the browser. Its version is pinned in [`sim.lock.json`](sim.lock.json). The game sends it the
character, the rotation (in the sim's APL format, as its rotation editor exports it) and the fight, and gets back
the DPS, casts and damage per spell, and the first simulated fight event by event.

- `src/sim/`: the bridge to the sim, the same for every class.
- `src/classes/`: one module per class. Version 1 has Shadow Priest.

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
