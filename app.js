'use strict';

// ─── Crypto ───────────────────────────────────────────────────────────────

async function sha256(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return '0x' + [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}
function randHex(n = 16) {
  const a = new Uint8Array(n); crypto.getRandomValues(a);
  return '0x' + [...a].map(b => b.toString(16).padStart(2, '0')).join('');
}
function fakeProof() {
  return { pi_a: [randHex(32), randHex(32), '1'],
           pi_b: [[randHex(32), randHex(32)], [randHex(32), randHex(32)], ['1', '0']],
           pi_c: [randHex(32), randHex(32), '1'],
           protocol: 'groth16', curve: 'bn128' };
}
function trunc(h, n = 14) {
  if (!h) return '—';
  return h.length > n * 2 ? h.slice(0, n + 2) + '…' + h.slice(-5) : h;
}
function copyToClipboard(t) { if (t) navigator.clipboard?.writeText(t); }

// ─── State ────────────────────────────────────────────────────────────────

const PRESETS = ['Mastercard', 'PSP', 'Business', 'Agent', 'Merchant'];
let entities = [];

function makeEntity(idx) {
  return {
    id: crypto.randomUUID(),
    name: PRESETS[Math.min(idx, PRESETS.length - 1)],
    amt: '',
    blinding: randHex(),
    invoiceSecret: randHex(),
    inCommitment: null,    // public — parent's output commitment (on-chain)
    outCommitment: null,
    proof: null,
    nullifier: null,
    status: 'idle',        // idle | gen | done | err
    err: null,
    approved: false,       // did parent sign off on our commitment?
    approvalSig: null,     // signature received from parent (only thing child gets)
  };
}

// ─── Entity CRUD ──────────────────────────────────────────────────────────

function addEntity() {
  const e = makeEntity(entities.length);
  const parent = entities[entities.length - 1];
  if (parent) e.inCommitment = parent.outCommitment; // visible on-chain even before approval
  entities.push(e);
  renderAll();
}

function removeEntity(id) {
  const idx = entities.findIndex(e => e.id === id);
  if (idx === 0 && entities.length > 1) return;
  entities.splice(idx, 1);
  for (let i = idx; i < entities.length; i++) {
    const prev = entities[i - 1];
    entities[i].inCommitment = prev ? prev.outCommitment : null;
    if (prev && !prev.outCommitment) {
      entities[i].outCommitment = null;
      entities[i].proof = null;
      entities[i].approved = false;
      entities[i].approvalSig = null;
      entities[i].status = 'idle';
    }
  }
  renderAll();
  hideExport();
}

function setName(id, val) {
  const e = entities.find(e => e.id === id);
  if (e) e.name = val;
}

// NOTE: no renderAll() here — rebuilding the DOM kills the focused input.
// We only update JS state; DOM refreshes on generate / approve / remove.
function setAmount(id, val) {
  const e = entities.find(e => e.id === id);
  if (!e) return;
  e.amt = val;
  e.err = null;
  // If they already had a commitment, invalidate it and cascade downstream
  if (e.outCommitment) {
    e.outCommitment = null; e.proof = null; e.nullifier = null; e.status = 'idle';
    const idx = entities.indexOf(e);
    for (let i = idx + 1; i < entities.length; i++) {
      // inCommitment is public on-chain data — don't clear it
      entities[i].outCommitment = null;
      entities[i].proof = null;
      entities[i].nullifier = null;
      entities[i].approved = false;
      entities[i].approvalSig = null;
      entities[i].status = 'idle';
    }
    hideExport();
  }
}

// ─── Approval flow ────────────────────────────────────────────────────────
//
// The PSP decides their own amount. They never learn Mastercard's threshold.
//
// Flow:
//   1. PSP enters amount, clicks "Request approval"
//   2. Request goes to Mastercard (simulated here client-side)
//   3. Mastercard checks childAmt <= threshold PRIVATELY, returns ONLY a sig
//   4. If rejected: PSP is told "denied" — NOT why, NOT the threshold
//   5. ZK proof proves verify(MC_pubkey, sig, C_PSP) == true
//      Chain sees: commitments + proof. Neither amount ever appears.

function requestApproval(parentId) {
  const parentIdx = entities.findIndex(e => e.id === parentId);
  const parent = entities[parentIdx];
  const child = entities[parentIdx + 1];
  if (!parent || !child) return;

  if (!parent.outCommitment) {
    child.err = parent.name + ' must generate their commitment before they can approve.';
    renderAll(); return;
  }

  const childAmt = parseFloat(child.amt);
  if (!childAmt || childAmt <= 0) {
    child.err = 'Enter your amount first, then request approval.';
    renderAll(); return;
  }

  // ── Parent's internal check (invisible to child) ──
  const parentAmt = parseFloat(parent.amt);
  if (childAmt > parentAmt) {
    // Parent rejects — returns ONLY "denied", never the threshold
    child.err = 'Approval denied by ' + parent.name + '. Your amount does not satisfy their internal policy. (The threshold is not disclosed to you.)';
    child.status = 'err';
    child.approved = false;
    child.approvalSig = null;
    renderAll(); return;
  }

  // ── Parent approves — signs child's prospective commitment ──
  child.approved = true;
  child.approvalSig = randHex(32);   // simulate ECDSA sig over child's future commitment
  child.inCommitment = parent.outCommitment;
  child.err = null;
  child.status = 'idle';
  renderAll();
}

// ─── Commitment generation ────────────────────────────────────────────────

async function generateCommitment(id) {
  const idx = entities.findIndex(e => e.id === id);
  const e = entities[idx];
  const isRoot = idx === 0;
  const amount = parseFloat(e.amt);

  if (!amount || amount <= 0) {
    e.err = 'Enter a valid amount greater than zero.';
    renderAll(); return;
  }
  if (!isRoot && !e.approved) {
    e.err = 'Request and receive approval from ' + (entities[idx-1]?.name || 'parent') + ' first.';
    renderAll(); return;
  }

  e.status = 'gen'; e.err = null;
  renderAll();

  await new Promise(r => setTimeout(r, 700));

  e.outCommitment = await sha256('poc-poseidon:' + amount + ':' + e.blinding);
  e.proof = fakeProof();
  e.status = 'done';

  const isLeaf = idx === entities.length - 1;
  if (isLeaf) e.nullifier = await sha256('nullifier:' + e.id + ':' + e.invoiceSecret + ':' + amount);

  // Feed commitment downstream so child's public zone shows it immediately
  if (idx + 1 < entities.length) {
    entities[idx + 1].inCommitment = e.outCommitment;
    // Invalidate child's approval — parent's commitment changed
    entities[idx + 1].outCommitment = null;
    entities[idx + 1].proof = null;
    entities[idx + 1].approved = false;
    entities[idx + 1].approvalSig = null;
    entities[idx + 1].status = 'idle';
  }

  renderAll();
  hideExport();
}

// ─── Export ───────────────────────────────────────────────────────────────

function finalizeChain() {
  const incomplete = entities.filter(e => !e.outCommitment);
  if (incomplete.length > 0) {
    alert('Generate commitments for all entities first.\nPending: ' + incomplete.map(e => e.name).join(', '));
    return;
  }
  const records = entities.map((e, i) => ({
    index: i, entity: e.name,
    type: i === 0 ? 'root' : i === entities.length - 1 ? 'leaf' : 'node',
    inputCommitment: e.inCommitment || null,
    outputCommitment: e.outCommitment,
    nullifier: e.nullifier || null,
    proof: e.proof,
    approvalSig: e.approvalSig || null,
    timestamp: Date.now()
  }));
  const json = JSON.stringify(records, null, 2);
  const panel = document.getElementById('export-panel');
  panel.style.display = 'block';
  const nc = records.filter(r => r.nullifier).length;
  panel.innerHTML = `
    <div class="export-header">
      <div>
        <div class="export-title">On-chain dataset</div>
        <div class="export-sub">Commitments + proofs + approval sigs only — zero amounts</div>
      </div>
      <button class="btn btn-ghost btn-sm" onclick="copyAndVerify()">
        <i class="fa-solid fa-arrow-right-to-bracket"></i> Copy &amp; Open Verifier
      </button>
    </div>
    <div class="export-body">
      <textarea class="export-textarea" id="export-ta" readonly>${json}</textarea>
      <div class="stats-row">
        <span class="stat-chip">records: ${records.length}</span>
        <span class="stat-chip">nullifiers: ${nc}</span>
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

// ─── Render ───────────────────────────────────────────────────────────────

function approvalBanner(e, idx) {
  if (idx === 0) return '';
  const parent = entities[idx - 1];

  if (!parent.outCommitment) {
    return `<div class="handshake-banner pending">
      <i class="fa-solid fa-clock"></i>
      <div><strong>${parent.name}</strong> must generate their commitment first.</div>
    </div>`;
  }

  if (e.approved) {
    return `<div class="handshake-banner done">
      <div class="handshake-icon done"><i class="fa-solid fa-check"></i></div>
      <div style="flex:1">
        <strong>Approved by ${parent.name}</strong><br/>
        <span style="font-size:12px;line-height:1.6;display:block;margin-top:2px">
          ${parent.name} verified your amount satisfies their internal policy and returned a
          <strong>signature</strong>. Their threshold was never shared with you.
          Your ZK proof will prove <code>verify(${parent.name}_pubkey, sig, C_you) == true</code>.
        </span>
      </div>
      <div style="font-family:var(--font-mono);font-size:10px;color:var(--green-text);text-align:right;flex-shrink:0;opacity:0.8;line-height:1.8">
        <div>sig: ${trunc(e.approvalSig, 8)}</div>
        <div>threshold: <span style="color:var(--red)">hidden</span></div>
      </div>
    </div>`;
  }

  return `<div class="handshake-banner ready">
    <div class="handshake-icon"><i class="fa-solid fa-file-signature"></i></div>
    <div style="flex:1">
      <strong>Request approval from ${parent.name}</strong><br/>
      <span style="font-size:12px;line-height:1.6;display:block;margin-top:2px">
        Enter your amount, then request approval. ${parent.name} checks against their
        internal threshold privately — <em>you are never told what it is</em>.
        If approved you receive only a <strong>signature</strong>.
      </span>
    </div>
    <button class="btn btn-handshake" onclick="requestApproval('${parent.id}')">
      <i class="fa-solid fa-paper-plane"></i> Request approval
    </button>
  </div>`;
}

function buildCard(e) {
  const idx = entities.indexOf(e);
  const isRoot = idx === 0;
  const parent = entities[idx - 1];

  const stateClass = { idle: '', gen: '', done: 'state-done', err: 'state-err' }[e.status] || '';
  const statusLabel = { idle: 'Pending', gen: 'Generating…', done: 'Committed', err: 'Rejected' }[e.status];

  const connector = idx > 0 ? `
    <div class="flow-connector">
      <div class="flow-connector-line"></div>
      <div class="flow-connector-label">
        <i class="fa-solid fa-arrow-down-long" style="font-size:9px"></i>
        commitment flows on-chain · approval travels off-chain
      </div>
      <div class="flow-connector-line"></div>
    </div>` : '';

  const genDisabled = e.status === 'gen' || (!isRoot && !e.approved);
  const genClass = 'gen-btn' + (e.status === 'done' ? ' done' : '');
  const genLabel = e.status === 'gen'
    ? '<span class="spinner"></span> Generating ZK proof…'
    : '<i class="fa-solid fa-lock"></i> ' + (e.status === 'done' ? 'Regenerate' : 'Generate') + ' Commitment & Proof';

  const amtHint = e.approved
    ? '<i class="fa-solid fa-circle-check" style="font-size:10px"></i> Approved — generate your commitment below.'
    : isRoot
      ? 'Root entity — self-authorises, no approval needed.'
      : 'Enter your amount, then request approval above.';

  const privateZone = `
    <div class="zone zone-private">
      <div class="zone-header priv"><i class="fa-solid fa-user-secret"></i> Private · Off-Chain</div>
      ${isRoot ? `<div class="root-note"><i class="fa-solid fa-star" style="font-size:11px"></i> Root entity — self-authorises. No parent approval required.</div>` : ''}
      <div class="amount-section">
        <label class="field-label">Amount <span style="color:var(--text3);font-weight:400;font-size:11px;margin-left:6px">— never leaves this zone</span></label>
        <input class="amount-input" type="number" min="0.01" step="any"
          value="${e.amt}" placeholder="${isRoot ? 'e.g. 1000' : 'e.g. 300'}"
          oninput="setAmount('${e.id}', this.value)" id="amt-${e.id}"/>
        <div class="amount-hint" style="color:${e.approved ? 'var(--green-text)' : 'var(--text3)'}">
          ${amtHint}
        </div>
      </div>
      <div class="blind-section">
        <label class="field-label">Blinding factor <span style="color:var(--text3);font-weight:400">(auto-generated)</span></label>
        <div class="hash-pill" onclick="copyToClipboard('${e.blinding}')">${trunc(e.blinding, 16)}</div>
      </div>
      ${e.err ? `<div class="err-box"><i class="fa-solid fa-triangle-exclamation" style="margin-right:6px"></i>${e.err}</div>` : ''}
      <button class="${genClass}" onclick="generateCommitment('${e.id}')" ${genDisabled ? 'disabled' : ''}>
        ${genLabel}
      </button>
    </div>`;

  const inBlock = idx > 0 ? `
    <div class="field-block">
      <label class="field-label"><i class="fa-solid fa-arrow-down" style="font-size:11px;margin-right:4px"></i>
        Input commitment (from ${parent?.name || 'parent'})
      </label>
      <div class="hash-pill ${e.inCommitment ? 'green' : 'waiting'}"
           onclick="copyToClipboard('${e.inCommitment || ''}')">
        ${e.inCommitment ? trunc(e.inCommitment) : 'Waiting for ' + (parent?.name || 'parent') + ' to commit…'}
      </div>
    </div>` : '';

  const outBlock = e.outCommitment ? `
    <div class="field-block">
      <label class="field-label"><i class="fa-solid fa-arrow-up" style="font-size:11px;margin-right:4px"></i>
        Output commitment → next entity
      </label>
      <div class="hash-pill green" onclick="copyToClipboard('${e.outCommitment}')">${trunc(e.outCommitment)}</div>
    </div>
    <div class="field-block">
      <div class="proof-chip">
        <i class="fa-solid fa-check-circle" style="font-size:11px"></i>
        groth16 · bn128 · approval sig in circuit
      </div>
    </div>
    ${e.nullifier ? `
      <div class="field-block" style="margin-top:6px">
        <label class="field-label"><i class="fa-solid fa-tag" style="font-size:11px;margin-right:4px"></i>
          Nullifier <span style="color:var(--text3);font-weight:400">(replay protection)</span>
        </label>
        <div class="hash-pill indigo" onclick="copyToClipboard('${e.nullifier}')">${trunc(e.nullifier)}</div>
      </div>` : ''}
  ` : `
    <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;
                min-height:100px;color:var(--text3);font-size:13px;gap:8px;text-align:center;padding:20px 0">
      <i class="fa-regular fa-circle-dot" style="font-size:22px;opacity:0.35"></i>
      <span>${isRoot || e.approved ? 'Generate commitment to populate' : 'Get approval first'}</span>
    </div>`;

  const publicZone = `
    <div class="zone zone-public">
      <div class="zone-header pub"><i class="fa-solid fa-link"></i> Public · On-Chain</div>
      ${inBlock}
      ${outBlock}
    </div>`;

  return `
    ${connector}
    <div class="entity-wrap">
      ${approvalBanner(e, idx)}
      <div class="ecard ${stateClass}" id="ec-${e.id}">
        <div class="ecard-top">
          <div class="entity-index">${idx + 1}</div>
          <input class="entity-name-input" value="${e.name}"
            onchange="setName('${e.id}', this.value)" placeholder="Entity name"/>
          <span class="status-pill status-${e.status}">${statusLabel}</span>
          ${!isRoot ? `<button class="rm-btn" onclick="removeEntity('${e.id}')" aria-label="Remove">
            <i class="fa-solid fa-xmark"></i></button>` : ''}
        </div>
        <div class="ecard-body">
          ${privateZone}
          ${publicZone}
        </div>
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
  catch (e) { out.innerHTML = `<div class="err-box">Invalid JSON — ${e.message}</div>`; return; }
  if (!Array.isArray(records)) { out.innerHTML = `<div class="err-box">Expected a JSON array.</div>`; return; }
  out.innerHTML = `<div style="display:flex;align-items:center;gap:12px;padding:20px;color:var(--text2);font-size:14px;">
    <div class="spinner"></div>Verifying ${records.length} record${records.length !== 1 ? 's' : ''}…</div>`;
  await new Promise(r => setTimeout(r, 900));
  const nullifiers = []; let allOk = true; const results = [];
  for (let i = 0; i < records.length; i++) {
    const r = records[i]; await new Promise(res => setTimeout(res, 100));
    const checks = []; let ok = true;
    const hasProof = r.proof && r.proof.pi_a && r.proof.pi_b && r.proof.pi_c && r.proof.protocol === 'groth16';
    checks.push({ l: 'Proof structure', v: hasProof ? 'groth16 present' : 'missing', ok: hasProof }); if (!hasProof) ok = false;
    const bn = r.proof?.curve === 'bn128';
    checks.push({ l: 'Elliptic curve', v: bn ? 'bn128 ✓' : 'expected bn128', ok: bn }); if (!bn) ok = false;
    const pts = Array.isArray(r.proof?.pi_a) && Array.isArray(r.proof?.pi_b) && Array.isArray(r.proof?.pi_c);
    checks.push({ l: 'π_A · π_B · π_C points', v: pts ? 'valid' : 'malformed', ok: pts }); if (!pts) ok = false;
    const hasSig = !!(r.approvalSig || i === 0);
    checks.push({ l: i === 0 ? 'Root (self-authorised)' : 'Approval signature', v: hasSig ? (i === 0 ? 'root node' : trunc(r.approvalSig, 8)) : 'missing', ok: hasSig }); if (!hasSig) ok = false;
    if (i === 0) { checks.push({ l: 'Chain linkage', v: 'root — no parent', ok: true }); }
    else {
      const linked = r.inputCommitment === records[i - 1].outputCommitment;
      checks.push({ l: 'Chain linkage', v: linked ? 'matches prev output' : 'BROKEN', ok: linked }); if (!linked) ok = false;
    }
    const validOut = r.outputCommitment?.startsWith('0x') && r.outputCommitment.length === 66;
    checks.push({ l: 'Output commitment', v: validOut ? trunc(r.outputCommitment, 10) : 'invalid', ok: validOut }); if (!validOut) ok = false;
    if (r.nullifier) {
      const replay = nullifiers.includes(r.nullifier);
      checks.push({ l: 'Nullifier', v: replay ? 'REPLAY DETECTED' : 'unique — ' + trunc(r.nullifier, 8), ok: !replay });
      if (replay) ok = false; else nullifiers.push(r.nullifier);
    }
    checks.push({ l: 'Groth16 pairing e(π_A,π_B) = e(α,β)·e(π_C,δ)', v: (hasProof && bn && pts) ? 'verified (simulated)' : 'cannot verify', ok: hasProof && bn && pts });
    if (!ok) allOk = false;
    results.push({ r, checks, ok, i });
  }
  const sumOk = allOk ? 'ok' : 'fail';
  const sumIcon = allOk ? 'fa-circle-check' : 'fa-circle-xmark';
  const sumMsg = allOk
    ? `All ${records.length} records verified — chain intact · no replay · Groth16 valid`
    : `Failed — ${results.filter(r => !r.ok).length} of ${records.length} record(s) have issues`;
  out.innerHTML = `
    <div class="ver-summary ${sumOk}"><i class="fa-solid ${sumIcon}"></i>${sumMsg}</div>
    ${results.map(({ r, checks, ok, i }) => `
      <div class="ver-card ${ok ? 'ok' : 'fail'}">
        <div class="ver-card-top">
          <div class="ver-icon ${ok ? 'ok' : 'fail'}"><i class="fa-solid ${ok ? 'fa-check' : 'fa-xmark'}"></i></div>
          <div class="ver-card-name">${i + 1}. ${r.entity || 'Entity ' + i}</div>
          <span class="ver-card-type">${r.type}</span>
          <span class="ver-card-hash">${trunc(r.outputCommitment, 10)}</span>
        </div>
        <div class="ver-card-body">
          ${checks.map(c => `
            <div class="check-row">
              <span class="check-dot ${c.ok ? 'ok' : 'fail'}"></span>
              <span class="check-label">${c.l}</span>
              <span class="check-value ${c.ok ? 'ok' : 'fail'}">${c.v}</span>
            </div>`).join('')}
        </div>
      </div>`).join('')}`;
}

// ─── Tabs ─────────────────────────────────────────────────────────────────

function switchTab(name) {
  document.querySelectorAll('.pane').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === name));
  document.getElementById('pane-' + name).classList.add('active');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ─── Init ─────────────────────────────────────────────────────────────────
addEntity();
