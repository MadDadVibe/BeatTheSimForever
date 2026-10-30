package main

import (
	"encoding/json"
	"fmt"
	"math/rand"
	"reflect"
	"runtime/debug"
	"slices"
	"strconv"
	"strings"
	"syscall/js"
	"time"
	"unsafe"

	"github.com/wowsims/classic/sim/core"
	"github.com/wowsims/classic/sim/core/proto"
	"github.com/wowsims/classic/sim/core/simsignals"
	"github.com/wowsims/classic/sim/shaman"
	"google.golang.org/protobuf/encoding/protojson"
)

// One live fight at a time.
var live *liveFight

type liveFight struct {
	sim    *core.Simulation
	player *core.Character
	logs   strings.Builder
	spells []*core.Spell // castable spells, by the index the page uses
	// The boss the hint's spell goes on, when the rotation picks one (a DoT kept up on every boss); -1 otherwise.
	hintTarget int
	// Distances the rotation moves to (a hunter weaving melee between shots); each is a button after the spells.
	moves    []float64
	rotation *proto.APLRotation // the rotation as configured, for what the parsed one does not tell (see hint)
}

func moveKey(yards float64) string { return fmt.Sprintf("move:%g", yards) }

// moveRange is the distance a "move" entry of the rotation goes to, when it is a fixed one.
func moveRange(action *proto.APLAction) (float64, bool) {
	val := action.GetMove().GetRangeFromTarget().GetConst().GetVal()
	yards, err := strconv.ParseFloat(strings.TrimSuffix(val, "y"), 64)
	return yards, val != "" && err == nil
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
	// What it costs: "mana", "rage", "energy" or "focus"; empty when free.
	CostType string `json:"costType"`
	// A major cooldown (a trinket, a racial, a class cooldown) the sim's rotation uses whenever it is ready.
	Major bool `json:"major"`
	// A major cooldown for staying alive, which the sim's rotation leaves alone.
	Survival bool `json:"survival"`
}

func costType(spell *core.Spell) string {
	if spell.Cost == nil {
		return ""
	}
	switch spell.Cost.CostType() {
	case core.CostTypeMana:
		return "mana"
	case core.CostTypeRage:
		return "rage"
	case core.CostTypeEnergy:
		return "energy"
	case core.CostTypeFocus:
		return "focus"
	}
	return ""
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
	f.rotation = rsr.Raid.Parties[0].Players[0].Rotation
	for _, item := range f.rotation.GetPriorityList() {
		if yards, ok := moveRange(item.GetAction()); ok && !slices.Contains(f.moves, yards) {
			f.moves = append(f.moves, yards)
		}
	}
	slices.Sort(f.moves)
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
			CostType:  costType(spell),
		}
		if mcd := f.player.GetMajorCooldown(spell.ActionID); mcd != nil {
			info.Major = true
			info.Survival = mcd.Type.Matches(core.CooldownTypeSurvival)
		}
		if spell.Cost != nil {
			info.Cost = spell.Cost.GetCurrentCost()
		}
		f.spells = append(f.spells, spell)
		spells = append(spells, info)
	}
	for i, yards := range f.moves {
		spells = append(spells, spellInfo{Index: len(f.spells) + i, Key: moveKey(yards)})
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
			f.drivePets()
		}
	}
	logs := f.logs.String()
	f.logs.Reset()
	return map[string]any{"logs": logs, "state": f.state(), "finished": finished || f.finished()}, nil
}

