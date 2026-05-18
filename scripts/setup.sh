#!/bin/bash
# =============================================================
# setup.sh — Run ONCE on Hostzinger to generate all ZK artefacts
#
# What this does:
#   1. Installs circom compiler
#   2. Compiles both Circom circuits → .wasm + .r1cs
#   3. Downloads Powers of Tau (public trusted setup from Hermez)
#   4. Generates proving keys (.zkey) for both circuits
#   5. Exports verification keys (JSON) for both circuits
#   6. Exports Solidity verifier contracts for both circuits
#   7. Copies .wasm + .zkey to frontend/public/ for browser use
#
# Run from project root:
#   chmod +x scripts/setup.sh && ./scripts/setup.sh
# =============================================================

set -e  # exit on any error

echo ""
echo "╔══════════════════════════════════════════════════════╗"
echo "║   ASL ZK Chain — Circuit Setup                       ║"
echo "╚══════════════════════════════════════════════════════╝"
echo ""

# ── Step 1: Install circom ────────────────────────────────────
echo "▶ [1/7] Installing circom compiler..."
if ! command -v circom &> /dev/null; then
  curl -L https://github.com/iden3/circom/releases/latest/download/circom-linux-amd64 \
    -o /tmp/circom-bin
  chmod +x /tmp/circom-bin
  sudo mv /tmp/circom-bin /usr/local/bin/circom
  echo "    ✓ circom installed"
else
  echo "    ✓ circom already installed ($(circom --version))"
fi

# ── Step 2: Install snarkjs ───────────────────────────────────
echo "▶ [2/7] Installing snarkjs..."
npm install -g snarkjs 2>/dev/null || true
echo "    ✓ snarkjs ready"

# ── Step 3: Download circomlib ────────────────────────────────
echo "▶ [3/7] Setting up circomlib..."
if [ ! -d "node_modules/circomlib" ]; then
  npm install
fi
# Copy required circomlib files to circuits/lib/
cp node_modules/circomlib/circuits/poseidon.circom    circuits/lib/
cp node_modules/circomlib/circuits/poseidon_constants.circom circuits/lib/ 2>/dev/null || true
cp node_modules/circomlib/circuits/comparators.circom circuits/lib/
cp node_modules/circomlib/circuits/bitify.circom      circuits/lib/
cp node_modules/circomlib/circuits/aliascheck.circom  circuits/lib/ 2>/dev/null || true
echo "    ✓ circomlib files ready"

mkdir -p build frontend/public

# ── Step 4: Compile circuits ──────────────────────────────────
echo "▶ [4/7] Compiling circuits..."

echo "    Compiling allocation_upstream.circom..."
circom circuits/allocation_upstream.circom \
  --r1cs --wasm --sym \
  -o build/
echo "    ✓ Upstream circuit compiled"

echo "    Compiling allocation_downstream.circom..."
circom circuits/allocation_downstream.circom \
  --r1cs --wasm --sym \
  -o build/
echo "    ✓ Downstream circuit compiled"

# ── Step 5: Download Powers of Tau ───────────────────────────
echo "▶ [5/7] Downloading Powers of Tau (Hermez ceremony, public)..."
if [ ! -f "build/pot14.ptau" ]; then
  # pot14 supports circuits up to 2^14 = 16384 constraints
  # Our circuits are small (~500 constraints) so pot12 is fine
  curl -L https://hermez.s3-eu-west-1.amazonaws.com/powersOfTau28_hez_final_12.ptau \
    -o build/pot14.ptau \
    --progress-bar
  echo "    ✓ Powers of Tau downloaded"
else
  echo "    ✓ Powers of Tau already present"
fi

# ── Step 6: Generate proving keys (.zkey) ────────────────────
echo "▶ [6/7] Generating proving keys..."

echo "    Upstream proving key..."
# Phase 1: powers of tau
npx snarkjs groth16 setup \
  build/allocation_upstream.r1cs \
  build/pot14.ptau \
  build/upstream_0.zkey

# Phase 2: circuit-specific contribution
# In production: run a real ceremony with multiple contributors
# For POC: single random contribution is sufficient
echo "poc-contribution-upstream" | npx snarkjs zkey contribute \
  build/upstream_0.zkey \
  build/upstream.zkey \
  --name="POC contribution" -v 2>/dev/null

echo "    ✓ Upstream proving key ready"

echo "    Downstream proving key..."
npx snarkjs groth16 setup \
  build/allocation_downstream.r1cs \
  build/pot14.ptau \
  build/downstream_0.zkey

echo "poc-contribution-downstream" | npx snarkjs zkey contribute \
  build/downstream_0.zkey \
  build/downstream.zkey \
  --name="POC contribution" -v 2>/dev/null

echo "    ✓ Downstream proving key ready"

# ── Step 7: Export verification keys ─────────────────────────
echo "▶ [7/7] Exporting verification keys and Solidity verifiers..."

npx snarkjs zkey export verificationkey \
  build/upstream.zkey build/upstream_vk.json
echo "    ✓ Upstream verification key exported"

npx snarkjs zkey export verificationkey \
  build/downstream.zkey build/downstream_vk.json
echo "    ✓ Downstream verification key exported"

npx snarkjs zkey export solidityverifier \
  build/upstream.zkey contracts/UpstreamVerifier.sol
echo "    ✓ UpstreamVerifier.sol generated"

npx snarkjs zkey export solidityverifier \
  build/downstream.zkey contracts/DownstreamVerifier.sol
echo "    ✓ DownstreamVerifier.sol generated"

# ── Copy artefacts for browser use ───────────────────────────
echo ""
echo "▶ Copying artefacts to frontend/public/..."
mkdir -p frontend/public

cp build/allocation_upstream_js/allocation_upstream.wasm \
   frontend/public/upstream.wasm
cp build/allocation_downstream_js/allocation_downstream.wasm \
   frontend/public/downstream.wasm
cp build/upstream.zkey     frontend/public/upstream.zkey
cp build/downstream.zkey   frontend/public/downstream.zkey
cp build/upstream_vk.json  frontend/public/upstream_vk.json
cp build/downstream_vk.json frontend/public/downstream_vk.json

echo "    ✓ Browser artefacts ready in frontend/public/"

echo ""
echo "╔══════════════════════════════════════════════════════╗"
echo "║   Setup complete!                                     ║"
echo "║                                                       ║"
echo "║   Next steps:                                         ║"
echo "║   1. cp .env.example .env  (fill in Sepolia RPC +    ║"
echo "║      private key)                                     ║"
echo "║   2. npx hardhat deploy --network sepolia             ║"
echo "║   3. Paste contract address into frontend/config.js   ║"
echo "║   4. Open frontend/index.html in browser              ║"
echo "╚══════════════════════════════════════════════════════╝"
echo ""
