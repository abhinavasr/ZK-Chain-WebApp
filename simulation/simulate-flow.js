import { createHash, randomBytes } from 'node:crypto';

const day = 24 * 60 * 60 * 1000;
const now = Date.UTC(2026, 0, 1);
const hash = (...v) => '0x' + createHash('sha3-256').update(v.join('|')).digest('hex');
const blind = () => randomBytes(16).toString('hex');
const commitment = (label, value='private') => hash(label, value, blind());
const fmt = (t) => new Date(t).toISOString().slice(0, 10);

function assertRule(ok, msg) { if (!ok) throw new Error(msg); }
function period(start, end) { return { startAt: start, endAt: end, settlementDeadline: end + 2 * day }; }

const program = {
  id: hash('program', 'mastercard', 'psp'), type: 'Mastercard→PSP Program Authorization', status: 'Active',
  psp: 'Blue PSP', envelopeCommitment: commitment('authorized-envelope'), ...period(now, now + 180 * day)
};
const business = {
  id: hash('business-contract', program.id, 'business'), type: 'PSP→Business Funded Contract', status: 'Active',
  parentId: program.id, business: 'RetailCo', fundedAmountCommitment: commitment('funded-amount'), ...period(now + 30 * day, now + 120 * day)
};
assertRule(business.startAt >= program.startAt && business.endAt <= program.endAt && business.settlementDeadline <= program.settlementDeadline, 'Business contract outlives program');

const agents = Array.from({ length: 3 }, (_, i) => ({
  id: hash('agent', business.id, i + 1), type: 'Business→Agent Authority', status: 'Active', parentId: business.id,
  agent: `Agent ${i + 1}`, authorityAmountCommitment: commitment('agent-authority', i + 1), ...period(now + 40 * day, now + (95 + i * 5) * day)
}));
agents.forEach(a => assertRule(a.endAt <= business.endAt && a.settlementDeadline <= business.settlementDeadline, `${a.agent} outlives business contract`));

const receivables = [];
for (const agent of agents) {
  for (let j = 1; j <= 2; j++) {
    const createdAt = agent.startAt + j * day;
    const r = {
      id: hash('receivable', agent.id, j), type: 'Agent→Merchant Receivable', status: 'Created', parentId: agent.id,
      merchant: `${agent.agent} Merchant ${j}`, receivableCommitment: commitment('merchant-receivable', `${agent.agent}-${j}`),
      claimNullifier: hash('claim-nullifier', agent.id, j, blind()), createdAt, settlementDeadline: createdAt + 2 * day
    };
    assertRule(r.settlementDeadline <= agent.settlementDeadline, `${r.merchant} outlives agent authority`);
    receivables.push(r);
  }
}

const usedNullifiers = new Set();
const settlementBatches = [];
function settle(receivable) {
  assertRule(!usedNullifiers.has(receivable.claimNullifier), 'Double settlement rejected by nullifier registry');
  usedNullifiers.add(receivable.claimNullifier); // merchant-level claim nullifier only
  receivable.status = 'Settled';
}
receivables.forEach(settle);
try { settle(receivables[0]); } catch (err) { settlementBatches.push({ id: hash('batch-replay-test'), status: 'Rejected', reason: err.message }); }
settlementBatches.push({ id: hash('batch', 'happy-path'), status: 'Accepted', rollupCommitment: hash('rollup', receivables.map(r => r.id).join('|')), receivables: receivables.length, note: 'No batch nullifier; protection is merchant claim nullifiers only.' });

const records = { generatedAt: new Date().toISOString(), program, business, agents, receivables, settlementBatches, usedNullifierCount: usedNullifiers.size };
console.log(JSON.stringify(records, null, 2));
console.error(`\nSimulation OK: ${agents.length} agents, ${receivables.length} receivables, ${usedNullifiers.size} consumed nullifiers.`);
console.error(`Program active ${fmt(program.startAt)} → ${fmt(program.endAt)}, settlement until ${fmt(program.settlementDeadline)}.`);
