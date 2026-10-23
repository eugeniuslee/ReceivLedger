import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import { accountingInvariants as invariants } from './accountingAssertions.mjs';
import { fixture, compiled, manager, investor, sme, executor, outsider, hash } from './harness.mjs';

async function financed(f, face=500000n, options) { const id=await f.invoice(face,options); await f.approve(id); await f.call(manager,'financeInvoice',[id]); return id; }

async function setup(capital=100000000n){const f=await fixture();await f.capital(capital);return f;}
async function check(name,fn){test(name,async()=>{const f=await fixture();await fn(f);await invariants(f);});}

check('compiled V2 ABI is current and runtime fits EIP-170',async f=>{assert.deepEqual(compiled.abi,JSON.parse(fs.readFileSync('src/v2/abi.json','utf8')));assert(compiled.size<=24576);assert.equal(await f.get('decimals'),2n);assert.equal(await f.get('totalSupply'),0n);});
check('subscriptions need approval, funding attestation and single-use funding evidence',async f=>{
 await assert.rejects(f.call(investor,'requestSubscription',[10000n,1n,f.unique()]));await f.call(manager,'setInvestor',[investor,hash('verified-investor'),3]);
 await f.call(investor,'requestSubscription',[10000n,1n,f.unique()]);await assert.rejects(f.call(manager,'processSubscription',[1n]));
 await assert.rejects(f.call(investor,'confirmSubscriptionFunding',[1n,f.unique()]));const ref=f.unique();await f.call(manager,'confirmSubscriptionFunding',[1n,ref]);
 assert.equal(await f.get('totalSupply'),0n);assert.equal(await f.get('pendingSubscriptionCents'),10000n);
 await f.call(manager,'processSubscription',[1n]);await assert.rejects(f.call(manager,'processSubscription',[1n]));assert.equal(await f.get('totalSupply'),10000n);
 await f.call(investor,'requestSubscription',[10000n,1n,f.unique()]);await assert.rejects(f.call(manager,'confirmSubscriptionFunding',[2n,ref]));
});
for(const amount of [999999n,1000000n,1000001n])check('subscription automation boundary '+amount,async f=>{
 await f.call(manager,'setInvestor',[investor,hash('verified-investor'),3]);await f.call(manager,'setOperator',[executor,true,false]);await f.call(manager,'configureAutomation',[true,1000000n,500000n,0]);
 await f.call(investor,'requestSubscription',[amount,1n,f.unique()]);await f.call(manager,'confirmSubscriptionFunding',[1n,f.unique()]);
 if(amount>1000000n){await assert.rejects(f.call(executor,'processSubscription',[1n]));await f.call(manager,'approveSubscription',[1n]);}
 await f.call(executor,'processSubscription',[1n]);assert.equal(await f.get('navCents'),amount);
});
check('fund maximum is enforced again at processing of competing requests',async f=>{
 await f.capital(999999900n);await f.call(investor,'requestSubscription',[100n,1n,f.unique()]);await f.call(investor,'requestSubscription',[100n,1n,f.unique()]);
 for(const id of [2n,3n])await f.call(manager,'confirmSubscriptionFunding',[id,f.unique()]);await f.call(manager,'processSubscription',[2n]);
 await assert.rejects(f.call(manager,'processSubscription',[3n]));assert.equal(await f.get('fundAssetsCents'),1000000000n);
});
check('cancel, funded rejection and simulated refund segregate unissued capital',async f=>{
 await f.call(manager,'setInvestor',[investor,hash('verified-investor'),3]);const nonce=f.unique();await f.call(investor,'requestSubscription',[10000n,1n,nonce]);await f.call(investor,'cancelSubscription',[1n]);
 await assert.rejects(f.call(investor,'requestSubscription',[10000n,1n,nonce]));await f.call(investor,'requestSubscription',[10000n,1n,f.unique()]);await f.call(manager,'confirmSubscriptionFunding',[2n,f.unique()]);
 await assert.rejects(f.call(investor,'cancelSubscription',[2n]));await f.call(manager,'rejectSubscription',[2n]);assert.equal(await f.get('pendingSubscriptionCents'),10000n);
 await f.call(manager,'recordSubscriptionRefund',[2n,f.unique()]);assert.equal(await f.get('pendingSubscriptionCents'),0n);await assert.rejects(f.call(manager,'recordSubscriptionRefund',[2n,f.unique()]));
});
check('requests cannot bypass minimum units or revoked investor eligibility',async f=>{
 await f.capital();await f.call(investor,'requestSubscription',[10000n,10001n,f.unique()]);await f.call(manager,'confirmSubscriptionFunding',[2n,f.unique()]);await assert.rejects(f.call(manager,'processSubscription',[2n]));
 await f.call(manager,'setParticipant',[investor,true,false]);await assert.rejects(f.call(investor,'requestSubscription',[10000n,1n,f.unique()]));
});
for(const face of [499999n,500000n,500001n])check('invoice S$5000 gross advance/automation boundary '+face,async f=>{
 await f.capital();await f.call(manager,'configureAutomation',[true,1000000n,500000n,0]);await f.call(manager,'setOperator',[executor,true,false]);const id=await f.invoice(face);
 const i=await f.call(manager,'invoices',[id]);assert.equal(i.advance,face<=500000n?face:face*90n/100n);
 if(face>500000n){await assert.rejects(f.call(executor,'approveSmallInvoice',[id]));await f.approve(id);}else await f.call(executor,'approveSmallInvoice',[id]);
 assert.equal(await f.get('liquidCents'),100000000n);await f.call(executor,'financeInvoice',[id]);assert.equal(await f.get('liquidCents'),100000000n-i.advance+2000n);
 await assert.rejects(f.call(executor,'financeInvoice',[id]));
});
for(const capital of [49999999n,50000000n,50000001n])check('one percent automatic review boundary '+capital,async f=>{
 await f.capital(capital);await f.call(manager,'configureAutomation',[true,1000000n,500000n,0]);const id=await f.invoice();
 if(capital==50000000n){assert.equal(await f.get('autoEligible',id),false);await f.call(manager,'acknowledgeConcentration',[id]);}assert.equal(await f.get('autoEligible',id),capital>=50000000n);if(capital<50000000n)await assert.rejects(f.call(manager,'approveSmallInvoice',[id]));else await f.call(manager,'approveSmallInvoice',[id]);
});
check('verified SME, attestation, credit, risk and document/reference uniqueness are independent gates',async f=>{
 await f.capital();const doc=f.unique(),ref=f.unique();await assert.rejects(f.call(sme,'submitInvoice',[hash('payer'),doc,ref,500000n,f.time()+86400n,0]));await f.call(manager,'setSme',[sme,hash('verified-company'),true]);
 await f.call(sme,'submitInvoice',[hash('payer'),doc,ref,500000n,f.time()+86400n,0]);await assert.rejects(f.call(sme,'attestInvoice',[1n,true,true]));await assert.rejects(f.approve(1n));
 await f.call(manager,'attestInvoice',[1n,false,false]);await assert.rejects(f.approve(1n));await f.call(manager,'attestInvoice',[1n,false,true]);await f.approve(1n);
 await assert.rejects(f.call(sme,'submitInvoice',[hash('other'),doc,f.unique(),500000n,f.time()+86400n,0]));await assert.rejects(f.call(sme,'submitInvoice',[hash('other'),f.unique(),ref,500000n,f.time()+86400n,0]));
});
check('SME S$100000 outstanding cap counts gross principal and excludes repayment',async f=>{
 await f.capital(1000000000n);const first=await financed(f,10000000n);const second=await financed(f,1000000n);assert.equal(await f.get('smeExposureCents',sme),9900000n);
 const third=await f.invoice(100001n);await assert.rejects(f.approve(third));await f.call(manager,'recordCollection',[first,9000000n,false,f.unique()]);
 await f.approve(third);assert.equal(await f.get('smeExposureCents',sme),900000n);
});
check('payer concentration and maturity are rechecked at actual financing',async f=>{
 await f.capital(1000000n);const id=await f.invoice(500000n);await assert.rejects(f.approve(id));
 const small=await f.invoice(50000n,{maturity:f.time()+100n});await f.approve(small);f.advance(101n);await assert.rejects(f.call(manager,'financeInvoice',[small]));
 assert.equal(await f.get('liquidCents'),1000000n);
});
check('rejection, emergency pause and executor revocation cannot be bypassed',async f=>{
 await f.capital();const id=await f.invoice();await assert.rejects(f.call(outsider,'approveInvoice',[id]));await f.call(manager,'rejectInvoice',[id,'Fictional verification failed']);await assert.rejects(f.call(manager,'financeInvoice',[id]));
 const next=await f.invoice();await f.approve(next);await f.call(manager,'setOperator',[executor,true,false]);await f.call(manager,'configureAutomation',[true,1000000n,500000n,0]);await f.call(manager,'setOperator',[executor,false,false]);await assert.rejects(f.call(executor,'financeInvoice',[next]));
 await f.call(manager,'pause');await assert.rejects(f.call(manager,'financeInvoice',[next]));await f.call(manager,'unpause');await f.call(manager,'financeInvoice',[next]);
});
check('annual 8 percent interest uses actual elapsed time and SME early repayment has no penalty',async f=>{
 await f.capital();const id=await financed(f);f.advance(30n*86400n);const interest=500000n*800n*30n/3650000n;
 assert.equal(await f.get('obligationCents',id),500000n+interest);await f.call(manager,'recordCollection',[id,500000n+interest,false,f.unique()]);
 assert.equal(await f.get('outstandingCents'),0n);assert.equal(await f.get('collectedInterestCents'),interest);assert.equal(await f.get('processingIncomeCents'),2000n);
 f.advance(86400n);assert.equal(await f.get('obligationCents',id),0n);
});
check('optional overdue terms are accepted at submission and cannot be retroactively increased',async f=>{
 await f.capital();const old=await financed(f);await f.call(manager,'configureAutomation',[false,1000000n,500000n,300]);
 const id=await financed(f,500000n,{late:300,maturity:f.time()+10n*86400n});f.advance(20n*86400n);
 assert.equal(await f.get('obligationCents',id),500000n+(500000n*800n*20n/3650000n)+(500000n*300n*10n/3650000n));
 assert.equal((await f.call(manager,'invoices',[old])).overdueBps,0n);
});
check('payer collections offset debt once; large-invoice unused reserve is segregated and released',async f=>{
 await f.capital();const id=await financed(f,1000000n);f.advance(30n*86400n);const due=await f.get('obligationCents',id);const ref=f.unique();
 await f.call(manager,'recordCollection',[id,1000000n,true,ref]);const surplus=1000000n-due;
 assert.equal(await f.get('outstandingCents'),0n);assert.equal(await f.get('smeReservePoolCents'),surplus);await assert.rejects(f.call(manager,'recordCollection',[id,1n,true,ref]));
 await assert.rejects(f.call(manager,'recordCollection',[id,1n,false,f.unique()]));await f.call(manager,'releaseReserve',[id]);assert.equal(await f.get('smeReservePoolCents'),0n);await assert.rejects(f.call(manager,'releaseReserve',[id]));
});
check('100 percent advance needs interest top-up after full face-value payer collection',async f=>{
 await f.capital();const id=await financed(f);f.advance(30n*86400n);const topUp=(await f.get('obligationCents',id))-500000n;
 await f.call(manager,'recordCollection',[id,500000n,true,f.unique()]);assert.equal(await f.get('obligationCents',id),topUp);await f.call(manager,'recordCollection',[id,topUp,false,f.unique()]);assert.equal(await f.get('obligationCents',id),0n);
});
check('SME repayment followed by payer collection returns principal surplus instead of charging twice',async f=>{
 await f.capital();const id=await financed(f,1000000n);await f.call(manager,'recordCollection',[id,900000n,false,f.unique()]);await f.call(manager,'recordCollection',[id,1000000n,true,f.unique()]);
 assert.equal(await f.get('smeReservePoolCents'),1000000n);assert.equal(await f.get('navCents'),100002000n);
});
check('NAV revaluation blocks par redemption while financing is outstanding and prices losses explicitly',async f=>{
 await f.capital();const id=await financed(f);await assert.rejects(f.get('redemptionValue',100000n));await f.call(manager,'setImpairment',[id,100000n]);
 await f.call(manager,'confirmValuation',[f.time()+86400n]);const value=await f.get('redemptionValue',100000n);assert(value<100000n);
 await f.call(investor,'requestRedemption',[100000n,value]);await f.call(manager,'approveRedemption',[1n]);await f.call(manager,'settleRedemption',[1n]);assert.equal(await f.get('totalRedeemedCents'),value);
});
check('redemption without liquidity stays pending, then burns once after collection',async f=>{
 await f.capital();const loan=await financed(f);await f.call(manager,'confirmValuation',[f.time()+86400n]);const units=await f.get('balanceOf',investor);
 await f.call(investor,'requestRedemption',[units,1n]);await f.call(manager,'approveRedemption',[1n]);assert.equal((await f.call(manager,'redemptions',[1n])).status,1n);assert.equal(await f.get('reservedRedemptionCents'),0n);
 await f.call(manager,'recordCollection',[loan,500000n,false,f.unique()]);await f.call(manager,'allocateRedemption',[1n]);await f.call(manager,'settleRedemption',[1n]);assert.equal(await f.get('totalSupply'),0n);assert.equal(await f.get('navCents'),0n);await assert.rejects(f.call(manager,'settleRedemption',[1n]));
});
check('approved redemption reserves cash, adjusts active NAV/units and cannot be cancelled or spent twice',async f=>{
 await f.capital();await f.call(investor,'requestRedemption',[90000000n,1n]);await f.call(manager,'approveRedemption',[1n]);
 assert.equal(await f.get('freeLiquidityCents'),10000000n);assert.equal(await f.get('pricingUnits'),10000000n);assert.equal(await f.get('navCents'),10000000n);
 await assert.rejects(f.call(investor,'cancelRedemption',[1n]));await f.call(manager,'settleRedemption',[1n]);assert.equal(await f.get('liquidCents'),10000000n);
});
check('unallocated redemption cancellation/rejection restores escrow even for revoked investors',async f=>{
 await f.capital();await f.call(investor,'requestRedemption',[1000n,1n]);await f.call(manager,'setParticipant',[investor,true,false]);await f.call(investor,'cancelRedemption',[1n]);
 assert.equal(await f.get('balanceOf',investor),100000000n);await assert.rejects(f.call(investor,'requestRedemption',[1000n,1n]));await f.call(manager,'setParticipant',[investor,true,true]);await f.call(investor,'requestRedemption',[1000n,1n]);await f.call(manager,'rejectRedemption',[2n,'Review rejected']);
 assert.equal(await f.get('balanceOf',investor),100000000n);
});
check('normal transfers require approved counterparties and cannot transfer directly into escrow',async f=>{
 await f.capital();await assert.rejects(f.call(investor,'transfer',[outsider,100n]));await f.call(manager,'setInvestor',[outsider,hash('verified-investor-b'),3]);await f.call(investor,'transfer',[outsider,100n]);
 await assert.rejects(f.call(outsider,'transfer',[f.address,100n]));assert.equal(await f.get('balanceOf',outsider),100n);
});
for(const [method,args] of [['configureAutomation',[true,1000000n,500000n,0]],['setOperator',[outsider,true,true]],['setParticipant',[outsider,true,true]],['confirmValuation',[1800001000n]],['pause',[]],['setImpairment',[1n,0n]],['recordCollection',[1n,100n,false,hash('receipt')]]])check('unprivileged caller cannot '+method,async f=>{await assert.rejects(f.call(outsider,method,args));});
check('executor cannot attest funding, grant permissions, approve larger invoices or approve redemptions',async f=>{
 await f.capital();await f.call(manager,'setOperator',[executor,true,false]);const loan=await f.invoice(1000000n);
 for(const [method,args] of [['attestInvoice',[loan,true,true]],['approveInvoice',[loan]],['confirmSubscriptionFunding',[1n,f.unique()]],['approveRedemption',[1n]],['setOperator',[outsider,true,true]]])await assert.rejects(f.call(executor,method,args));
});
check('exact SME cap permits the boundary but not one extra cent',async f=>{
 await f.capital(1000000000n);await financed(f,10000000n);await financed(f,1000000n);await financed(f,100000n);assert.equal(await f.get('smeExposureCents',sme),10000000n);
 const id=await f.invoice(2001n);await assert.rejects(f.approve(id));
});
check('invoice attestors cannot attest their own SME invoice',async f=>{
 await f.capital();const id=await f.invoice();await f.call(manager,'setOperator',[sme,false,true]);await assert.rejects(f.call(sme,'attestInvoice',[id,true,true]));
});
check('partial interest collections retain fractional cents and never compound interest',async f=>{
 await f.capital();const id=await financed(f);for(let day=0;day<30;day++){f.advance(86400n);await f.call(manager,'recordCollection',[id,1n,false,f.unique()]);}
 assert.equal(await f.get('obligationCents',id),500000n+3287n-30n);assert.equal(await f.get('outstandingCents'),500000n);
});
check('redemption payout cannot be allocated below the user minimum or by an unreviewed executor',async f=>{
 await f.capital();await f.call(manager,'setOperator',[executor,true,false]);await f.call(manager,'configureAutomation',[true,1000000n,500000n,0]);
 await f.call(investor,'requestRedemption',[1000n,1001n]);await assert.rejects(f.call(manager,'approveRedemption',[1n]));await assert.rejects(f.call(executor,'allocateRedemption',[1n]));await f.call(investor,'cancelRedemption',[1n]);
});
check('several redemptions and new subscriptions do not spend reserved liabilities',async f=>{
 await f.capital();await f.call(investor,'requestRedemption',[40000000n,1n]);await f.call(investor,'requestRedemption',[40000000n,1n]);await f.call(manager,'approveRedemption',[1n]);await f.call(manager,'approveRedemption',[2n]);
 assert.equal(await f.get('reservedRedemptionCents'),80000000n);assert.equal(await f.get('redemptionValue',1000n),1000n);
 await f.capital(100000n);assert.equal(await f.get('reservedRedemptionCents'),80000000n);await f.call(manager,'settleRedemption',[2n]);await f.call(manager,'settleRedemption',[1n]);
});
check('realised financing income changes subscription/redemption unit price instead of assuming par',async f=>{
 await f.capital(10000000n);const id=await financed(f,1000000n);f.advance(30n*86400n);await f.call(manager,'recordCollection',[id,1000000n,true,f.unique()]);
 assert.equal(await f.get('navCents'),10007917n);assert.equal(await f.get('subscriptionUnits',1000000n),1000000n*10000000n/10007917n);assert.equal(await f.get('redemptionValue',5000000n),5003958n);
});
check('zero NAV and expired valuations block pricing rather than redeeming at S$1',async f=>{
 await f.capital();const id=await financed(f);await f.call(manager,'confirmValuation',[f.time()+10n]);f.advance(11n);await assert.rejects(f.get('subscriptionUnits',10000n));await assert.rejects(f.get('redemptionValue',10000n));
});
check('manager ownership transfers in two steps without granting powers to an unaccepted owner',async f=>{
 await f.call(manager,'transferOwnership',[outsider]);await assert.rejects(f.call(outsider,'pause'));await f.call(outsider,'acceptOwnership');await assert.rejects(f.call(manager,'pause'));await f.call(outsider,'pause');
});
check('zero active NAV blocks issuance/redemption after a fully reserved cash exit and loan write-off',async f=>{
 await f.capital();const id=await financed(f);await f.call(manager,'confirmValuation',[f.time()+86400n]);const liquid=await f.get('liquidCents'),nav=await f.get('navCents'),supply=await f.get('pricingUnits');
 const units=(liquid*supply+nav-1n)/nav;await f.call(investor,'requestRedemption',[units,liquid]);await f.call(manager,'approveRedemption',[1n]);assert.equal(await f.get('freeLiquidityCents'),0n);
 await f.call(manager,'setImpairment',[id,500000n]);await f.call(manager,'confirmValuation',[f.time()+86400n]);assert.equal(await f.get('navCents'),0n);
 await assert.rejects(f.get('subscriptionUnits',10000n));await assert.rejects(f.get('redemptionValue',1n));await f.call(manager,'settleRedemption',[1n]);
});
check('unallocated redemptions cannot consume reserved cash and paused financing does not block collection',async f=>{
 await f.capital();const id=await financed(f);await f.call(manager,'pause');await f.call(manager,'recordCollection',[id,500000n,false,f.unique()]);assert.equal(await f.get('outstandingCents'),0n);
 await f.call(investor,'requestRedemption',[1000000n,1n]);await f.call(manager,'approveRedemption',[1n]);await f.call(manager,'settleRedemption',[1n]);
});

check('one SME cannot multiply the S$100000 cap through two approved wallets',async f=>{
 await f.capital(1000000000n);await financed(f,10000000n);await financed(f,1000000n);await financed(f,100000n,{borrower:outsider});
 assert.equal(await f.get('entityExposureCents',hash('verified-company')),10000000n);const id=await f.invoice(2001n,{borrower:outsider});await assert.rejects(f.approve(id));
 await assert.rejects(f.call(manager,'setSme',[sme,hash('different-company'),true]));
});
