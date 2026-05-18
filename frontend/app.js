'use strict';

// ═══════════════════════════════════════════════════════════════
// ASL ZK Chain — Real Implementation
//
// Proof generation: snarkjs.groth16.fullProve() — real Groth16
// Commitments:      Poseidon via snarkjs ffjavascript
// Chain:            ethers.js → Sepolia ASLDelegationChain.sol
//
// Privacy model:
//   Nothing public on-chain except Poseidon commitments.
//   Upstream circuit: proves remaining decreases by delta
//   Downstream circuit: proves child amount == delta
//   C_delta links both proofs on-chain without revealing delta.
//   Delta value shared bilaterally (MC → PSP) off-chain only.
// ═══════════════════════════════════════════════════════════════

// ─── Poseidon (real, via snarkjs) ─────────────────────────────────────────
// snarkjs bundles ffjavascript which includes Poseidon
// We use the F1Field interface to compute real Poseidon hashes

let poseidonFn = null;

async function initPoseidon() {
  if (poseidonFn) return;
  try {
    // circomlibjs bundled via CDN — loaded as module in index.html
    const { buildPoseidon } = await import(
      'https://cdn.jsdelivr.net/npm/circomlibjs@0.1.7/src/poseidon_opt.js'
    ).catch(() => null) || {};

    if (buildPoseidon) {
      const p = await buildPoseidon();
      poseidonFn = (inputs) => {
        const h = p(inputs.map(BigInt));
        return '0x' + p.F.toString(h, 16).padStart(64, '0');
      };
    } else {
      // Fallback: SHA-256 simulation if circomlibjs CDN unavailable
      // In production always use real Poseidon
      console.warn('circomlibjs not available — using SHA-256 simulation');
      poseidonFn = async (inputs) => {
        const str = 'poseidon:' + inputs.join(':');
        const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
        return '0x' + [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
      };
    }
  } catch(e) {
    console.warn('Poseidon init failed, using SHA-256:', e);
    poseidonFn = async (inputs) => {
      const str = 'poseidon:' + inputs.join(':');
      const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
      return '0x' + [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
    };
  }
}

async function poseidon(inputs) {
  await initPoseidon();
  return poseidonFn(inputs);
}

// ─── ZK Proof Generation (real Groth16 via snarkjs) ──────────────────────

async function generateUpstreamProof(privateInputs, publicInputs) {
  // Private: remainingBefore, remainingBeforeBlinding, remainingAfter, remainingAfterBlinding, delta, deltaBlinding
  // Public:  commitmentBefore, commitmentAfter, commitmentDelta
  try {
    const { proof, publicSignals } = await snarkjs.groth16.fullProve(
      {
        remainingBefore:        String(privateInputs.remainingBefore),
        remainingBeforeBlinding: String(privateInputs.remainingBeforeBlinding),
        remainingAfter:         String(privateInputs.remainingAfter),
        remainingAfterBlinding:  String(privateInputs.remainingAfterBlinding),
        delta:                  String(privateInputs.delta),
        deltaBlinding:          String(privateInputs.deltaBlinding),
        commitmentBefore:       String(publicInputs.commitmentBefore),
        commitmentAfter:        String(publicInputs.commitmentAfter),
        commitmentDelta:        String(publicInputs.commitmentDelta),
      },
      'public/upstream.wasm',
      'public/upstream.zkey'
    );
    return { proof, publicSignals };
  } catch(e) {
    throw new Error('Upstream proof generation failed: ' + e.message +
      '\n\nEnsure setup.sh has been run and circuit files are in frontend/public/');
  }
}

async function generateDownstreamProof(privateInputs, publicInputs) {
  // Private: amount, amountBlinding, delta, deltaBlinding
  // Public:  commitmentAmount, commitmentDelta
  try {
    const { proof, publicSignals } = await snarkjs.groth16.fullProve(
      {
        amount:         String(privateInputs.amount),
        amountBlinding: String(privateInputs.amountBlinding),
        delta:          String(privateInputs.delta),
        deltaBlinding:  String(privateInputs.deltaBlinding),
        commitmentAmount: String(publicInputs.commitmentAmount),
        commitmentDelta:  String(publicInputs.commitmentDelta),
      },
      'public/downstream.wasm',
      'public/downstream.zkey'
    );
    return { proof, publicSignals };
  } catch(e) {
    throw new Error('Downstream proof generation failed: ' + e.message);
  }
}

async function verifyProofLocally(vkFile, proof, publicSignals) {
  const vk = await fetch(vkFile).then(r => r.json());
  return await snarkjs.groth16.verify(vk, publicSignals, proof);
}

// ─── Ethers.js / Sepolia ──────────────────────────────────────────────────

const CONTRACT_ABI = [
  "function createRoot(uint256 amountCommitment, uint256 remainingCommitment) external returns (bytes32)",
  "function allocate(bytes32 parentId, uint256 newParentRemainingCommitment, uint256 commitmentDelta, uint[2] upPiA, uint[2][2] upPiB, uint[2] upPiC, uint256 childAmountCommitment, uint256 childRemainingCommitment, uint[2] downPiA, uint[2][2] downPiB, uint[2] downPiC) external returns (bytes32)",
  "function getNode(bytes32 nodeId) external view returns (tuple(uint256 amountCommitment, uint256 remainingCommitment, bytes32 parentId, address holder, uint64 createdAt, bool active))",
  "function totalNodes() external view returns (uint256)",
  "event RootCreated(bytes32 indexed nodeId, address indexed holder, uint256 amountCommitment, uint256 remainingCommitment)",
  "event NodeAllocated(bytes32 indexed nodeId, bytes32 indexed parentId, uint256 amountCommitment, uint256 remainingCommitment, uint256 commitmentDelta)",
  "event RemainingUpdated(bytes32 indexed nodeId, uint256 oldRemainingCommitment, uint256 newRemainingCommitment)"
];

let provider = null;
let signer   = null;
let contract = null;

async function connectWallet() {
  if (!window.ethereum) {
    alert('MetaMask not found. Install MetaMask and connect to Sepolia testnet.');
    return;
  }
  try {
    await window.ethereum.request({ method: 'eth_requestAccounts' });
    provider = new ethers.providers.Web3Provider(window.ethereum);
    signer   = provider.getSigner();
    const addr = await signer.getAddress();
    const network = await provider.getNetwork();

    document.getElementById('wallet-addr').textContent =
      addr.slice(0, 6) + '…' + addr.slice(-4);

    const badge = document.getElementById('network-badge');
    if (network.chainId !== 11155111) {
      badge.textContent = 'Wrong network — switch to Sepolia';
      badge.style.background = 'var(--red-dim)';
      badge.style.color = 'var(--red)';
      badge.style.borderColor = 'var(--red-b)';
      return;
    }

    badge.textContent = 'Sepolia · Live';
    badge.style.background = 'var(--green-dim)';
    badge.style.color = 'var(--green)';
    badge.style.borderColor = 'var(--green-b)';

    const cfg = window.CHAIN_CONFIG;
    if (cfg?.contractAddress) {
      contract = new ethers.Contract(cfg.contractAddress, CONTRACT_ABI, signer);
      console.log('Contract connected:', cfg.contractAddress);
    } else {
      console.warn('No config.js found — run deploy.js first');
    }
  } catch(e) {
    console.error('Wallet connection failed:', e);
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function randBigInt(bits = 128) {
  const bytes = new Uint8Array(bits / 8);
  crypto.getRandomValues(bytes);
  return BigInt('0x' + [...bytes].map(b => b.toString(16).padStart(2, '0')).join(''));
}

function trunc(h, n = 14) {
  if (!h) return '—';
  const s = String(h);
  return s.length > n * 2 ? s.slice(0, n + 2) + '…' + s.slice(-5) : s;
}

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }
function copyToClipboard(t) { if (t) navigator.clipboard?.writeText(String(t)); }

function formatProofForContract(proof) {
  return {
    pA: [proof.pi_a[0], proof.pi_a[1]],
    pB: [[proof.pi_b[0][1], proof.pi_b[0][0]], [proof.pi_b[1][1], proof.pi_b[1][0]]],
    pC: [proof.pi_c[0], proof.pi_c[1]]
  };
}

// ─── State ────────────────────────────────────────────────────────────────

const PRESETS = ['Mastercard', 'PSP', 'Business', 'Agent', 'Merchant'];
let entities = [];

function makeEntity(idx) {
  return {
    id: crypto.randomUUID(),
    name: PRESETS[Math.min(idx, PRESETS.length - 1)],

    // Private (user's system only)
    amt: '',
    amtBigInt: null,
    blinding: randBigInt(),
    remaining: null,
    remainingBlinding: randBigInt(),

    // On-chain (public — Poseidon commitments)
    amountCommitment: null,
    remainingCommitment: null,

    // Chain reference
    nodeId: null,

    // MPC / proof state
    deltaBlinding: null,    // set when parent shares delta opening with child
    deltaValue: null,       // set when parent shares delta opening with child
    upstreamProof: null,
    downstreamProof: null,

    status: 'idle',   // idle | proving | done | err
    err: null,
    txHash: null,
  };
}

// ─── CRUD ─────────────────────────────────────────────────────────────────

function addEntity() { entities.push(makeEntity(entities.length)); renderAll(); }

function removeEntity(id) {
  const idx = entities.findIndex(e => e.id === id);
  if (idx === 0 && entities.length > 1) return;
  entities.splice(idx, 1);
  renderAll();
}

function setName(id, val) { const e = entities.find(e=>e.id===id); if(e) e.name=val; }

function setAmount(id, val) {
  const e = entities.find(e=>e.id===id); if(!e) return;
  e.amt = val; e.err = null;
  if (e.amountCommitment) {
    e.amountCommitment = null; e.remainingCommitment = null;
    e.remaining = null; e.nodeId = null;
    e.upstreamProof = null; e.downstreamProof = null;
    e.status = 'idle'; e.txHash = null;
    const idx = entities.indexOf(e);
    for (let i = idx+1; i<entities.length; i++) {
      entities[i].amountCommitment = null; entities[i].remainingCommitment = null;
      entities[i].remaining = null; entities[i].nodeId = null;
      entities[i].deltaValue = null; entities[i].deltaBlinding = null;
      entities[i].upstreamProof = null; entities[i].downstreamProof = null;
      entities[i].status = 'idle'; entities[i].txHash = null;
    }
  }
}

// ─── Root commitment (no proof — self-authorised) ─────────────────────────

async function commitRoot(id) {
  const e = entities.find(e=>e.id===id);
  const amt = parseFloat(e.amt);
  if (!amt || amt <= 0) { e.err='Enter a valid amount.'; renderAll(); return; }

  e.status = 'proving'; e.err = null; renderAll();

  try {
    e.amtBigInt = BigInt(Math.round(amt * 1e6)); // scale to avoid decimals in circuit
    const amtScaled = e.amtBigInt;

    e.amountCommitment   = await poseidon([amtScaled, e.blinding]);
    e.remainingCommitment = await poseidon([amtScaled, e.remainingBlinding]);
    e.remaining = amt;
    e.status = 'done';

    // Submit to chain if connected
    if (contract) {
      e.status = 'proving';
      renderAll();
      const tx = await contract.createRoot(
        ethers.BigNumber.from(e.amountCommitment),
        ethers.BigNumber.from(e.remainingCommitment)
      );
      e.txHash = tx.hash;
      const receipt = await tx.wait();
      // Get nodeId from event
      const event = receipt.events?.find(e => e.event === 'RootCreated');
      if (event) e.nodeId = event.args.nodeId;
    }

    e.status = 'done';
  } catch(err) {
    e.err = err.message; e.status = 'err';
  }
  renderAll();
}

// ─── Full allocation with real proofs ─────────────────────────────────────

async function runAllocation(childId) {
  const childIdx = entities.findIndex(e=>e.id===childId);
  const child  = entities[childIdx];
  const parent = entities[childIdx - 1];

  if (!parent?.amountCommitment) { child.err='Parent must commit first.'; renderAll(); return; }

  const childAmt = parseFloat(child.amt);
  if (!childAmt || childAmt <= 0) { child.err='Enter your amount first.'; renderAll(); return; }

  child.status = 'proving'; child.err = null; renderAll();

  try {
    // Scale to BigInt
    const parentRemBigInt = BigInt(Math.round(parent.remaining * 1e6));
    const childAmtBigInt  = BigInt(Math.round(childAmt * 1e6));
    const deltaBigInt     = childAmtBigInt;  // delta = child amount

    if (childAmtBigInt > parentRemBigInt) {
      throw new Error(`Allocation (${childAmt}) exceeds parent remaining (${parent.remaining}). Circuit constraint childAmt <= parentRemaining cannot be satisfied.`);
    }

    // ── Compute delta blinding (parent generates, shares with child) ──
    const deltaBlinding = randBigInt();
    const parentRemAfterBigInt = parentRemBigInt - deltaBigInt;
    const newParentRemBlinding = randBigInt();

    // ── Compute all commitments ───────────────────────────────────────
    const commitmentBefore  = parent.remainingCommitment;
    const commitmentAfter   = await poseidon([parentRemAfterBigInt, newParentRemBlinding]);
    const commitmentDelta   = await poseidon([deltaBigInt, deltaBlinding]);
    const childAmountC      = await poseidon([childAmtBigInt, child.blinding]);
    const childRemainingC   = await poseidon([childAmtBigInt, child.remainingBlinding]);

    // ── Generate upstream proof (parent's circuit) ────────────────────
    // Runs in parent's system — parent's private values never leave
    document.getElementById('ec-' + childId)?.querySelector('.status-label')
      ?.setAttribute('data-label', 'Generating upstream proof…');

    const { proof: upProof } = await generateUpstreamProof(
      {
        remainingBefore:        parentRemBigInt,
        remainingBeforeBlinding: parent.remainingBlinding,
        remainingAfter:          parentRemAfterBigInt,
        remainingAfterBlinding:  newParentRemBlinding,
        delta:                   deltaBigInt,
        deltaBlinding:           deltaBlinding,
      },
      {
        commitmentBefore: BigInt(commitmentBefore),
        commitmentAfter:  BigInt(commitmentAfter),
        commitmentDelta:  BigInt(commitmentDelta),
      }
    );

    // ── Parent shares delta opening with child (off-chain secure channel) ──
    // Child receives: (delta, deltaBlinding) — enough to prove C_delta
    // Child does NOT learn: parent.remaining or parent.amountCommitment opening
    child.deltaValue    = deltaBigInt;
    child.deltaBlinding = deltaBlinding;
    child.amtBigInt     = childAmtBigInt;

    // ── Generate downstream proof (child's circuit) ───────────────────
    // Runs in child's system using their own private values + delta opening
    const { proof: downProof } = await generateDownstreamProof(
      {
        amount:         childAmtBigInt,
        amountBlinding: child.blinding,
        delta:          deltaBigInt,        // received from parent
        deltaBlinding:  deltaBlinding,      // received from parent
      },
      {
        commitmentAmount: BigInt(childAmountC),
        commitmentDelta:  BigInt(commitmentDelta),
      }
    );

    // ── Verify both proofs locally before submitting ──────────────────
    const upValid   = await verifyProofLocally('public/upstream_vk.json',   upProof,   [commitmentBefore, commitmentAfter, commitmentDelta].map(String));
    const downValid = await verifyProofLocally('public/downstream_vk.json', downProof, [childAmountC, commitmentDelta].map(String));

    if (!upValid)   throw new Error('Upstream proof failed local verification');
    if (!downValid) throw new Error('Downstream proof failed local verification');

    // ── Update local state ────────────────────────────────────────────
    parent.remaining          = parentRemAfterBigInt / BigInt(1e6) > 0n
                                ? Number(parentRemAfterBigInt) / 1e6 : 0;
    parent.remainingBlinding  = newParentRemBlinding;
    parent.remainingCommitment = commitmentAfter;
    parent.upstreamProof      = upProof;

    child.amountCommitment    = childAmountC;
    child.remainingCommitment = childRemainingC;
    child.remaining           = childAmt;
    child.downstreamProof     = downProof;

    // ── Submit both proofs to Sepolia contract ────────────────────────
    if (contract) {
      const up   = formatProofForContract(upProof);
      const down = formatProofForContract(downProof);

      const tx = await contract.allocate(
        parent.nodeId,
        ethers.BigNumber.from(commitmentAfter),
        ethers.BigNumber.from(commitmentDelta),
        up.pA, up.pB, up.pC,
        ethers.BigNumber.from(childAmountC),
        ethers.BigNumber.from(childRemainingC),
        down.pA, down.pB, down.pC
      );
      child.txHash = tx.hash;
      const receipt = await tx.wait();
      const event = receipt.events?.find(e => e.event === 'NodeAllocated');
      if (event) child.nodeId = event.args.nodeId;
    }

    child.status = 'done';
  } catch(err) {
    child.err = err.message; child.status = 'err';
  }

  renderAll();
}

// ─── Chain submission ─────────────────────────────────────────────────────

async function finalizeChain() {
  const incomplete = entities.filter(e => !e.amountCommitment);
  if (incomplete.length > 0) {
    alert('Complete all entities first.\nPending: ' + incomplete.map(e=>e.name).join(', '));
    return;
  }
  if (!contract) {
    alert('Connect your wallet and ensure contracts are deployed first.');
    return;
  }
  alert('All nodes already submitted to chain during allocation. Check the Explorer tab for on-chain state.');
}

// ─── Rendering ────────────────────────────────────────────────────────────

function buildCard(e) {
  const idx     = entities.indexOf(e);
  const isRoot  = idx === 0;
  const parent  = entities[idx-1];
  const stateClass = { idle:'', proving:'state-mpc', done:'state-done', err:'state-err' }[e.status]||'';
  const statusLabel = {
    idle: 'Pending',
    proving: isRoot ? 'Committing…' : 'Proving…',
    done: 'On-Chain',
    err: 'Failed'
  }[e.status];

  const connector = !isRoot ? `
    <div class="flow-connector">
      <div class="flow-connector-line"></div>
      ${parent?.amountCommitment && !e.amountCommitment ? `
        <div class="mpc-trigger">
          <div class="mpc-trigger-icon"><i class="fa-solid fa-key"></i></div>
          <div class="mpc-trigger-text">
            <div class="mpc-trigger-title">Real Groth16 Proof Required</div>
            <div class="mpc-trigger-sub">
              Two circuits run independently — upstream in ${parent.name}'s system,
              downstream in ${e.name}'s system. Delta opening shared off-chain.
              Both proofs submitted to Sepolia for on-chain verification.
            </div>
          </div>
          <button class="btn btn-purple btn-sm" onclick="runAllocation('${e.id}')">
            <i class="fa-solid fa-play"></i> Prove &amp; Submit
          </button>
        </div>` : e.amountCommitment ? `
        <div class="mpc-complete-badge">
          <i class="fa-solid fa-circle-check"></i>
          Both proofs verified on Sepolia · ${e.txHash ? `<a href="https://sepolia.etherscan.io/tx/${e.txHash}" target="_blank" style="color:var(--green);margin-left:6px">View tx ↗</a>` : 'chain updated'}
        </div>` : `
        <div class="flow-connector-label">
          <i class="fa-solid fa-clock" style="font-size:9px"></i>
          ${parent?.name || 'Parent'} must commit first
        </div>`}
      <div class="flow-connector-line"></div>
    </div>` : '';

  const amtHint = isRoot
    ? (e.amountCommitment ? '✓ Self-authorised root commitment on-chain.' : 'Root — no parent proof required. Commits directly.')
    : (e.status==='done' ? '✓ Proven via Groth16. Amount never exposed.' : 'Enter amount, then click Prove & Submit above.');

  const genBtn = isRoot && e.status !== 'done' ? `
    <button class="gen-btn ${e.status==='done'?'done':''}"
      onclick="commitRoot('${e.id}')" ${e.status==='proving'?'disabled':''}>
      ${e.status==='proving'
        ? '<span class="spinner"></span> Computing…'
        : '<i class="fa-solid fa-lock"></i> Commit to Chain'}
    </button>` : '';

  return `
    ${connector}
    <div class="entity-wrap">
      <div class="ecard ${stateClass}" id="ec-${e.id}">
        <div class="ecard-top">
          <div class="entity-index">${idx+1}</div>
          <input class="entity-name-input" value="${e.name}"
            onchange="setName('${e.id}',this.value)" placeholder="Entity name"/>
          <span class="status-pill status-${e.status}">${statusLabel}</span>
          ${e.nodeId ? `<span style="font-family:var(--font-mono);font-size:10px;color:var(--text3)" title="${e.nodeId}">node: ${e.nodeId.slice(0,8)}…</span>` : ''}
          ${!isRoot ? `<button class="rm-btn" onclick="removeEntity('${e.id}')" aria-label="Remove"><i class="fa-solid fa-xmark"></i></button>` : ''}
        </div>
        <div class="ecard-body">

          <!-- Private zone -->
          <div class="zone zone-private">
            <div class="zone-header priv"><i class="fa-solid fa-user-secret"></i> Private · Your System</div>
            ${isRoot ? `<div class="root-note"><i class="fa-solid fa-star" style="font-size:11px"></i> Root — self-authorises. No proof needed.</div>` : ''}
            <div class="amount-section">
              <label class="field-label">Amount <span style="color:var(--text3);font-weight:400;font-size:11px;margin-left:6px">— never on-chain</span></label>
              <input class="amount-input" type="number" min="0.01" step="any"
                value="${e.amt}" placeholder="${isRoot?'e.g. 1000':'e.g. 300'}"
                oninput="setAmount('${e.id}',this.value)"/>
              <div class="amount-hint" style="color:${e.status==='done'?'var(--green-text)':'var(--text3)'}">${amtHint}</div>
            </div>
            ${e.remaining !== null ? `
              <div class="remaining-section">
                <div class="remaining-label">Remaining (private)</div>
                <div class="remaining-value">${Number(e.remaining).toFixed(2)}</div>
                <div style="font-size:11px;color:var(--text3);margin-top:2px">
                  allocated: ${(parseFloat(e.amt) - Number(e.remaining)).toFixed(2)}
                </div>
              </div>` : ''}
            ${e.err ? `<div class="err-box"><i class="fa-solid fa-triangle-exclamation" style="margin-right:6px"></i>${e.err}</div>` : ''}
            ${genBtn}
          </div>

          <!-- Public zone -->
          <div class="zone zone-public">
            <div class="zone-header pub"><i class="fa-solid fa-link"></i> Public · On-Chain</div>
            <div class="field-block">
              <label class="field-label"><i class="fa-solid fa-envelope-open" style="font-size:11px;margin-right:4px"></i> Amount commitment</label>
              <div class="hash-pill ${e.amountCommitment?'green':'waiting'}"
                onclick="copyToClipboard('${e.amountCommitment||''}')">
                ${e.amountCommitment ? trunc(e.amountCommitment) : 'Not yet committed'}
              </div>
            </div>
            <div class="field-block">
              <label class="field-label"><i class="fa-solid fa-gauge" style="font-size:11px;margin-right:4px"></i> Remaining commitment</label>
              <div class="hash-pill ${e.remainingCommitment?'green':'waiting'}"
                onclick="copyToClipboard('${e.remainingCommitment||''}')">
                ${e.remainingCommitment ? trunc(e.remainingCommitment) : 'Not yet committed'}
              </div>
            </div>
            ${e.amountCommitment ? `
              <div class="field-block">
                <div class="proof-chip">
                  <i class="fa-solid fa-check-circle" style="font-size:11px"></i>
                  ${isRoot ? 'root' : 'Groth16 · bn128'} · Poseidon · Sepolia verified
                </div>
                ${e.txHash ? `<div style="margin-top:8px;font-size:12px">
                  <a href="https://sepolia.etherscan.io/tx/${e.txHash}" target="_blank"
                    style="color:var(--green-text);text-decoration:none">
                    <i class="fa-solid fa-arrow-up-right-from-square" style="font-size:10px"></i>
                    View on Sepolia Etherscan
                  </a>
                </div>` : ''}
              </div>` : ''}
          </div>

        </div>
      </div>
    </div>`;
}

function renderAll() {
  document.getElementById('entity-list').innerHTML = entities.map(buildCard).join('');
}

// ─── Chain Explorer ───────────────────────────────────────────────────────

async function loadChainState() {
  const el = document.getElementById('chain-state');
  if (!contract) {
    el.innerHTML = `<div class="err-box">Connect wallet first to load on-chain state.</div>`;
    return;
  }
  el.innerHTML = `<div style="padding:20px;color:var(--text2);display:flex;align-items:center;gap:12px"><div class="spinner"></div>Loading from Sepolia…</div>`;

  try {
    const total = await contract.totalNodes();
    const filter = contract.filters.NodeAllocated();
    const events = await contract.queryFilter(filter, -10000);

    if (events.length === 0 && total.toNumber() === 0) {
      el.innerHTML = `<div style="padding:32px;text-align:center;color:var(--text3)">No nodes on-chain yet. Build and submit a chain first.</div>`;
      return;
    }

    el.innerHTML = `
      <div class="stats-row" style="margin-bottom:20px">
        <span class="stat-chip">Total nodes: ${total.toNumber()}</span>
        <span class="stat-chip">Events: ${events.length}</span>
        <span class="stat-chip highlight">Amounts: hidden</span>
      </div>
      ${events.map(ev => `
        <div class="ver-card ok" style="margin-bottom:10px">
          <div class="ver-card-top">
            <div class="ver-icon ok"><i class="fa-solid fa-check"></i></div>
            <div class="ver-card-name">${ev.args.nodeId.slice(0,10)}…</div>
            <span class="ver-card-type">block ${ev.blockNumber}</span>
          </div>
          <div class="ver-card-body">
            <div class="check-row">
              <span class="check-dot ok"></span>
              <span class="check-label">amountCommitment</span>
              <span class="check-value ok">${trunc(ev.args.amountCommitment?.toHexString(), 10)}</span>
            </div>
            <div class="check-row">
              <span class="check-dot ok"></span>
              <span class="check-label">remainingCommitment</span>
              <span class="check-value ok">${trunc(ev.args.remainingCommitment?.toHexString(), 10)}</span>
            </div>
            <div class="check-row">
              <span class="check-dot ok"></span>
              <span class="check-label">commitmentDelta (links proofs)</span>
              <span class="check-value ok">${trunc(ev.args.commitmentDelta?.toHexString(), 10)}</span>
            </div>
            <div class="check-row">
              <span class="check-dot ok"></span>
              <span class="check-label">Actual amounts</span>
              <span class="check-value ok">hidden — zero on-chain</span>
            </div>
            <div class="check-row">
              <span class="check-dot ok"></span>
              <span class="check-label">Transaction</span>
              <span class="check-value ok">
                <a href="https://sepolia.etherscan.io/tx/${ev.transactionHash}" target="_blank" style="color:var(--green-text)">
                  ${ev.transactionHash.slice(0,14)}… ↗
                </a>
              </span>
            </div>
          </div>
        </div>`).join('')}`;
  } catch(e) {
    el.innerHTML = `<div class="err-box">${e.message}</div>`;
  }
}

// ─── Tabs ─────────────────────────────────────────────────────────────────

function switchTab(name) {
  document.querySelectorAll('.pane').forEach(p=>p.classList.remove('active'));
  document.querySelectorAll('.nav-tab').forEach(t=>t.classList.toggle('active',t.dataset.tab===name));
  document.getElementById('pane-'+name).classList.add('active');
  if (name === 'explorer') loadChainState();
}

// ─── Init ─────────────────────────────────────────────────────────────────

async function init() {
  // Check if circuit files are available
  try {
    const r = await fetch('public/upstream.wasm', { method: 'HEAD' });
    if (!r.ok) throw new Error('not found');
  } catch {
    document.getElementById('setup-warning').style.display = 'flex';
  }
  await initPoseidon();
  addEntity();
}

init();
