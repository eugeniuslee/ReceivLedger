import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fixture, manager, investor, sme, outsider } from './harness.mjs';
import { accountingInvariants } from './accountingAssertions.mjs';

const DAY = 86400n, YEAR_BPS = 365n * DAY * 10000n;
async function financed(f, face = 400000n, options = {}) {
  const id = await f.invoice(face, { maturity: f.time() + 90n * DAY, ...options });
  await f.approve(id);
  await f.call(manager, 'financeInvoice', [id]);
  return id;
}
function check(name, fn) {
  test(name, async () => { const f = await fixture(); await fn(f); await accountingInvariants(f); });
}
const accounting = (f, id) => f.get('invoiceAccounting', id);

check('S$4000 financing books gross principal, S$3980 cash and S$20 fee without future income', async f => {
  await f.capital();
  const id = await f.invoice(400000n);
  let a = await accounting(f, id);
  assert.equal(a.feeIncomeCents, 0n); assert.equal(a.netCashAdvancedCents, 0n);
  await f.approve(id); await f.call(manager, 'financeInvoice', [id]);
  a = await accounting(f, id);
  assert.equal(a.netCashAdvancedCents, 398000n); assert.equal(a.feeIncomeCents, 2000n);
  assert.equal(a.principalReceivableCents, 400000n);
  assert.equal(a.accruedBaseCents, 0n); assert.equal(a.collectedBaseCents, 0n);
  assert.equal(await f.get('liquidCents'), 99602000n);
  assert.equal(await f.get('outstandingCents'), 400000n);
  assert.equal(await f.get('navCents'), 100002000n);
  assert.equal(await f.get('collectedInterestCents'), 0n);
});

for (const days of [1n, 20n, 45n]) check(`early full repayment after ${days} days charges only elapsed interest`, async f => {
  await f.capital(); const id = await financed(f); f.advance(days * DAY);
  const interest = 400000n * 800n * days * DAY / YEAR_BPS;
  assert.equal((await accounting(f, id)).accruedBaseCents, interest);
  assert.equal(await f.get('collectedInterestCents'), 0n);
  assert.equal(await f.get('navCents'), 100002000n + interest);
  await f.call(manager, 'recordCollection', [id, 400000n + interest, false, f.unique()]);
  const a = await accounting(f, id);
  assert.equal(a.collectedBaseCents, interest); assert.equal(a.collectedPrincipalCents, 400000n);
  assert.equal(a.smeCollectionsCents, 400000n + interest);
  assert.equal(a.accruedBaseCents, 0n); assert.equal(await f.get('outstandingCents'), 0n);
  assert.equal(await f.get('liquidCents'), 100002000n + interest);
  assert.equal(await f.get('navCents'), 100002000n + interest);
  f.advance(100n * DAY); assert.equal(await f.get('obligationCents', id), 0n);
  await assert.rejects(f.call(manager, 'recordCollection', [id, 1n, false, f.unique()]));
});

check('live reporting uses actual seconds without materialising or collecting interest', async f => {
  await f.capital(); const id = await financed(f); f.advance(12345n);
  const expected = 400000n * 800n * 12345n / YEAR_BPS;
  assert.equal((await accounting(f, id)).accruedBaseCents, expected);
  assert.equal((await f.call(manager, 'invoices', [id])).interest, 0n);
  assert.equal(await f.get('collectedInterestCents'), 0n);
  assert.equal(await f.get('navCents'), 100002000n + expected);
  assert.equal(await f.get('obligationCents', id), 400000n + expected);
});

check('bounded accrued-interest pages reconcile live base and overdue amounts', async f => {
  const empty = await f.call(manager, 'accruedInterestPage', [1n, 100n]);
  assert.deepEqual([...empty], [1n, 0n, 0n]);
  await f.capital(); await f.call(manager, 'configureAutomation', [false, 1000000n, 500000n, 300]);
  const a = await financed(f, 400000n, { maturity: f.time() + 10n * DAY, late: 300 });
  const b = await financed(f, 300000n, { late: 300 }); f.advance(20n * DAY);
  const first = await f.call(manager, 'accruedInterestPage', [1n, 1n]);
  const second = await f.call(manager, 'accruedInterestPage', [first.nextId, 100n]);
  const all = await f.call(manager, 'accruedInterestPage', [1n, 100n]);
  assert.equal(all.nextId, 3n); assert.equal(first.baseCents + second.baseCents, all.baseCents);
  assert.equal(first.overdueCents + second.overdueCents, all.overdueCents);
  assert.equal(all.baseCents, (await accounting(f, a)).accruedBaseCents + (await accounting(f, b)).accruedBaseCents);
  assert.equal(all.overdueCents, 400000n * 300n * 10n * DAY / YEAR_BPS);
  for (const args of [[0n, 1n], [4n, 1n], [1n, 0n], [1n, 101n]]) await assert.rejects(f.call(manager, 'accruedInterestPage', args));
  for (const method of ['invoiceAccounting', 'obligationCents']) {
    await assert.rejects(f.get(method, 0n)); await assert.rejects(f.get(method, 3n));
  }
});

