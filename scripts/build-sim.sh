#!/usr/bin/env bash
# Builds the WoW Forever sim (https://github.com/gunba/wow-forever-sim, MIT) to WebAssembly and copies what the game
# needs into public/sim/: lib.wasm, Go's wasm_exec.js, the class presets and the sim's licence.
# The sim version is pinned in sim.lock.json. Needs Go, git, curl and unzip; protoc is downloaded if missing.
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT=$PWD
REPO=$(node -p "require('./sim.lock.json').repo")
COMMIT=$(node -p "require('./sim.lock.json').commit")
SRC=$ROOT/.sim-src/wow-forever-sim
OUT=$ROOT/public/sim
PROTOC_VERSION=29.3

if [ ! -d "$SRC/.git" ]; then
  mkdir -p "$SRC"
  git -C "$SRC" init -q
  git -C "$SRC" remote add origin "$REPO"
fi
if [ "$(git -C "$SRC" rev-parse HEAD 2>/dev/null || true)" != "$COMMIT" ]; then
  git -C "$SRC" fetch -q --depth 1 origin "$COMMIT"
  git -C "$SRC" checkout -q --force FETCH_HEAD
fi

if ! command -v protoc >/dev/null; then
  PROTOC_DIR=$ROOT/.sim-src/protoc
  if [ ! -x "$PROTOC_DIR/bin/protoc" ]; then
    mkdir -p "$PROTOC_DIR"
    curl -sSL -o "$PROTOC_DIR/protoc.zip" \
      "https://github.com/protocolbuffers/protobuf/releases/download/v$PROTOC_VERSION/protoc-$PROTOC_VERSION-linux-x86_64.zip"
    unzip -qo "$PROTOC_DIR/protoc.zip" -d "$PROTOC_DIR"
  fi
  export PATH=$PROTOC_DIR/bin:$PATH
fi
export PATH=$(go env GOPATH)/bin:$PATH
if ! command -v protoc-gen-go >/dev/null; then
  (cd "$SRC" && go install google.golang.org/protobuf/cmd/protoc-gen-go@v1.36.6)
fi

(cd "$SRC" && protoc -I=./proto --go_out=./sim/core ./proto/*.proto)
mkdir -p "$OUT/presets"
(cd "$SRC" && GOOS=js GOARCH=wasm go build -tags with_db -o "$OUT/lib.wasm" ./sim/wasm/)
WASM_EXEC=$(go env GOROOT)/lib/wasm/wasm_exec.js
[ -f "$WASM_EXEC" ] || WASM_EXEC=$(go env GOROOT)/misc/wasm/wasm_exec.js
cp "$WASM_EXEC" "$OUT/wasm_exec.js"
cp "$SRC/LICENSE" "$OUT/LICENSE-wow-forever-sim.txt"

# Presets: one file per class, holding the sim's ranked profile for each race.
node "$ROOT/scripts/collect-presets.mjs" "$SRC" "$OUT/presets"
echo "{\"repo\":\"$REPO\",\"commit\":\"$COMMIT\"}" > "$OUT/version.json"
echo "Sim built: $OUT"
