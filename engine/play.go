package main

import (
	"encoding/json"
	"fmt"
	"math/rand"
	"runtime/debug"
	"strings"
	"syscall/js"
	"time"

	"github.com/wowsims/classic/sim/core"
	"github.com/wowsims/classic/sim/core/proto"
	"github.com/wowsims/classic/sim/core/simsignals"
	"google.golang.org/protobuf/encoding/protojson"
)

// One live fight at a time.
var live *liveFight

type liveFight struct {
	sim     *core.Simulation
	player  *core.Character
	logs    strings.Builder
	spells []*core.Spell // castable spells, by the index the page uses
}

// jsonCall wraps f so it is called with its first argument parsed from JSON and answers in JSON. A Go panic becomes
// {"error": ...} instead of killing the whole WebAssembly instance.
func jsonCall[T any](f func(T) (any, error)) func(js.Value, []js.Value) interface{} {
	return func(_ js.Value, args []js.Value) (out interface{}) {
		defer func() {
			if r := recover(); r != nil {
				out = mustJSON(map[string]any{"error": fmt.Sprint(r), "stack": string(debug.Stack())})
			}
		}()
		var in T
		if len(args) > 0 && args[0].Type() == js.TypeString {
			if err := json.Unmarshal([]byte(args[0].String()), &in); err != nil {
				return mustJSON(map[string]any{"error": err.Error()})
			}
		}
		res, err := f(in)
		if err != nil {
			return mustJSON(map[string]any{"error": err.Error()})
		}
		return mustJSON(res)
	}
}

func mustJSON(v any) string {
	b, err := json.Marshal(v)
	if err != nil {
		return `{"error":"` + err.Error() + `"}`
	}
	return string(b)
}

func key(id core.ActionID) string {
	switch {
	case id.SpellID != 0:
		return fmt.Sprintf("spell:%d", id.SpellID)
	case id.ItemID != 0:
		return fmt.Sprintf("item:%d", id.ItemID)
	default:
		return fmt.Sprintf("other:%d", int32(id.OtherID))
	}
}

func secs(d time.Duration) float64 { return d.Seconds() }

// ---------- start ----------

type startIn struct {
	Request json.RawMessage `json:"request"` // a RaidSimRequest, as for raidSimJson
	Seed    int64           `json:"seed"`
	// Seconds before the pull the fight starts at, so spells can be cast before it (a pre-pull Mind Blast, say).
	Countdown float64 `json:"countdown"`
}

type spellInfo struct {
	Index     int     `json:"index"`
	Key       string  `json:"key"`
	Rank      int     `json:"rank"`
	CastTime  float64 `json:"castTime"`
	GCD       float64 `json:"gcd"`
	Cooldown  float64 `json:"cooldown"`
	Channeled bool    `json:"channeled"`
	Cost      float64 `json:"cost"`
}

func playStart(in startIn) (any, error) {
	rsr := &proto.RaidSimRequest{}
	if err := protojson.Unmarshal(in.Request, rsr); err != nil {
		return nil, err
	}
	rsr.SimOptions.Interactive = true
	rsr.SimOptions.Debug = true
	rsr.SimOptions.RandomSeed = in.Seed
	if in.Seed == 0 {
		rsr.SimOptions.RandomSeed = rand.Int63()
	}

	s := core.NewSim(rsr, simsignals.Signals{})
	f := &liveFight{sim: s}
	s.Log = func(message string, vals ...interface{}) {
		f.logs.WriteString(fmt.Sprintf("[%0.2f] "+message+"\n", append([]interface{}{s.CurrentTime.Seconds()}, vals...)...))
	}
	s.Reseed(rsr.SimOptions.RandomSeed)
	s.Reset()
	s.PrePull() // schedules the pull at 0, and the rotation's pre-pull actions (the start buffs) before it
	start := -time.Duration(max(0, in.Countdown) * float64(time.Second))
	if s.CurrentTime < start {
		// Run the start buffs' casts, up to where the countdown begins.
		reached := false
		s.AddPendingAction(&core.PendingAction{NextActionAt: start, Priority: core.ActionPriorityLow, OnAction: func(*core.Simulation) { reached = true }})
		for !reached && !s.Step() {
		}
	}
	s.CurrentTime = start
	f.logs.Reset()
	f.player = s.Raid.Parties[0].Players[0].GetCharacter()
	live = f

	var spells []spellInfo
	for _, spell := range f.player.Spellbook {
		if !spell.Flags.Matches(core.SpellFlagAPL) || spell.ActionID.OtherID != 0 {
			continue
		}
		info := spellInfo{
			Index:     len(f.spells),
			Key:       key(spell.ActionID),
			Rank:      spell.Rank,
			CastTime:  secs(spell.DefaultCast.CastTime),
			GCD:       secs(spell.DefaultCast.GCD),
			Cooldown:  secs(spell.CD.Duration),
			Channeled: spell.Flags.Matches(core.SpellFlagChanneled),
		}
		if spell.Cost != nil {
			info.Cost = spell.Cost.GetCurrentCost()
		}
		f.spells = append(f.spells, spell)
		spells = append(spells, info)
	}
	return map[string]any{"spells": spells, "targets": len(s.Encounter.TargetUnits), "state": f.state()}, nil
}

