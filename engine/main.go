//go:build wasm

// The game's WebAssembly entry point. Besides the sim's own raidSimJson (the reference fight, many iterations), it
// exposes a live fight the player drives: the same engine, the same spells and numbers, but the player presses the
// buttons instead of a rotation. Every call takes and returns JSON strings.
package main

import (
	"syscall/js"

	"github.com/wowsims/classic/sim"
	"github.com/wowsims/classic/sim/core"
	"github.com/wowsims/classic/sim/core/proto"
	"google.golang.org/protobuf/encoding/protojson"
)

func init() {
	core.SetRunningInWasm()
	sim.RegisterAll()
}

func main() {
	js.Global().Set("raidSimJson", js.FuncOf(raidSimJson))
	js.Global().Set("playStart", js.FuncOf(jsonCall(playStart)))
	js.Global().Set("playAdvance", js.FuncOf(jsonCall(playAdvance)))
	js.Global().Set("playCast", js.FuncOf(jsonCall(playCast)))
	js.Global().Call("wasmready")
	select {}
}

func raidSimJson(this js.Value, args []js.Value) interface{} {
	rsr := &proto.RaidSimRequest{}
	if err := protojson.Unmarshal([]byte(args[0].String()), rsr); err != nil {
		return nil
	}
	result := core.RunRaidSim(rsr)
	out, err := protojson.MarshalOptions{EmitUnpopulated: true}.Marshal(result)
	if err != nil {
		return nil
	}
	return string(out)
}
