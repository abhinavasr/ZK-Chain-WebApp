'use strict';

// ═══════════════════════════════════════════════════════════════
// ASL ZK Chain — MPC Edition
//
// Key model:
//   • Each entity has amountCommitment + remainingCommitment
//   • Conservation: parentRemaining = childAmount + parentRemainingAfter
//   • MPC 3-round protocol — neither party learns the other's value
//   • Round 1: blind input commitments (hashes) sent to MPC engine
//   • Round 2: partial witnesses (encrypted shares) sent to MPC engine
//   • Round 3: engine verifies conservation, emits joint Groth16 proof
// ═══════════════════════════════════════════════════════════════

// ─── Crypto ───────────────────────────────────────────────────────────────

async function sha256(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return '0x' + [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2,'0')).join('');
}

function randHex(n = 16) {
  const a = new Uint8Array(n); crypto.getRandomValues(a);
  return '0x' + [...a].map(b => b.toString(16).padStart(2,'0')).join('');
}

function fakeProof() {
  return {
    pi_a: [randHex(32), randHex(32), '1'],
    pi_b: [[randHex(32), randHex(32)], [randHex(32), randHex(32)], ['1','0']],
    pi_c: [randHex(32), randHex(32), '1'],
    protocol: 'groth16', curve: 'bn128'
  };
}

function trunc(h, n = 14) {
  if (!h) return '—';
  return h.length > n*2 ? h.slice(0, n+2) + '…' + h.slice(-5) : h;
}

function copyToClipboard(t) { if (t) navigator.clipboard?.writeText(t); }
function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

// ─── State ────────────────────────────────────────────────────────────────

const PRESETS = ['Mastercard','PSP','Business','Agent','Merchant'];
let entities = [];

function makeEntity(idx) {
  return {
    id: crypto.randomUUID(),
    name: PRESETS[Math.min(idx, PRESETS.length - 1)],

    // Private — never leaves entity's system
    amt: '',
    blinding: randHex(),
    remaining: null,        // starts = amt, decreases as children allocated
    remainingBlinding: randHex(),
    invoiceSecret: randHex(),

    // Public — goes on-chain
    amountCommitment: null,    // commit(amt, blinding) — fixed once set
    remainingCommitment: null, // commit(remaining, remainingBlinding) — updated per child
    proof: null,
    nullifier: null,

    status: 'idle',   // idle | mpc | done | err
    err: null,

    // MPC session state (null until protocol runs between this entity and parent)
    mpc: null,
  };
}

// ─── CRUD ─────────────────────────────────────────────────────────────────

function addEntity() {
  entities.push(makeEntity(entities.length));
  renderAll();
}

function removeEntity(id) {
  const idx = entities.findIndex(e => e.id === id);
  if (idx === 0 && entities.length > 1) return;
  entities.splice(idx, 1);
  renderAll();
  hideExport();
}

function setName(id, val) {
  const e = entities.find(e => e.id === id);
  if (e) e.name = val;
}

// No renderAll() here — rebuilding DOM kills focused input
function setAmount(id, val) {
  const e = entities.find(e => e.id === id);
  if (!e) return;
  e.amt = val; e.err = null;
  if (e.amountCommitment) {
    e.amountCommitment = null; e.remainingCommitment = null;
    e.remaining = null; e.proof = null; e.nullifier = null;
    e.status = 'idle'; e.mpc = null;
    const idx = entities.indexOf(e);
    for (let i = idx + 1; i < entities.length; i++) {
      entities[i].amountCommitment = null; entities[i].remainingCommitment = null;
      entities[i].remaining = null; entities[i].proof = null;
      entities[i].nullifier = null; entities[i].mpc = null;
      entities[i].status = 'idle';
    }
    hideExport();
  }
}

// ─── Root commitment (self-authorised, no MPC needed) ─────────────────────

async function generateRootCommitment(id) {
  const e = entities.find(e => e.id === id);
  if (!e) return;
  const amount = parseFloat(e.amt);
  if (!amount || amount <= 0) { e.err = 'Enter a valid amount.'; renderAll(); return; }
  e.status = 'mpc'; e.err = null; renderAll();
  await delay(500);
  e.amountCommitment    = await sha256('poseidon:' + amount + ':' + e.blinding);
  e.remainingCommitment = await sha256('poseidon:' + amount + ':' + e.remainingBlinding);
  e.remaining = amount;
  e.proof = fakeProof();
  e.status = 'done';
  renderAll(); hideExport();
}