// ---------- advance ----------

type advanceIn struct {
	// Run the fight up to this time (seconds since the pull; negative before it).
	To float64 `json:"to"`
	// The boss the player aims at, for the hint.
	Target int `json:"target"`
}

// playAdvance runs the fight to the given time and reports what happened since the last call and where things stand.
func playAdvance(in advanceIn) (any, error) {
	f := live
	if f == nil {
		return nil, fmt.Errorf("no fight started")
	}
	s := f.sim
	targets := s.Encounter.TargetUnits
	f.player.CurrentTarget = targets[min(max(in.Target, 0), len(targets)-1)]
	finished := f.finished()
	target := time.Duration(in.To * float64(time.Second))
	if !finished && target > s.CurrentTime {
		reached := false
		s.AddPendingAction(&core.PendingAction{
			NextActionAt: target,
			Priority:     core.ActionPriorityLow,
			OnAction:     func(*core.Simulation) { reached = true },
		})
		for !reached {
			if s.Step() {
				finished = true
				break
			}
		}
	}
	logs := f.logs.String()
	f.logs.Reset()
	return map[string]any{"logs": logs, "state": f.state(), "finished": finished || f.finished()}, nil
}

func (f *liveFight) finished() bool {
	s := f.sim
	return s.CurrentTime >= s.Duration || (s.Encounter.EndFightAtHealth > 0 && s.Encounter.DamageTaken >= s.Encounter.EndFightAtHealth)
}

// ---------- cast ----------

type castIn struct {
	Index  int `json:"index"`
	Target int `json:"target"`
}

// playCast casts a spell at the current time. A spell cast during a channel ends the channel first (like clipping
// Mind Flay in game), but only when the new spell can actually be cast.
func playCast(in castIn) (any, error) {
	f := live
	if f == nil {
		return nil, fmt.Errorf("no fight started")
	}
	if in.Index < 0 || in.Index >= len(f.spells) {
		return nil, fmt.Errorf("unknown spell %d", in.Index)
	}
	s, p, spell := f.sim, f.player, f.spells[in.Index]
	targets := s.Encounter.TargetUnits
	target := targets[min(max(in.Target, 0), len(targets)-1)]
	p.CurrentTarget = target

	reason := f.blocked(spell)
	if reason == "" && p.IsChanneling(s) {
		p.ChanneledDot.Cancel(s)
	}
	if reason == "" && !spell.CanCast(s, target) {
		reason = "cannot"
	}
	ok := reason == "" && spell.Cast(s, target)
	if reason == "" && !ok {
		reason = "cannot"
	}
	logs := f.logs.String()
	f.logs.Reset()
	return map[string]any{"ok": ok, "reason": reason, "logs": logs, "state": f.state()}, nil
}