// In interactive mode the engine waits for input from every unit, pets included. The player presses their own
// buttons; pets act on their own as in the sim, whenever their global cooldown is ready.
func (f *liveFight) drivePets() {
	s := f.sim
	if s.CurrentTime < 0 {
		return
	}
	for _, pet := range f.player.Pets {
		if pet.IsEnabled() && pet.Rotation != nil && pet.GCD.IsReady(s) && !pet.IsCasting(s) && !pet.IsChanneling(s) {
			pet.Rotation.DoNextAction(s)
		}
	}
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
// Mind Flay in game), but only when the new spell can actually be cast. An index after the spells is a move.
func playCast(in castIn) (any, error) {
	f := live
	if f == nil {
		return nil, fmt.Errorf("no fight started")
	}
	if in.Index >= len(f.spells) && in.Index < len(f.spells)+len(f.moves) {
		return f.move(f.moves[in.Index-len(f.spells)]), nil
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

// move walks to a distance from the boss, as the rotation's "move" does: not while casting, and it ends a channel.
func (f *liveFight) move(yards float64) map[string]any {
	s, p := f.sim, f.player
	reason := ""
	switch {
	case p.IsCasting(s):
		reason = "casting"
	case p.IsMoving() || p.IsRooted() || p.DistanceFromTarget == yards:
		reason = "cannot"
	}
	if reason == "" {
		if p.IsChanneling(s) {
			p.ChanneledDot.Cancel(s)
		}
		p.MoveTo(yards, s)
	}
	logs := f.logs.String()
	f.logs.Reset()
	return map[string]any{"ok": reason == "", "reason": reason, "logs": logs, "state": f.state()}
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
	case spell.Cost != nil && !spell.Cost.MeetsRequirement(s, spell):
		if t := costType(spell); t != "" {
			return t
		}
		return "cannot"
	}
	return ""
}

// primarySeal is the seal a paladin's "cast primary seal" entry casts. The sim keeps it to itself (the entry holds
// the paladin, the paladin its seal), so it is read with reflection; nil if that ever changes.
func primarySeal(action *core.APLAction) (spell *core.Spell) {
	defer func() {
		if recover() != nil {
			spell = nil
		}
	}()
	impl := reflect.ValueOf(action).Elem().FieldByName("impl").Elem()
	seal := impl.Elem().FieldByName("paladin").Elem().FieldByName("primarySeal")
	if seal.Kind() != reflect.Pointer || seal.IsNil() || seal.Type() != reflect.TypeOf(spell) {
		return nil
	}
	return (*core.Spell)(unsafe.Pointer(seal.Pointer()))
}

// multidotTarget is the boss a ready multi-DoT entry casts on (nil for any other entry). The sim keeps it unexported.
func multidotTarget(action *core.APLAction) (target *core.Unit) {
	defer func() {
		if recover() != nil {
			target = nil
		}
	}()
	impl := reflect.ValueOf(action).Elem().FieldByName("impl").Elem()
	if impl.Type() != reflect.TypeOf(&core.APLActionMultidot{}) {
		return nil
	}
	next := impl.Elem().FieldByName("nextTarget")
	if next.IsNil() {
		return nil
	}
	return (*core.Unit)(unsafe.Pointer(next.Pointer()))
}

// spellFor is the castable spell with this id.
func (f *liveFight) spellFor(id *proto.ActionID) *core.Spell {
	want := core.ProtoToActionID(id)
	for _, spell := range f.spells {
		if spell.ActionID.SpellID == want.SpellID && spell.ActionID.ItemID == want.ItemID {
			return spell
		}
	}
	return nil
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

// The weapon imbues by the label of their aura (which has no spell) and the spell that puts each one on.
var imbueSpells = map[string]int32{
	"Windfury Imbue":    16362,
	"Flametongue Imbue": 16342,
	"Frostbrand Imbue":  16356,
	"Rockbiter Imbue":   16316,
}

// shamanAuras shows a shaman's totems that stand (one of each element) and weapon imbues as effects on them, by the
// spell that placed each one. A totem whose buff is also up some other way is left to that buff.
func shamanAuras(s *core.Simulation, p *core.Character) []auraState {
	agent, ok := s.Raid.GetPlayerFromUnit(&p.Unit).(shaman.ShamanAgent)
	if !ok {
		return nil
	}
	sh := agent.GetShaman()
	out := []auraState{}
	for _, a := range p.GetAuras() {
		if id, ok := imbueSpells[a.Label]; ok && a.IsActive() {
			out = append(out, auraState{Key: key(core.ActionID{SpellID: id}), Label: a.Label, Remaining: -1, Duration: -1})
		}
	}
	for i, spell := range sh.ActiveTotems {
		if spell == nil || sh.TotemExpirations[i] <= s.CurrentTime {
			continue
		}
		k := key(spell.ActionID.WithTag(0))
		if a := p.GetAuraByID(core.ActionID{SpellID: spell.ActionID.SpellID}); a != nil && a.IsActive() {
			continue
		}
		left := sh.TotemExpirations[i] - s.CurrentTime
		out = append(out, auraState{Key: k, Label: "Totem", Remaining: secs(left), Duration: secs(left)})
	}
	return out
}

func (f *liveFight) state() map[string]any {
	s, p := f.sim, f.player
	cooldowns := make([]float64, len(f.spells)+len(f.moves))
	costs := make([]float64, len(f.spells)+len(f.moves))
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
		"auras":     append(auras(s, &p.Unit), shamanAuras(s, p)...),
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
	// A debuff the raid keeps up for good that is also one of your spells (the raid's Insect Swarm on a balance druid)
	// is left out: what you see on a boss is what you put there.
	own := map[string]bool{}
	for _, spell := range f.spells {
		own[key(spell.ActionID.WithTag(0))] = true
	}
	targets := []targetState{}
	for _, t := range s.Encounter.TargetUnits {
		list := slices.DeleteFunc(auras(s, t), func(a auraState) bool { return a.Remaining < 0 && own[a.Key] })
		targets = append(targets, targetState{Auras: list})
	}
	state["targets"] = targets
	if hint, entry := f.hint(); hint != "" {
		state["hint"] = hint
		state["hintEntry"] = entry
		if f.hintTarget >= 0 {
			state["hintTarget"] = f.hintTarget
		}
	}
	// The other resources the character has: rage, energy and combo points (a druid has them all, by form).
	if p.HasRageBar() {
		state["rage"] = p.CurrentRage()
	}
	if p.HasEnergyBar() {
		state["energy"] = p.CurrentEnergy()
		state["maxEnergy"] = p.MaxEnergy()
		state["combo"] = p.ComboPoints()
	}
	if len(f.moves) > 0 {
		state["distance"] = p.DistanceFromTarget
		state["moving"] = p.IsMoving()
	}
	state["damageTaken"] = s.Encounter.DamageTaken
	state["health"] = s.Encounter.EndFightAtHealth
	return state
}

// hint is the spell the rotation would cast next, as soon as the player is free: the global cooldown, a cast and a
// channel are taken as over for the question, then put back. What it would do right now during the global cooldown
// (a move, an attack on the next swing) comes first. Empty without a rotation or before the pull. With it comes the
// index of the rotation's entry that chose it, so the game can light up that line of the priority list.
func (f *liveFight) hint() (string, int) {
	s, p := f.sim, f.player
	f.hintTarget = -1
	if p.Rotation == nil || s.CurrentTime < 0 {
		return "", -1
	}
	if !p.GCD.IsReady(s) && !p.IsCasting(s) && !p.IsChanneling(s) {
		if now, entry := f.nextAction(); now != "" {
			return now, entry
		}
	}
	gcd, hardcast, channel := *p.GCD, p.Hardcast.Expires, p.ChanneledDot
	*p.GCD = core.Timer(0)
	if p.Hardcast.Expires > s.CurrentTime {
		p.Hardcast.Expires = s.CurrentTime
	}
	p.ChanneledDot = nil
	defer func() { *p.GCD, p.Hardcast.Expires, p.ChanneledDot = gcd, hardcast, channel }()
	return f.nextAction()
}

// nextAction is the first entry of the rotation that is ready now, as a spell key ("" when none is), and that entry's
// index in the configured priority list.
func (f *liveFight) nextAction() (string, int) {
	s, p := f.sim, f.player
	configIdx := p.Rotation.PriorityConfigIndexes()
	for i, action := range p.Rotation.PriorityList() {
		if !action.IsReady(s) {
			continue
		}
		// The parsed entry does not say which spell a "channel spell" casts, or where a "move" goes; the config does.
		var config *proto.APLAction
		entry := -1
		if i < len(configIdx) && configIdx[i] < len(f.rotation.GetPriorityList()) {
			entry = configIdx[i]
			config = f.rotation.PriorityList[entry].GetAction()
		}
		if ch := config.GetChannelSpell(); ch != nil {
			if spell := f.spellFor(ch.SpellId); spell != nil && spell.IsReady(s) {
				return key(spell.ActionID), entry
			}
			continue
		}
		if yards, ok := moveRange(config); ok {
			return moveKey(yards), entry
		}
		if config.GetCastPaladinPrimarySeal() != nil {
			if spell := primarySeal(action); spell != nil {
				return key(spell.ActionID), entry
			}
			continue
		}
		// "Autocast other cooldowns" names no spell: it is the first major cooldown that is ready.
		if strings.HasSuffix(action.String(), "Autocast Other Cooldowns") {
			for _, mcd := range p.GetMajorCooldowns() {
				if mcd.IsReady(s) && mcd.Spell.Flags.Matches(core.SpellFlagAPL) && mcd.Spell.CanCast(s, p.CurrentTarget) &&
					!mcd.Type.Matches(core.CooldownTypeSurvival) && (mcd.ShouldActivate == nil || mcd.ShouldActivate(s, p)) {
					return key(mcd.Spell.ActionID), entry
				}
			}
			continue
		}
		for _, spell := range action.GetAllSpells() {
			if spell.IsReady(s) && spell.Flags.Matches(core.SpellFlagAPL) {
				f.hintTarget = slices.Index(s.Encounter.TargetUnits, multidotTarget(action))
				return key(spell.ActionID), entry
			}
		}
	}
	return "", -1
}