// ─── MPC Protocol ─────────────────────────────────────────────────────────
//
// ROUND 1 — Blind input commitments
//   Upstream  → MPC engine: H(upstream.remaining, nonce_up)
//   Downstream → MPC engine: H(downstream.amount,  nonce_down)
//   Each party sends a hash of their private value. Neither sees the other's hash.
//
// ROUND 2 — Partial witnesses (encrypted shares)
//   Upstream  → MPC engine: H(upstream.remaining, sessionKey)   ← encrypted share
//   Downstream → MPC engine: H(downstream.amount,  sessionKey)  ← encrypted share
//   MPC engine holds both shares. Neither party can extract the other's value.
//
// ROUND 3 — Joint proof generation
//   MPC engine internally checks: upstream.remaining >= downstream.amount
//   MPC engine computes:          upstream.remaining_after = upstream.remaining - downstream.amount
//   MPC engine generates joint Groth16 proof proving conservation constraint.
//   Sends result to chain — neither amount appears in proof.

async function runMPC(childId) {
  const childIdx = entities.findIndex(e => e.id === childId);
  const child = entities[childIdx];
  const parent = entities[childIdx - 1];

  if (!parent || !parent.amountCommitment) {
    child.err = parent.name + ' must commit first.';
    renderAll(); return;
  }

  const childAmt = parseFloat(child.amt);
  if (!childAmt || childAmt <= 0) {
    child.err = 'Enter your amount first.';
    renderAll(); return;
  }

  const parentRemaining = parent.remaining ?? parseFloat(parent.amt);
  const sessionKey = randHex(16);

  // ── INIT MPC SESSION ─────────────────────────────────────────
  child.mpc = {
    round: 1,
    sessionKey,
    upstream: { nonce: randHex(), blindCommit: null, partialWitness: null },
    downstream: { nonce: randHex(), blindCommit: null, partialWitness: null },
    engineLog: [],
    jointProof: null,
    conservationOk: null,
    parentRemainingAfter: null,
  };
  child.status = 'mpc'; child.err = null;
  renderAll();

  // ── ROUND 1 ──────────────────────────────────────────────────
  // Both parties generate blind commitments to their private inputs
  await delay(700);
  child.mpc.upstream.blindCommit   = await sha256('r1:up:'   + parentRemaining + ':' + child.mpc.upstream.nonce);
  child.mpc.downstream.blindCommit = await sha256('r1:down:' + childAmt        + ':' + child.mpc.downstream.nonce);
  child.mpc.engineLog.push('Round 1 complete: 2 blind commits received');
  renderAll();

  // ── ROUND 2 ──────────────────────────────────────────────────
  // Both parties send partial witnesses (encrypted shares keyed to session)
  await delay(800);
  child.mpc.round = 2;
  renderAll();
  await delay(700);
  child.mpc.upstream.partialWitness   = await sha256('r2:up:'   + parentRemaining + ':' + sessionKey);
  child.mpc.downstream.partialWitness = await sha256('r2:down:' + childAmt        + ':' + sessionKey);
  child.mpc.engineLog.push('Round 2 complete: partial witnesses combined');
  renderAll();

  // ── ROUND 3 ──────────────────────────────────────────────────
  // MPC engine checks conservation constraint internally — neither party sees this
  await delay(800);
  child.mpc.round = 3;
  renderAll();
  await delay(900);

  const conservationOk = childAmt <= parentRemaining;
  child.mpc.conservationOk = conservationOk;

  if (!conservationOk) {
    // Rejection: MPC engine tells both parties "proof failed" — not why, not the values
    child.mpc.round = 'rejected';
    child.err = 'MPC engine rejected the proof. Conservation constraint failed. Neither party is told the other\'s value.';
    child.status = 'err';
    renderAll(); return;
  }

  const parentRemainingAfter = parentRemaining - childAmt;
  child.mpc.parentRemainingAfter = parentRemainingAfter;
  child.mpc.jointProof = fakeProof();
  child.mpc.round = 'done';
  child.mpc.engineLog.push('Round 3: conservation verified. Joint proof generated.');

  // ── UPDATE CHAIN STATE ────────────────────────────────────────
  // Child receives: amountCommitment + remainingCommitment (starts full)
  child.amountCommitment    = await sha256('poseidon:' + childAmt + ':' + child.blinding);
  child.remainingCommitment = await sha256('poseidon:' + childAmt + ':' + child.remainingBlinding);
  child.remaining = childAmt;
  child.proof = child.mpc.jointProof;
  child.status = 'done';

  // Parent's remaining decreases — new remainingCommitment published on-chain
  parent.remaining = parentRemainingAfter;
  parent.remainingBlinding = randHex();
  parent.remainingCommitment = await sha256('poseidon:' + parentRemainingAfter + ':' + parent.remainingBlinding);

  // Leaf entity: add nullifier
  if (childIdx === entities.length - 1) {
    child.nullifier = await sha256('nullifier:' + child.id + ':' + child.invoiceSecret + ':' + childAmt);
  }

  renderAll(); hideExport();
}

// ─── Export ───────────────────────────────────────────────────────────────

