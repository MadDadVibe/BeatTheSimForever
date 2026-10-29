//go:build wasm

// The game's WebAssembly entry point. Besides the sim's own raidSimJson (the reference fight, many iterations), it
// exposes a live fight the player drives: the same engine, the same spells and numbers, but the player presses the
// buttons instead of a rotation. Every call takes and returns JSON strings.
package main

import (
	"encoding/json"
	"fmt"
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
	js.Global().Set("statsJson", js.FuncOf(jsonCall(statsJson)))
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

type statsIn struct {
	Request json.RawMessage `json:"request"` // a RaidSimRequest, as for raidSimJson
}

// statsJson works out the character's stats with gear, talents, buffs and consumables, as the sim starts the fight
// with them. Answers {"stats": [...]} in the order of the sim's Stat list.
func statsJson(in statsIn) (any, error) {
	rsr := &proto.RaidSimRequest{}
	if err := protojson.Unmarshal(in.Request, rsr); err != nil {
		return nil, err
	}
	res := core.ComputeStats(&proto.ComputeStatsRequest{Raid: rsr.Raid, Encounter: rsr.Encounter, Ruleset: rsr.SimOptions.GetRuleset()})
	if res.ErrorResult != "" {
		return nil, fmt.Errorf("%s", res.ErrorResult)
	}
	return map[string]any{"stats": res.RaidStats.Parties[0].Players[0].FinalStats.Stats}, nil
}
