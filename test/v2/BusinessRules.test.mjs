import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decodeBytes32String } from 'ethers';
import fs from 'node:fs';
import { fixture, manager, investor, sme, executor, outsider, hash } from './harness.mjs';
import { accountingInvariants } from './accountingAssertions.mjs';
const DAY=86400n;
function check(name,fn){test(name,async()=>{const f=await fixture();await fn(f);await accountingInvariants(f);});}
async function subscribe(f,wallet,cents,review=false){
  const id=await f.get('subscriptionCount')+1n;
  await f.call(wallet,'requestSubscription',[cents,1n,f.unique()]);
  if(review)await f.call(manager,'approveSubscription',[id]);
  await f.call(manager,'confirmSubscriptionFunding',[id,f.unique()]);return id;
}
async function auto(f,face=500000n,options={}){
  const id=await f.invoice(face,options);await f.call(manager,'approveSmallInvoice',[id]);await f.call(manager,'financeInvoice',[id]);return id;
}

for(const status of [0,1,2,4,5])check(`registration state ${status} blocks subscriptions, issuance, redemptions and SME submission`,async f=>{
  await f.capital();await f.call(investor,'requestSubscription',[10000n,1n,f.unique()]);await f.call(manager,'confirmSubscriptionFunding',[2n,f.unique()]);
  await f.call(manager,'setInvestor',[investor,hash('verified-investor'),status]);
  await assert.rejects(f.call(investor,'requestSubscription',[10000n,1n,f.unique()]));
  await assert.rejects(f.call(manager,'processSubscription',[2n]));
  await assert.rejects(f.call(investor,'requestRedemption',[1n,0n]));
  const invoice=await f.invoice();await f.call(manager,'setSmeStatus',[hash('verified-company'),status]);
  await assert.rejects(f.call(sme,'submitInvoice',[hash('payer'),f.unique(),f.unique(),500000n,f.time()+DAY,0]));
  await assert.rejects(f.approve(invoice));
});
check('only manager binds immutable verified identities and cannot approve itself',async f=>{
  await assert.rejects(f.call(outsider,'setInvestor',[outsider,hash('person'),3]));
  await assert.rejects(f.call(manager,'setInvestor',[manager,hash('manager-person'),3]));
  await assert.rejects(f.call(manager,'setSme',[manager,hash('manager-company'),true]));
  await f.capital();await assert.rejects(f.call(manager,'setInvestor',[investor,hash('reset-person'),3]));
});
check('associated SME wallet cannot independently attest its own entity invoice',async f=>{
  await f.capital();const id=await f.invoice();await f.call(manager,'setSme',[outsider,hash('verified-company'),true]);
  await f.call(manager,'setOperator',[outsider,false,true]);await assert.rejects(f.call(outsider,'attestInvoice',[id,true,true]));
});
check('concurrent ready subscriptions share lifetime S$10000 automatic limit across wallets',async f=>{
  const entity=hash('same-investor');await f.call(manager,'setInvestor',[investor,entity,3]);await f.call(manager,'setInvestor',[outsider,entity,3]);
  const a=await subscribe(f,investor,600000n),b=await subscribe(f,outsider,600000n);
  await f.call(manager,'processSubscription',[a]);await assert.rejects(f.call(manager,'processSubscription',[b]));
  await f.call(manager,'approveSubscription',[b]);await f.call(manager,'processSubscription',[b]);
  assert.equal(await f.get('automaticSubscriptionCents',entity),600000n);
  const c=await subscribe(f,outsider,400000n);await f.call(manager,'processSubscription',[c]);
  assert.equal(await f.get('automaticSubscriptionCents',entity),1000000n);
  await f.call(investor,'requestRedemption',[600000n,1n]);await f.call(manager,'approveRedemption',[1n]);await f.call(manager,'settleRedemption',[1n]);
  const d=await subscribe(f,investor,100n);await assert.rejects(f.call(manager,'processSubscription',[d]));
  await f.call(manager,'approveSubscription',[d]);await f.call(manager,'processSubscription',[d]);
  assert.equal(await f.get('automaticSubscriptionCents',entity),1000000n);
});
check('automatic SME facility reserves S$50000 across associated wallets, then needs review',async f=>{
  await f.capital(1000000000n);await f.call(manager,'configureAutomation',[true,1000000n,500000n,0]);
  for(let n=0;n<10;n++)await auto(f,500000n,{borrower:n%2===0?sme:outsider});
  assert.equal(await f.get('entityAutoExposureCents',hash('verified-company')),5000000n);
  const third=await f.invoice(500000n);assert.equal(await f.get('autoEligible',third),false);
  await assert.rejects(f.call(manager,'approveSmallInvoice',[third]));
  await f.approve(third);await f.call(manager,'financeInvoice',[third]);
  assert.equal(await f.get('entityAutoExposureCents',hash('verified-company')),5000000n);
  await f.call(manager,'recordCollection',[1n,500000n,false,f.unique()]);
  const next=await f.invoice();assert.equal(await f.get('autoEligible',next),true);
});
check('aggregate 1% NAV gate includes earlier automatic financing and approved commitments',async f=>{
  await f.capital();await f.call(manager,'configureAutomation',[true,1000000n,500000n,0]);
  await auto(f);const second=await f.invoice();await f.call(manager,'approveSmallInvoice',[second]);
  const third=await f.invoice();assert.equal(await f.get('autoEligible',third),false);
  await assert.rejects(f.call(manager,'approveSmallInvoice',[third]));await assert.rejects(f.call(manager,'approveInvoice',[third]));
  await f.approve(third);
});
check('manual SME hard cap counts approved commitments across wallets and releases rejected commitments',async f=>{
  await f.capital(1000000000n);const a=await f.invoice(10000000n);await f.approve(a);
  const b=await f.invoice(1000000n,{borrower:outsider});await f.approve(b);
  const c=await f.invoice(100000n);await f.approve(c);
  assert.equal(await f.get('entityCommitmentsCents',hash('verified-company')),10000000n);
  const d=await f.invoice(2001n);await assert.rejects(f.approve(d));
  await f.call(manager,'rejectInvoice',[c,'Release unfinanced commitment']);await f.approve(d);
  assert.equal(await f.get('entityExposureCents',hash('verified-company')),0n);
  await f.call(manager,'financeInvoice',[a]);assert.equal(await f.get('entityExposureCents',hash('verified-company')),9000000n);
});
for(const days of [30n,31n,90n])check(`automatic maturity is 30 days and manual maturity is 90: ${days}`,async f=>{
  await f.capital();await f.call(manager,'configureAutomation',[true,1000000n,500000n,0]);
  const id=await f.invoice(100000n,{maturity:f.time()+days*DAY});assert.equal(await f.get('autoEligible',id),days<=30n);
  if(days>30n)await assert.rejects(f.call(manager,'approveSmallInvoice',[id]));
  await f.approve(id);await f.call(manager,'financeInvoice',[id]);
});
check('manual acknowledgement required at exactly 1% NAV and after a redemption shrinks NAV',async f=>{
  await f.capital(50000000n);const id=await f.invoice(500000n);
  await assert.rejects(f.call(manager,'approveInvoice',[id]));await f.approve(id);
  await f.call(manager,'financeInvoice',[id]);
  const another=await f.invoice(100000n);await f.approve(another);
  await f.call(manager,'confirmValuation',[f.time()+DAY]);
  await f.call(investor,'requestRedemption',[40000000n,1n]);await f.call(manager,'approveRedemption',[1n]);
  await assert.rejects(f.call(manager,'approveSmallInvoice',[another]));
});
check('funding rechecks concentration acknowledgement after NAV falls, without spending reserved cash',async f=>{
  await f.capital(50000000n);const id=await f.invoice(100000n);
  await f.call(manager,'approveInvoice',[id]);
  await f.call(investor,'requestRedemption',[45000000n,1n]);await f.call(manager,'approveRedemption',[1n]);
  await assert.rejects(f.call(manager,'financeInvoice',[id]));
  await f.call(manager,'acknowledgeConcentration',[id]);await f.call(manager,'financeInvoice',[id]);
  assert.equal(await f.get('reservedRedemptionCents'),45000000n);
});
check('payer concentration includes commitments from different SMEs',async f=>{
  await f.capital(10000000n);const a=await f.invoice(1000000n);await f.approve(a);
  await f.call(manager,'setSme',[outsider,hash('independent-company'),true]);
  await f.call(outsider,'submitInvoice',[hash('payer'),f.unique(),f.unique(),200000n,f.time()+DAY,0]);
  await f.call(manager,'attestInvoice',[2n,true,true]);await assert.rejects(f.approve(2n));
  await f.call(manager,'rejectInvoice',[a,'Release payer capacity']);await f.approve(2n);
});
check('subscription and redemption prices include earned unpaid interest and collection does not increase NAV twice',async f=>{
  await f.capital(10000000n);const id=await f.invoice(500000n);await f.approve(id);await f.call(manager,'financeInvoice',[id]);f.advance(20n*DAY);
  const earned=500000n*800n*20n/3650000n,nav=10002000n+earned;
  assert.equal(await f.get('navCents'),nav);assert.equal(await f.get('collectedInterestCents'),0n);
  await f.call(manager,'confirmValuation',[f.time()+DAY]);
  assert.equal(await f.get('subscriptionUnits',1000000n),1000000n*10000000n/nav);
  assert.equal(await f.get('redemptionValue',1000000n),1000000n*nav/10000000n);
  await f.call(manager,'recordCollection',[id,500000n+earned,false,f.unique()]);
  assert.equal(await f.get('navCents'),nav);assert.equal(await f.get('accruedInterestCents'),0n);
  const events=f.movements.map(e=>({kind:decodeBytes32String(e.kind),cash:e.cash,loans:e.loans,income:e.income,nav:e.nav}));
  assert.equal(events.filter(e=>e.kind==='InterestAccrued').reduce((n,e)=>n+e.income,0n),earned);
  assert.equal(events.filter(e=>e.kind==='Collection').reduce((n,e)=>n+e.income,0n),0n);
  assert.equal(events.reduce((n,e)=>n+e.nav,0n),nav);
});
check('expected losses can cover accrued interest as well as principal without inflating liquidity',async f=>{
  await f.capital();const id=await f.invoice();await f.approve(id);await f.call(manager,'financeInvoice',[id]);f.advance(45n*DAY);
  const debt=await f.get('obligationCents',id);await f.call(manager,'setImpairment',[id,debt]);
  assert.equal(await f.get('fundAssetsCents'),await f.get('liquidCents'));
  await f.call(manager,'recordCollection',[id,debt,false,f.unique()]);
  assert.equal(await f.get('impairmentCents'),0n);assert.equal(await f.get('outstandingCents'),0n);
});
check('bounded active-loan accounting permits 100 loans, reuses repaid slots and checkpoints their accrual',async f=>{
  await f.capital();
  await f.call(manager,'configureAutomation',[false,1000000n,500000n,300]);
  for(let n=0;n<100;n++){const id=await f.invoice(2001n,{late:300,maturity:f.time()+10n*DAY});await f.approve(id);await f.call(manager,'financeInvoice',[id]);}
  const next=await f.invoice(2001n,{late:300,maturity:f.time()+90n*DAY});await f.approve(next);await assert.rejects(f.call(manager,'financeInvoice',[next]));
  f.advance(20n*DAY);const debt=await f.get('obligationCents',1n);
  await f.call(manager,'recordCollection',[1n,debt,false,f.unique()]);await f.call(manager,'financeInvoice',[next]);
  await f.call(manager,'confirmValuation',[f.time()+DAY]);
  await f.call(investor,'requestRedemption',[10000n,1n]);await f.call(manager,'approveRedemption',[1n]);
  const maxima={};for(const r of f.receipts.filter(r=>r.success)){assert(r.preRefundGas<=16777216n);if(!maxima[r.method]||r.preRefundGas>maxima[r.method].preRefundGas)maxima[r.method]={gas:r.gas,preRefundGas:r.preRefundGas};}
  fs.mkdirSync('supabase/.temp',{recursive:true});fs.writeFileSync('supabase/.temp/v2-readiness-capacity-gas.json',JSON.stringify(maxima,(_,v)=>typeof v==='bigint'?v.toString():v,2)+'\n');
});