// Why a spell cannot be cast now, checked before a channel is ended for it. Empty when nothing stands in the way.
func (f *liveFight) blocked(spell *core.Spell) string {
	s, p := f.sim, f.player
	switch {
	case p.IsCasting(s):
		return "casting"
	case spell.DefaultCast.GCD > 0 && !p.GCD.IsReady(s):
		return "gcd"
	case !spell.IsReady(s):
		return "cooldown"
	case spell.Cost != nil && spell.Cost.GetCurrentCost() > p.CurrentMana() && p.HasManaBar():
		return "mana"
	}
	return ""
}

// ---------- state ----------

type auraState struct {
	Key       string  `json:"key"`
	Label     string  `json:"label"`
	Remaining float64 `json:"remaining"` // seconds; -1 when it never runs out
	Duration  float64 `json:"duration"`
	Stacks    int32   `json:"stacks"`
}

type targetState struct {
	Auras []auraState `json:"auras"`
}

func auras(s *core.Simulation, u *core.Unit) []auraState {
	out := []auraState{}
	for _, a := range u.GetAuras() {
		if !a.IsActive() || a.ActionID.IsEmptyAction() {
			continue
		}
		st := auraState{Key: key(a.ActionID), Label: a.Label, Remaining: -1, Duration: -1, Stacks: a.GetStacks()}
		if a.Duration != core.NeverExpires {
			st.Remaining = secs(a.RemainingDuration(s))
			st.Duration = secs(a.Duration)
		}
		out = append(out, st)
	}
	return out
}

func (f *liveFight) state() map[string]any {
	s, p := f.sim, f.player
	cooldowns := make([]float64, len(f.spells))
	costs := make([]float64, len(f.spells))
	for i, spell := range f.spells {
		cooldowns[i] = secs(spell.TimeToReady(s))
		if spell.Cost != nil {
			costs[i] = spell.Cost.GetCurrentCost()
		}
	}
	state := map[string]any{
		"time":      secs(s.CurrentTime),
		"duration":  secs(s.Duration),
		"mana":      p.CurrentMana(),
		"maxMana":   p.MaxMana(),
		"gcd":       secs(max(0, p.GCD.TimeToReady(s))),
		"cooldowns": cooldowns,
		"costs":     costs,
		"auras":     auras(s, &p.Unit),
	}
	if p.IsCasting(s) {
		state["cast"] = map[string]any{"key": key(p.Hardcast.ActionID), "ends": secs(p.Hardcast.Expires)}
	}
	if dot := p.ChanneledDot; dot != nil {
		state["channel"] = map[string]any{
			"key":   key(dot.Spell.ActionID),
			"ends":  secs(dot.ExpiresAt()),
			"ticks": dot.MaxTicksRemaining(),
			"tick":  secs(dot.TickPeriod()),
		}
	}
	targets := []targetState{}
	for _, t := range s.Encounter.TargetUnits {
		targets = append(targets, targetState{Auras: auras(s, t)})
	}
	state["targets"] = targets
	if hint := f.hint(); hint != "" {
		state["hint"] = hint
	}
	state["damageTaken"] = s.Encounter.DamageTaken
	state["health"] = s.Encounter.EndFightAtHealth
	return state
}

// hint is the spell the rotation would cast next, as soon as the player is free: the global cooldown, a cast and a
// channel are taken as over for the question, then put back. Empty without a rotation or before the pull.
func (f *liveFight) hint() string {
	s, p := f.sim, f.player
	if p.Rotation == nil || s.CurrentTime < 0 {
		return ""
	}
	gcd, hardcast, channel := *p.GCD, p.Hardcast.Expires, p.ChanneledDot
	*p.GCD = core.Timer(0)
	if p.Hardcast.Expires > s.CurrentTime {
		p.Hardcast.Expires = s.CurrentTime
	}
	p.ChanneledDot = nil
	defer func() { *p.GCD, p.Hardcast.Expires, p.ChanneledDot = gcd, hardcast, channel }()

	for _, action := range p.Rotation.PriorityList() {
		if !action.IsReady(s) {
			continue
		}
		for _, spell := range action.GetAllSpells() {
			if spell.IsReady(s) && spell.Flags.Matches(core.SpellFlagAPL) {
				return key(spell.ActionID)
			}
		}
	}
	return ""
}
