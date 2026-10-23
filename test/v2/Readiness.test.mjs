import {test} from 'node:test';
import assert from 'node:assert/strict';
import {decodeBytes32String} from 'ethers';
import fs from 'node:fs';
import {fixture,manager,investor,sme,executor,outsider,hash} from './harness.mjs';
import {accountingInvariants} from './accountingAssertions.mjs';
const DAY=86400n;
const check=(name,fn)=>test(name,async()=>{const f=await fixture();await fn(f);await accountingInvariants(f);});
async function subscription(f,wallet,cents,review=false){
 const id=await f.get('subscriptionCount')+1n;await f.call(wallet,'requestSubscription',[cents,1n,f.unique()]);
 if(review)await f.call(manager,'approveSubscription',[id]);
 await f.call(manager,'confirmSubscriptionFunding',[id,f.unique()]);await f.call(executor,'processSubscription',[id]);return id;
}
check('realistic zero-capital lifecycle blocks undercapitalised S$4000 auto financing, then funds, offsets and redeems',async f=>{
 assert.equal(f.chainId,11155111n);assert.equal(await f.get('MAX_FUND_CENTS'),1000000000n);
 assert.equal(await f.get('owner'),manager);assert.equal(await f.get('totalSupply'),0n);assert.equal(await f.get('liquidCents'),0n);
 await f.call(manager,'setInvestor',[investor,hash('person A'),0]);await f.call(manager,'setSme',[sme,hash('company A'),false]);
 await assert.rejects(f.call(investor,'requestSubscription',[1000000n,1n,f.unique()]));
 await assert.rejects(f.call(sme,'submitInvoice',[hash('payer A'),f.unique(),f.unique(),400000n,f.time()+30n*DAY,0]));
 await f.call(manager,'setInvestor',[investor,hash('person A'),3]);await f.call(manager,'setSme',[sme,hash('company A'),true]);
 await f.call(manager,'setOperator',[executor,true,false]);await f.call(manager,'configureAutomation',[true,1000000n,500000n,0]);
 await subscription(f,investor,1000000n);
 assert.equal(await f.get('balanceOf',investor),1000000n);assert.equal(await f.get('liquidCents'),1000000n);assert.equal(await f.get('navCents'),1000000n);
 await f.call(sme,'submitInvoice',[hash('payer A'),f.unique(),f.unique(),400000n,f.time()+30n*DAY,0]);
 await f.call(manager,'attestInvoice',[1n,true,true]);assert.equal(await f.get('autoEligible',1n),false);
 await assert.rejects(f.call(executor,'approveSmallInvoice',[1n]));await assert.rejects(f.approve(1n));
 await subscription(f,investor,49000000n,true); // Manager-reviewed top-up: total S$500,000.
 assert.equal(await f.get('automaticSubscriptionCents',hash('person A')),1000000n);
 assert.equal(await f.get('autoEligible',1n),true);
 await f.call(executor,'approveSmallInvoice',[1n]);assert.equal(await f.get('financingCommitmentsCents'),398000n);
 await f.call(executor,'financeInvoice',[1n]);
 assert.equal(await f.get('liquidCents'),49602000n);assert.equal(await f.get('outstandingCents'),400000n);
 assert.equal(await f.get('processingIncomeCents'),2000n);assert.equal(await f.get('navCents'),50002000n);
 f.advance(20n*DAY);assert.equal(await f.get('accruedInterestCents'),1753n);assert.equal(await f.get('navCents'),50003753n);
 await f.call(manager,'recordCollection',[1n,400000n,true,f.unique()]);
 assert.equal(await f.get('obligationCents',1n),1753n);assert.equal(await f.get('outstandingCents'),1753n);
 await f.call(manager,'recordCollection',[1n,1753n,false,f.unique()]);
 assert.equal(await f.get('navCents'),50003753n);assert.equal(await f.get('outstandingCents'),0n);assert.equal(await f.get('collectedInterestCents'),1753n);
 await f.call(investor,'requestRedemption',[25000000n,25000000n]);await f.call(manager,'approveRedemption',[1n]);await f.call(executor,'settleRedemption',[1n]);
 assert.equal(await f.get('totalSupply'),25000000n);assert.equal(await f.get('totalRedeemedCents'),25001876n);
 assert.equal(await f.get('navCents'),25001877n);assert.equal(await f.get('balanceOf',investor),25000000n);
 const journal=f.movements.map(e=>({kind:decodeBytes32String(e.kind),nav:e.nav,cash:e.cash,income:e.income}));
 assert.equal(journal.reduce((n,e)=>n+e.nav,0n),await f.get('navCents'));
 assert.equal(journal.reduce((n,e)=>n+e.cash,0n),await f.get('liquidCents'));
 assert.equal(journal.reduce((n,e)=>n+e.income,0n),3753n);
 assert.equal(f.receipts.every(r=>r.transactionHash===null&&r.localOnly),true);
 fs.mkdirSync('supabase/.temp',{recursive:true});fs.writeFileSync('supabase/.temp/v2-readiness-lifecycle-gas.json',JSON.stringify(f.receipts.filter(r=>r.success).map(({logs,data,...r})=>r),(_,v)=>typeof v==='bigint'?v.toString():v,2)+'\n');
});
check('concurrent independent investors and SMEs complete distinct requests without sharing limits or histories',async f=>{
 await f.call(manager,'setInvestor',[investor,hash('person A'),3]);await f.call(manager,'setInvestor',[outsider,hash('person B'),3]);
 await f.call(manager,'setOperator',[executor,true,false]);await f.call(manager,'configureAutomation',[true,1000000n,500000n,0]);
 for(const wallet of [investor,outsider])await f.call(wallet,'requestSubscription',[25000000n,1n,f.unique()]);
 for(const id of [1n,2n]){await f.call(manager,'approveSubscription',[id]);await f.call(manager,'confirmSubscriptionFunding',[id,f.unique()]);await f.call(executor,'processSubscription',[id]);}
 // A second, investor-approved wallet can be an independently verified SME for this local actor-limited test.
 for(const [wallet,entity,payer] of [[sme,hash('SME A'),hash('payer A')],[outsider,hash('SME B'),hash('payer B')]]){
  await f.call(manager,'setSme',[wallet,entity,true]);await f.call(wallet,'submitInvoice',[payer,f.unique(),f.unique(),400000n,f.time()+30n*DAY,0]);
 }
 for(const id of [1n,2n]){await f.call(manager,'attestInvoice',[id,true,true]);await f.call(executor,'approveSmallInvoice',[id]);}
 assert.equal(await f.get('financingCommitmentsCents'),796000n);
 for(const id of [2n,1n])await f.call(executor,'financeInvoice',[id]);
 for(const wallet of [investor,outsider])await f.call(wallet,'requestRedemption',[25000000n,1n]);
 await f.call(manager,'confirmValuation',[f.time()+DAY]);await f.call(manager,'approveRedemption',[1n]);await f.call(manager,'approveRedemption',[2n]);
 assert.equal((await f.call(manager,'redemptions',[2n])).status,1n);
 f.advance(20n*DAY);
 for(const id of [1n,2n])await f.call(manager,'recordCollection',[id,await f.get('obligationCents',id),false,f.unique()]);
 await f.call(executor,'settleRedemption',[1n]);await f.call(executor,'allocateRedemption',[2n]);await f.call(executor,'settleRedemption',[2n]);
 assert.equal(await f.get('totalSupply'),0n);assert.equal(await f.get('navCents'),0n);
});
check('last active units cannot exit while impaired receivables can later recover',async f=>{
 await f.capital();const id=await f.invoice();await f.approve(id);await f.call(manager,'financeInvoice',[id]);
 await f.call(manager,'setImpairment',[id,500000n]);await f.call(manager,'confirmValuation',[f.time()+DAY]);
 await f.call(investor,'requestRedemption',[await f.get('balanceOf',investor),1n]);await f.call(manager,'approveRedemption',[1n]);
 assert.equal((await f.call(manager,'redemptions',[1n])).status,1n);
 assert.equal(await f.get('reservedRedemptionCents'),0n);
 await f.call(manager,'recordCollection',[id,500000n,false,f.unique()]);await f.call(manager,'allocateRedemption',[1n]);await f.call(manager,'settleRedemption',[1n]);
 assert.equal(await f.get('totalSupply'),0n);assert.equal(await f.get('navCents'),0n);
});
check('revoke and reject recovers invoice evidence from an abusive first submitter without unlocking financed evidence',async f=>{
 await f.capital();await f.call(manager,'setSme',[outsider,hash('abusive company'),true]);await f.call(manager,'setSme',[sme,hash('legitimate company'),true]);
 const document=f.unique(),reference=f.unique(),payer=hash('shared payer'),maturity=f.time()+30n*DAY;
 await f.call(outsider,'submitInvoice',[payer,document,reference,400000n,maturity,0]);
 await assert.rejects(f.call(sme,'submitInvoice',[payer,document,reference,400000n,maturity,0]));
 await f.call(manager,'setSmeStatus',[hash('abusive company'),5]);await f.call(manager,'rejectInvoice',[1n,'Evidence belongs to another verified SME']);
 await assert.rejects(f.call(outsider,'submitInvoice',[payer,document,reference,400000n,maturity,0]));
 await f.call(sme,'submitInvoice',[payer,document,reference,400000n,maturity,0]);
 await f.call(manager,'attestInvoice',[2n,true,true]);await f.approve(2n);await f.call(manager,'financeInvoice',[2n]);
 await assert.rejects(f.call(manager,'rejectInvoice',[2n,'Cannot unlock a funded invoice']));
 await assert.rejects(f.call(sme,'submitInvoice',[payer,document,reference,400000n,maturity,0]));
 await assert.rejects(f.call(manager,'financeInvoice',[1n]));
});