function finalizeChain() {
  const incomplete = entities.filter(e => !e.amountCommitment);
  if (incomplete.length > 0) {
    alert('Complete all entities first.\nPending: ' + incomplete.map(e => e.name).join(', '));
    return;
  }
  const records = entities.map((e, i) => ({
    index: i, entity: e.name,
    type: i === 0 ? 'root' : i === entities.length-1 ? 'leaf' : 'node',
    amountCommitment:    e.amountCommitment,
    remainingCommitment: e.remainingCommitment,
    nullifier: e.nullifier || null,
    proof: e.proof,
    mpcSessionKey: e.mpc?.sessionKey || null,
    timestamp: Date.now()
  }));
  const json = JSON.stringify(records, null, 2);
  const panel = document.getElementById('export-panel');
  panel.style.display = 'block';
  panel.innerHTML = `
    <div class="export-header">
      <div>
        <div class="export-title">On-chain dataset</div>
        <div class="export-sub">
          amountCommitments + remainingCommitments + MPC joint proofs — zero amounts
        </div>
      </div>
      <button class="btn btn-ghost btn-sm" onclick="copyAndVerify()">
        <i class="fa-solid fa-arrow-right-to-bracket"></i> Copy &amp; Open Verifier
      </button>
    </div>
    <div class="export-body">
      <textarea class="export-textarea" id="export-ta" readonly>${json}</textarea>
      <div class="stats-row">
        <span class="stat-chip">records: ${records.length}</span>
        <span class="stat-chip">commitments: ${records.length * 2} (amount + remaining)</span>
        <span class="stat-chip">nullifiers: ${records.filter(r=>r.nullifier).length}</span>
        <span class="stat-chip highlight"><i class="fa-solid fa-lock" style="font-size:10px"></i> amounts: hidden</span>
      </div>
    </div>`;
  panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function copyAndVerify() {
  const val = document.getElementById('export-ta')?.value;
  if (val) { navigator.clipboard?.writeText(val); document.getElementById('ver-input').value = val; }
  switchTab('verifier');
}

function hideExport() { document.getElementById('export-panel').style.display = 'none'; }

// ─── MPC Panel Rendering ──────────────────────────────────────────────────

function roundClass(mpc, targetRound) {
  if (!mpc) return 'pending';
  if (mpc.round === 'done' || mpc.round === 'rejected') return 'done';
  if (mpc.round > targetRound) return 'done';
  if (mpc.round === targetRound) return 'active';
  return 'pending';
}

function dotClass(mpc, n) {
  if (!mpc) return '';
  const r = mpc.round;
  if (r === 'done' || r === 'rejected' || r > n) return 'done';
  if (r === n) return 'active';
  return '';
}

function lineClass(mpc, afterRound) {
  if (!mpc) return '';
  const r = mpc.round;
  if (r === 'done' || r === 'rejected' || r > afterRound) return 'done';
  return '';
}

function buildMPCPanel(child, parent) {
  const mpc = child.mpc;
  if (!mpc) return '';

  const r = mpc.round;

  // Round 1 blocks
  const r1Up = roundClass(mpc, 1);
  const r1Down = roundClass(mpc, 1);
  const r2Up = roundClass(mpc, 2);
  const r2Down = roundClass(mpc, 2);
  const r3Eng = (r === 3 || r === 'done' || r === 'rejected') ? (r === 'rejected' ? 'done' : 'done') : (r > 3 ? 'done' : 'pending');

  const upstreamPanel = `
    <div class="mpc-col mpc-col-upstream">
      <div class="mpc-col-header"><i class="fa-solid fa-arrow-up" style="font-size:10px"></i> ${parent.name} (Upstream)</div>
      <div class="mpc-private-badge"><i class="fa-solid fa-eye-slash"></i> remaining: private</div>

      <div class="mpc-round-block ${r1Up}">
        <div class="mpc-round-block-title">
          ${r1Up==='done' ? '<i class="fa-solid fa-check"></i>' : r1Up==='active' ? '<span class="spinner" style="width:12px;height:12px;border-width:1.5px"></span>' : '<i class="fa-regular fa-circle"></i>'}
          Round 1 — Blind commit
        </div>
        ${mpc.upstream.blindCommit ? `
          <div class="mpc-packet-label">Sends to engine (hash only):</div>
          <div class="mpc-packet-value">${trunc(mpc.upstream.blindCommit)}</div>
          <div style="margin-top:4px"><span class="mpc-hidden-badge"><i class="fa-solid fa-lock"></i> actual value hidden</span></div>
        ` : '<div style="font-size:12px;color:var(--text3)">Generating…</div>'}
      </div>

      <div class="mpc-round-block ${r2Up}">
        <div class="mpc-round-block-title">
          ${r2Up==='done' ? '<i class="fa-solid fa-check"></i>' : r2Up==='active' ? '<span class="spinner" style="width:12px;height:12px;border-width:1.5px"></span>' : '<i class="fa-regular fa-circle"></i>'}
          Round 2 — Partial witness
        </div>
        ${mpc.upstream.partialWitness ? `
          <div class="mpc-packet-label">Encrypted share to engine:</div>
          <div class="mpc-packet-value">${trunc(mpc.upstream.partialWitness)}</div>
          <div style="margin-top:4px"><span class="mpc-hidden-badge"><i class="fa-solid fa-lock"></i> value not extractable</span></div>
        ` : '<div style="font-size:12px;color:var(--text3)">Waiting for round 2…</div>'}
      </div>

      <div class="mpc-round-block ${mpc.conservationOk === true ? 'done' : mpc.conservationOk === false ? 'done' : 'pending'}">
        <div class="mpc-round-block-title">
          ${mpc.conservationOk === true ? '<i class="fa-solid fa-check"></i>' : mpc.conservationOk === false ? '<i class="fa-solid fa-xmark" style="color:var(--red)"></i>' : '<i class="fa-regular fa-circle"></i>'}
          Round 3 — Result
        </div>
        ${mpc.conservationOk === true ? `
          <div style="font-size:12px;color:var(--green-text)">
            ✓ remainingCommitment updated<br/>
            <span style="font-family:var(--font-mono);font-size:11px">${trunc(parent.remainingCommitment)}</span>
          </div>` : mpc.conservationOk === false ? `
          <div style="font-size:12px;color:var(--red)">Proof rejected by engine</div>
        ` : '<div style="font-size:12px;color:var(--text3)">Awaiting engine…</div>'}
      </div>
    </div>`;

  const constraintLine = () => {
    if (mpc.conservationOk === null) return '<div class="mpc-engine-constraint pulse">checking conservation constraint…</div>';
    if (mpc.conservationOk === true) return `<div class="mpc-engine-constraint ok">
      parentRemaining ≥ childAmount ✓<br/>
      parentAfter = parentBefore − child<br/>
      <span style="opacity:0.7">conservation: proven</span>
    </div>`;
    return `<div class="mpc-engine-constraint fail">
      parentRemaining &lt; childAmount ✗<br/>
      conservation: violated — proof aborted
    </div>`;
  };

  const enginePanel = `
    <div class="mpc-col mpc-col-engine">
      <div class="mpc-col-header"><i class="fa-solid fa-lock"></i> MPC Engine</div>
      <div style="font-size:11px;color:var(--text3);margin-bottom:12px;line-height:1.6">
        Zero-knowledge coordinator.<br/>
        Neither party's value is accessible here.
      </div>

      <div class="mpc-round-block ${r1Up === 'done' ? 'done' : r === 1 ? 'active' : 'pending'}">
        <div class="mpc-round-block-title">
          ${r1Up==='done' ? '<i class="fa-solid fa-check"></i>' : r===1 ? '<span class="spinner" style="width:12px;height:12px;border-width:1.5px"></span>' : '<i class="fa-regular fa-circle"></i>'}
          Collecting blind commits
        </div>
        ${mpc.upstream.blindCommit && mpc.downstream.blindCommit ? `
          <div style="font-size:12px;color:var(--text2)">
            2 blind commits received.<br/>
            Values remain opaque to engine.
          </div>` : '<div style="font-size:12px;color:var(--text3)">Waiting…</div>'}
      </div>

      <div class="mpc-round-block ${r2Up === 'done' ? 'done' : r === 2 ? 'active' : 'pending'}">
        <div class="mpc-round-block-title">
          ${r2Up==='done' ? '<i class="fa-solid fa-check"></i>' : r===2 ? '<span class="spinner" style="width:12px;height:12px;border-width:1.5px"></span>' : '<i class="fa-regular fa-circle"></i>'}
          Combining partial witnesses
        </div>
        ${mpc.upstream.partialWitness && mpc.downstream.partialWitness ? `
          <div style="font-size:12px;color:var(--text2)">
            Shares combined via MPC.<br/>
            Individual values not reconstructed.
          </div>` : '<div style="font-size:12px;color:var(--text3)">Waiting…</div>'}
      </div>

      <div class="mpc-round-block ${mpc.conservationOk !== null ? 'done' : r===3 ? 'active' : 'pending'}">
        <div class="mpc-round-block-title">
          ${mpc.conservationOk === true ? '<i class="fa-solid fa-check"></i>' : mpc.conservationOk === false ? '<i class="fa-solid fa-xmark" style="color:var(--red)"></i>' : r===3 ? '<span class="spinner" style="width:12px;height:12px;border-width:1.5px"></span>' : '<i class="fa-regular fa-circle"></i>'}
          Prove conservation
        </div>
        ${r >= 3 || r === 'done' || r === 'rejected' ? constraintLine() : '<div style="font-size:12px;color:var(--text3)">Awaiting witnesses…</div>'}
        ${mpc.jointProof ? `
          <div style="margin-top:8px;font-size:12px;color:var(--purple)">
            <i class="fa-solid fa-circle-check"></i> Joint Groth16 proof emitted<br/>
            <span style="font-family:var(--font-mono);font-size:11px;opacity:0.8">${trunc(mpc.jointProof.pi_c[0], 10)}</span>
          </div>` : ''}
      </div>
    </div>`;

  const downstreamPanel = `
    <div class="mpc-col mpc-col-downstream">
      <div class="mpc-col-header"><i class="fa-solid fa-arrow-down" style="font-size:10px"></i> ${child.name} (Downstream)</div>
      <div class="mpc-private-badge"><i class="fa-solid fa-eye-slash"></i> amount: private</div>

      <div class="mpc-round-block ${r1Down}">
        <div class="mpc-round-block-title">
          ${r1Down==='done' ? '<i class="fa-solid fa-check"></i>' : r1Down==='active' ? '<span class="spinner" style="width:12px;height:12px;border-width:1.5px"></span>' : '<i class="fa-regular fa-circle"></i>'}
          Round 1 — Blind commit
        </div>
        ${mpc.downstream.blindCommit ? `
          <div class="mpc-packet-label">Sends to engine (hash only):</div>
          <div class="mpc-packet-value">${trunc(mpc.downstream.blindCommit)}</div>
          <div style="margin-top:4px"><span class="mpc-hidden-badge"><i class="fa-solid fa-lock"></i> actual value hidden</span></div>
        ` : '<div style="font-size:12px;color:var(--text3)">Generating…</div>'}
      </div>

      <div class="mpc-round-block ${r2Down}">
        <div class="mpc-round-block-title">
          ${r2Down==='done' ? '<i class="fa-solid fa-check"></i>' : r2Down==='active' ? '<span class="spinner" style="width:12px;height:12px;border-width:1.5px"></span>' : '<i class="fa-regular fa-circle"></i>'}
          Round 2 — Partial witness
        </div>
        ${mpc.downstream.partialWitness ? `
          <div class="mpc-packet-label">Encrypted share to engine:</div>
          <div class="mpc-packet-value">${trunc(mpc.downstream.partialWitness)}</div>
          <div style="margin-top:4px"><span class="mpc-hidden-badge"><i class="fa-solid fa-lock"></i> value not extractable</span></div>
        ` : '<div style="font-size:12px;color:var(--text3)">Waiting for round 2…</div>'}
      </div>

      <div class="mpc-round-block ${mpc.conservationOk === true ? 'done' : mpc.conservationOk === false ? 'done' : 'pending'}">
        <div class="mpc-round-block-title">
          ${mpc.conservationOk === true ? '<i class="fa-solid fa-check"></i>' : mpc.conservationOk === false ? '<i class="fa-solid fa-xmark" style="color:var(--red)"></i>' : '<i class="fa-regular fa-circle"></i>'}
          Round 3 — Result
        </div>
        ${mpc.conservationOk === true ? `
          <div style="font-size:12px;color:var(--green-text)">
            ✓ amountCommitment received<br/>
            <span style="font-family:var(--font-mono);font-size:11px">${trunc(child.amountCommitment)}</span><br/>
            ✓ remainingCommitment<br/>
            <span style="font-family:var(--font-mono);font-size:11px">${trunc(child.remainingCommitment)}</span>
          </div>` : mpc.conservationOk === false ? `
          <div style="font-size:12px;color:var(--red)">Proof rejected — no commitments issued</div>
        ` : '<div style="font-size:12px;color:var(--text3)">Awaiting engine…</div>'}
      </div>
    </div>`;

  const roundNum = typeof r === 'number' ? r : r === 'done' ? 3 : 3;

  return `
    <div class="mpc-panel">
      <div class="mpc-panel-header">
        <div class="mpc-panel-title">
          <i class="fa-solid fa-lock"></i>
          MPC Protocol${r === 'done' ? ' — Complete' : r === 'rejected' ? ' — Rejected' : ' — Round ' + Math.min(roundNum, 3) + ' of 3'}
        </div>
        <div class="mpc-rounds-indicator">
          <div class="mpc-round-step">
            <div class="mpc-round-dot ${dotClass(mpc, 1)}">1</div>
            <div class="mpc-round-line ${lineClass(mpc, 1)}"></div>
          </div>
          <div class="mpc-round-step">
            <div class="mpc-round-dot ${dotClass(mpc, 2)}">2</div>
            <div class="mpc-round-line ${lineClass(mpc, 2)}"></div>
          </div>
          <div class="mpc-round-step">
            <div class="mpc-round-dot ${dotClass(mpc, 3)}">3</div>
          </div>
        </div>
      </div>
      <div class="mpc-grid">
        ${upstreamPanel}
        ${enginePanel}
        ${downstreamPanel}
      </div>
    </div>`;
}

// ─── Card rendering ───────────────────────────────────────────────────────

function buildConnector(child, parent) {
  const mpc = child.mpc;
  const hasMpc = !!mpc;
  const isComplete = mpc?.round === 'done';
  const isRejected = mpc?.round === 'rejected';

  if (isComplete) {
    return `
      <div class="flow-connector">
        <div class="flow-connector-line"></div>
        <div class="mpc-complete-badge">
          <i class="fa-solid fa-circle-check"></i>
          MPC complete — joint proof on-chain · ${parent.name} remaining updated · ${child.name} allocated
        </div>
        <div class="flow-connector-line"></div>
      </div>`;
  }

  if (isRejected) {
    return `
      <div class="flow-connector">
        <div class="flow-connector-line"></div>
        <div class="mpc-rejected-badge">
          <i class="fa-solid fa-circle-xmark"></i>
          MPC rejected — conservation constraint failed · neither party told the other's value
        </div>
        <div class="flow-connector-line"></div>
      </div>`;
  }

  if (hasMpc) {
    return `
      <div class="flow-connector">
        <div class="flow-connector-line"></div>
      </div>
      ${buildMPCPanel(child, parent)}
      <div class="flow-connector">
        <div class="flow-connector-line"></div>
      </div>`;
  }

  if (!parent.amountCommitment) {
    return `
      <div class="flow-connector">
        <div class="flow-connector-line"></div>
        <div class="flow-connector-label">
          <i class="fa-solid fa-clock" style="font-size:9px"></i>
          ${parent.name} must commit first
        </div>
        <div class="flow-connector-line"></div>
      </div>`;
  }

  return `
    <div class="flow-connector">
      <div class="flow-connector-line"></div>
      <div class="mpc-trigger">
        <div class="mpc-trigger-icon"><i class="fa-solid fa-lock"></i></div>
        <div class="mpc-trigger-text">
          <div class="mpc-trigger-title">MPC Protocol required</div>
          <div class="mpc-trigger-sub">
            ${parent.name} and ${child.name} jointly prove the conservation constraint
            without either learning the other's private value.
            Enter your amount below, then initiate the protocol.
          </div>
        </div>
        <button class="btn btn-purple btn-sm" onclick="runMPC('${child.id}')">
          <i class="fa-solid fa-play"></i> Run MPC
        </button>
      </div>
      <div class="flow-connector-line"></div>
    </div>`;
}

function buildCard(e) {
  const idx = entities.indexOf(e);
  const isRoot = idx === 0;
  const parent = entities[idx - 1];
  const stateClass = { idle:'', mpc:'state-mpc', done:'state-done', err:'state-err' }[e.status] || '';
  const statusLabel = { idle:'Pending', mpc:'MPC Running…', done:'Committed', err:'Rejected' }[e.status];

  const canGenRoot = isRoot && (!e.amountCommitment);
  const genBtnClass = 'gen-btn' + (e.status==='done' ? ' done' : '');
  const genBtnContent = e.status==='mpc'
    ? '<span class="spinner"></span> Working…'
    : '<i class="fa-solid fa-lock"></i> ' + (e.status==='done' ? 'Committed (root)' : 'Generate Commitment');

  const amtHint = isRoot
    ? (e.amountCommitment ? 'Root committed — self-authorised.' : 'Root entity — no parent approval needed.')
    : (e.mpc?.round==='done' ? '<i class="fa-solid fa-circle-check" style="font-size:10px;color:var(--green)"></i> MPC complete — commitment generated.'
      : 'Enter amount, then run MPC protocol with ' + (parent?.name || 'parent') + '.');

  const privateZone = `
    <div class="zone zone-private">
      <div class="zone-header priv"><i class="fa-solid fa-user-secret"></i> Private · Off-Chain</div>
      ${isRoot ? `<div class="root-note"><i class="fa-solid fa-star" style="font-size:11px"></i> Root entity — self-authorises. No MPC needed.</div>` : ''}
      <div class="amount-section">
        <label class="field-label">Amount <span style="color:var(--text3);font-weight:400;font-size:11px;margin-left:6px">— never on-chain</span></label>
        <input class="amount-input" type="number" min="0.01" step="any"
          value="${e.amt}" placeholder="${isRoot ? 'e.g. 1000' : 'e.g. 300'}"
          oninput="setAmount('${e.id}',this.value)" id="amt-${e.id}"/>
        <div class="amount-hint">${amtHint}</div>
      </div>
      ${e.remaining !== null ? `
        <div class="remaining-section">
          <div class="remaining-label">Remaining capacity (private)</div>
          <div class="remaining-value">${e.remaining}</div>
          <div style="font-size:11px;color:var(--text3);margin-top:2px">
            started: ${e.amt} · allocated: ${parseFloat(e.amt) - e.remaining}
          </div>
        </div>` : ''}
      ${e.err ? `<div class="err-box"><i class="fa-solid fa-triangle-exclamation" style="margin-right:6px"></i>${e.err}</div>` : ''}
      ${isRoot ? `<button class="${genBtnClass}" onclick="generateRootCommitment('${e.id}')" ${e.status==='mpc'||e.status==='done' ? 'disabled' : ''}>${genBtnContent}</button>` : ''}
    </div>`;

  const publicZone = `
    <div class="zone zone-public">
      <div class="zone-header pub"><i class="fa-solid fa-link"></i> Public · On-Chain</div>
      <div class="field-block">
        <label class="field-label"><i class="fa-solid fa-envelope-open" style="font-size:11px;margin-right:4px"></i>
          Amount commitment
        </label>
        <div class="hash-pill ${e.amountCommitment ? 'green' : 'waiting'}"
          onclick="copyToClipboard('${e.amountCommitment||''}')">
          ${e.amountCommitment ? trunc(e.amountCommitment) : 'Not yet committed'}
        </div>
      </div>
      <div class="field-block">
        <label class="field-label"><i class="fa-solid fa-gauge" style="font-size:11px;margin-right:4px"></i>
          Remaining commitment <span style="color:var(--text3);font-weight:400">(updates per child)</span>
        </label>
        <div class="hash-pill ${e.remainingCommitment ? 'green' : 'waiting'}"
          onclick="copyToClipboard('${e.remainingCommitment||''}')">
          ${e.remainingCommitment ? trunc(e.remainingCommitment) : 'Not yet committed'}
        </div>
      </div>
      ${e.proof ? `<div class="field-block"><div class="proof-chip">
        <i class="fa-solid fa-check-circle" style="font-size:11px"></i>
        ${isRoot ? 'self-auth' : 'MPC joint'} · groth16 · bn128
      </div></div>` : ''}
      ${e.nullifier ? `
        <div class="field-block" style="margin-top:6px">
          <label class="field-label"><i class="fa-solid fa-tag" style="font-size:11px;margin-right:4px"></i>
            Nullifier <span style="color:var(--text3);font-weight:400">(replay protection)</span>
          </label>
          <div class="hash-pill indigo" onclick="copyToClipboard('${e.nullifier}')">${trunc(e.nullifier)}</div>
        </div>` : ''}
      ${!e.amountCommitment && !isRoot ? `
        <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;
          min-height:80px;color:var(--text3);font-size:13px;gap:8px;text-align:center;padding:16px 0">
          <i class="fa-solid fa-lock" style="font-size:20px;opacity:0.3"></i>
          <span>Populated after MPC completes</span>
        </div>` : ''}
    </div>`;

  const connector = !isRoot ? buildConnector(e, parent) : '';

  return `
    ${connector}
    <div class="entity-wrap">
      <div class="ecard ${stateClass}" id="ec-${e.id}">
        <div class="ecard-top">
          <div class="entity-index">${idx+1}</div>
          <input class="entity-name-input" value="${e.name}"
            onchange="setName('${e.id}',this.value)" placeholder="Entity name"/>
          <span class="status-pill status-${e.status}">${statusLabel}</span>
          ${!isRoot ? `<button class="rm-btn" onclick="removeEntity('${e.id}')" aria-label="Remove">
            <i class="fa-solid fa-xmark"></i></button>` : ''}
        </div>
        <div class="ecard-body">${privateZone}${publicZone}</div>
      </div>
    </div>`;
}

function renderAll() {
  document.getElementById('entity-list').innerHTML = entities.map(buildCard).join('');
}

// ─── Verifier ─────────────────────────────────────────────────────────────

async function runVerify() {
  const raw = document.getElementById('ver-input').value.trim();
  const out = document.getElementById('ver-result');
  if (!raw) { out.innerHTML = `<div class="err-box">Paste on-chain records first.</div>`; return; }
  let records;
  try { records = JSON.parse(raw); }
  catch(e) { out.innerHTML = `<div class="err-box">Invalid JSON — ${e.message}</div>`; return; }
  if (!Array.isArray(records)) { out.innerHTML = `<div class="err-box">Expected a JSON array.</div>`; return; }
  out.innerHTML = `<div style="display:flex;align-items:center;gap:12px;padding:20px;color:var(--text2);font-size:14px;">
    <div class="spinner"></div>Verifying ${records.length} record${records.length!==1?'s':''}…</div>`;
  await delay(900);

  const nullifiers = []; let allOk = true; const results = [];
  for (let i = 0; i < records.length; i++) {
    const r = records[i]; await delay(100);
    const checks = []; let ok = true;

    const hasProof = r.proof?.pi_a && r.proof?.pi_b && r.proof?.pi_c && r.proof?.protocol==='groth16';
    checks.push({ l:'Proof structure', v: hasProof ? 'groth16 present' : 'missing', ok: hasProof });
    if (!hasProof) ok = false;

    const bn = r.proof?.curve==='bn128';
    checks.push({ l:'Elliptic curve', v: bn ? 'bn128 ✓' : 'expected bn128', ok: bn });
    if (!bn) ok = false;

    const pts = Array.isArray(r.proof?.pi_a) && Array.isArray(r.proof?.pi_b) && Array.isArray(r.proof?.pi_c);
    checks.push({ l:'π_A · π_B · π_C points', v: pts ? 'valid' : 'malformed', ok: pts });
    if (!pts) ok = false;

    const hasAmtC = r.amountCommitment?.startsWith('0x') && r.amountCommitment.length===66;
    checks.push({ l:'Amount commitment', v: hasAmtC ? trunc(r.amountCommitment,10) : 'invalid', ok: hasAmtC });
    if (!hasAmtC) ok = false;

    const hasRemC = r.remainingCommitment?.startsWith('0x') && r.remainingCommitment.length===66;
    checks.push({ l:'Remaining commitment', v: hasRemC ? trunc(r.remainingCommitment,10) : 'invalid', ok: hasRemC });
    if (!hasRemC) ok = false;

    const proofType = i===0 ? 'self-auth' : 'MPC joint groth16';
    checks.push({ l:'Proof type', v: proofType, ok: true });

    if (i===0) {
      checks.push({ l:'Chain linkage', v:'root — no parent', ok:true });
    } else {
      // For linkage: prev remainingCommitment should exist (we can't verify the arithmetic without private values)
      const prevHasRem = !!records[i-1].remainingCommitment;
      checks.push({ l:'Parent remaining commitment', v: prevHasRem ? trunc(records[i-1].remainingCommitment,10) : 'missing', ok: prevHasRem });
      if (!prevHasRem) ok = false;
    }

    if (r.nullifier) {
      const replay = nullifiers.includes(r.nullifier);
      checks.push({ l:'Nullifier', v: replay ? 'REPLAY DETECTED' : 'unique — ' + trunc(r.nullifier,8), ok: !replay });
      if (replay) ok = false; else nullifiers.push(r.nullifier);
    }

    const mpcSig = !!(r.mpcSessionKey || i===0);
    checks.push({ l: i===0 ? 'Self-authorisation' : 'MPC session key', v: mpcSig ? (i===0 ? 'root node' : trunc(r.mpcSessionKey,10)) : 'missing', ok: mpcSig });

    checks.push({ l:'Conservation: amtBefore = child + amtAfter', v:'proven in MPC circuit (private inputs)', ok:true });
    checks.push({ l:'Groth16 pairing e(π_A,π_B)=e(α,β)·e(π_C,δ)', v: (hasProof&&bn&&pts) ? 'verified (simulated)' : 'cannot verify', ok: hasProof&&bn&&pts });

    if (!ok) allOk = false;
    results.push({ r, checks, ok, i });
  }

  const sumClass = allOk?'ok':'fail';
  out.innerHTML = `
    <div class="ver-summary ${sumClass}">
      <i class="fa-solid ${allOk?'fa-circle-check':'fa-circle-xmark'}"></i>
      ${allOk ? `All ${records.length} records verified — amountCommitments + remainingCommitments valid · MPC proofs intact` : `Verification failed — ${results.filter(r=>!r.ok).length} of ${records.length} records have issues`}
    </div>
    ${results.map(({r,checks,ok,i}) => `
      <div class="ver-card ${ok?'ok':'fail'}">
        <div class="ver-card-top">
          <div class="ver-icon ${ok?'ok':'fail'}"><i class="fa-solid ${ok?'fa-check':'fa-xmark'}"></i></div>
          <div class="ver-card-name">${i+1}. ${r.entity||'Entity '+i}</div>
          <span class="ver-card-type">${r.type}</span>
          <span class="ver-card-hash">${trunc(r.amountCommitment,8)}</span>
        </div>
        <div class="ver-card-body">
          ${checks.map(c=>`
            <div class="check-row">
              <span class="check-dot ${c.ok?'ok':'fail'}"></span>
              <span class="check-label">${c.l}</span>
              <span class="check-value ${c.ok?'ok':'fail'}">${c.v}</span>
            </div>`).join('')}
        </div>
      </div>`).join('')}`;
}

// ─── Tabs ─────────────────────────────────────────────────────────────────

function switchTab(name) {
  document.querySelectorAll('.pane').forEach(p=>p.classList.remove('active'));
  document.querySelectorAll('.nav-tab').forEach(t=>t.classList.toggle('active',t.dataset.tab===name));
  document.getElementById('pane-'+name).classList.add('active');
  window.scrollTo({top:0,behavior:'smooth'});
}

// ─── Init ─────────────────────────────────────────────────────────────────
addEntity();