check('partial repayment reduces future interest principal and carries fractional cents', async f => {
  await f.capital(); const id = await financed(f); f.advance(20n * DAY);
  const numerator1 = 400000n * 800n * 20n * DAY;
  const interest1 = numerator1 / YEAR_BPS, receipt = 101753n;
  await f.call(manager, 'recordCollection', [id, receipt, false, f.unique()]);
  const remaining = 400000n - (receipt - interest1);
  assert.equal(remaining, 300000n); f.advance(25n * DAY);
  const interest2 = (remaining * 800n * 25n * DAY + numerator1 % YEAR_BPS) / YEAR_BPS;
  assert.equal(await f.get('obligationCents', id), remaining + interest2);
  await f.call(manager, 'recordCollection', [id, remaining + interest2, false, f.unique()]);
  assert.equal((await accounting(f, id)).collectedBaseCents, interest1 + interest2);
  assert.equal(await f.get('navCents'), 100002000n + interest1 + interest2);
});

check('mixed SME and payer collections settle one obligation and surplus never becomes income', async f => {
  await f.capital(); const id = await financed(f, 1000000n); f.advance(20n * DAY);
  await f.call(manager, 'recordCollection', [id, 100000n, false, f.unique()]);
  const due = await f.get('obligationCents', id), ref = f.unique();
  await f.call(manager, 'recordCollection', [id, 1000000n, true, ref]);
  const a = await accounting(f, id);
  assert.equal(a.reservePayableCents, 1000000n - due);
  assert.equal(a.payerCollectionsCents, 1000000n); assert.equal(a.smeCollectionsCents, 100000n);
  assert.equal(a.collectedPrincipalCents, 900000n); assert.equal(a.accruedBaseCents, 0n);
  assert.equal(await f.get('navCents'), 100002000n + a.collectedBaseCents);
  await assert.rejects(f.call(manager, 'recordCollection', [id, 1n, true, ref]));
  await assert.rejects(f.call(manager, 'recordCollection', [id, 1n, true, f.unique()]));
  await assert.rejects(f.call(manager, 'recordCollection', [id, 1n, false, f.unique()]));
  const nav = await f.get('navCents'); await f.call(manager, 'releaseReserve', [id]);
  assert.equal(await f.get('navCents'), nav); assert.equal(await f.get('smeReservePoolCents'), 0n);
});

check('funding, refunds and collections cannot reuse each other\'s payment reference', async f => {
  await f.capital(); const id = await financed(f), collectionRef = f.unique();
  await f.call(manager, 'recordCollection', [id, 100n, false, collectionRef]);
  await f.call(investor, 'requestSubscription', [10000n, 1n, f.unique()]);
  await assert.rejects(f.call(manager, 'confirmSubscriptionFunding', [2n, collectionRef]));
  assert.equal(await f.get('pendingSubscriptionCents'), 0n);
  const fundingRef = f.unique(); await f.call(manager, 'confirmSubscriptionFunding', [2n, fundingRef]);
  const before = await f.get('obligationCents', id);
  await assert.rejects(f.call(manager, 'recordCollection', [id, 100n, false, fundingRef]));
  assert.equal(await f.get('obligationCents', id), before);
  await f.call(manager, 'rejectSubscription', [2n]);
  await assert.rejects(f.call(manager, 'recordSubscriptionRefund', [2n, collectionRef]));
  const refundRef = f.unique(); await f.call(manager, 'recordSubscriptionRefund', [2n, refundRef]);
  await assert.rejects(f.call(manager, 'recordCollection', [id, 100n, false, refundRef]));
});

