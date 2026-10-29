module beatthesim/engine

go 1.24

require (
	github.com/wowsims/classic v0.0.0
	google.golang.org/protobuf v1.36.6
)

require golang.org/x/exp v0.0.0-20250620022241-b7579e27df2b // indirect

// The sim's source, fetched at the commit in sim.lock.json by scripts/build-sim.sh.
replace github.com/wowsims/classic => ../.sim-src/wow-forever-sim