check('two investors cannot double reserve liquidity; pending exit reprices after loan collection', async f => {
  await f.capital(10000000n); await f.call(manager, 'setInvestor', [outsider, f.unique(), 3]);
  await f.call(outsider, 'requestSubscription', [10000000n, 1n, f.unique()]);
  await f.call(manager, 'approveSubscription', [2n]); await f.call(manager, 'confirmSubscriptionFunding', [2n, f.unique()]);
  await f.call(manager, 'processSubscription', [2n]);
  const loan = await financed(f, 1000000n);
  await f.call(manager, 'confirmValuation', [f.time() + DAY]);
  for (const wallet of [investor, outsider]) await f.call(wallet, 'requestRedemption', [10000000n, 1n]);
  await f.call(manager, 'approveRedemption', [1n]); await f.call(manager, 'approveRedemption', [2n]);
  assert.equal((await f.call(manager, 'redemptions', [1n])).payoutCents, 10001000n);
  assert.equal((await f.call(manager, 'redemptions', [2n])).status, 1n);
  assert.equal(await f.get('reservedRedemptionCents'), 10001000n);
  await assert.rejects(f.call(manager, 'settleRedemption', [2n]));
  await accountingInvariants(f); f.advance(20n * DAY);
  const due = await f.get('obligationCents', loan);
  await f.call(manager, 'recordCollection', [loan, due, false, f.unique()]);
  await f.call(manager, 'allocateRedemption', [2n]);
  assert.equal((await f.call(manager, 'redemptions', [2n])).payoutCents, 10001000n + due - 900000n);
  await f.call(manager, 'settleRedemption', [2n]); await f.call(manager, 'settleRedemption', [1n]);
  assert.equal(await f.get('totalSupply'), 0n); assert.equal(await f.get('navCents'), 0n);
});

check('maturity, fee and policy ceilings reject one-unit boundary violations', async f => {
  await f.capital();
  for (const maturity of [f.time(), f.time() + 90n * DAY + 1n]) await assert.rejects(f.invoice(400000n, { maturity }));
  await f.invoice(400000n, { maturity: f.time() + 90n * DAY });
  await assert.rejects(f.invoice(2000n)); await f.invoice(2001n);
  for (const args of [[true, 1000001n, 500000n, 0], [true, 1000000n, 500001n, 0], [true, 1000000n, 500000n, 301]]) await assert.rejects(f.call(manager, 'configureAutomation', args));
  await assert.rejects(f.call(sme, 'setSme', [sme, f.unique(), true]));
  await assert.rejects(f.call(outsider, 'releaseReserve', [1n]));
});

// Deterministic model-based fuzzing: integer-rational reference model, independent of contract views.
for (const seed of [1, 7, 42, 20261023, 0xdeadbeef]) check(`seeded repayment/accounting invariant sequence ${seed}`, async f => {
  let state = seed >>> 0;
  const random = max => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return BigInt(state % max); };
  await f.capital(); const face = 250001n + random(250000), id = await financed(f, face);
  let principal = face, numerator = 0n, interestPaid = 0n, principalPaid = 0n, payerPaid = 0n, smePaid = 0n, reserve = 0n;
  async function receive(amount, payer) {
    const interest = numerator / YEAR_BPS, paid = amount < interest ? amount : interest;
    numerator -= paid * YEAR_BPS; interestPaid += paid;
    const available = amount - paid, capital = available < principal ? available : principal;
    principal -= capital; principalPaid += capital; reserve += available - capital;
    if (payer) payerPaid += amount; else smePaid += amount;
    if (principal === 0n && numerator / YEAR_BPS === 0n) numerator = 0n;
    await f.call(manager, 'recordCollection', [id, amount, payer, f.unique()]);
  }
  for (let step = 0; step < 20; step++) {
    const seconds = random(7 * 86400 + 1); f.advance(seconds); numerator += principal * 800n * seconds;
    const debt = principal + numerator / YEAR_BPS;
    if (debt > 0n) {
      const payer = random(2) === 1n && payerPaid < face;
      const maximum = payer ? face - payerPaid : debt;
      const amount = 1n + random(Number(maximum < 50000n ? maximum : 50000n));
      await receive(amount, payer);
    }
    const a = await accounting(f, id);
    assert.equal(a.principalReceivableCents, principal); assert.equal(a.accruedBaseCents, numerator / YEAR_BPS);
    assert.equal(a.collectedBaseCents, interestPaid); assert.equal(a.collectedPrincipalCents, principalPaid);
    assert.equal(a.payerCollectionsCents, payerPaid); assert.equal(a.smeCollectionsCents, smePaid);
    assert.equal(a.reservePayableCents, reserve);
    assert.equal(await f.get('navCents'), 100002000n + interestPaid + numerator / YEAR_BPS);
    await accountingInvariants(f);
  }
  const debt = principal + numerator / YEAR_BPS; if (debt > 0n) await receive(debt, false);
  if (payerPaid < face) await receive(face - payerPaid, true);
  assert.equal(await f.get('obligationCents', id), 0n);
  await f.call(manager, 'releaseReserve', [id]); f.advance(365n * DAY);
  assert.equal((await accounting(f, id)).accruedBaseCents, 0n);
});
