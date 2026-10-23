import assert from 'node:assert/strict';
import { manager, investor, sme, executor, outsider } from './harness.mjs';

export async function accountingInvariants(f) {
  const get=f.get;
  const liquid=await get('liquidCents'), outstanding=await get('outstandingCents'), impairment=await get('impairmentCents');
  const reserved=await get('reservedRedemptionCents'), supply=await get('totalSupply');
  const accrued=await get('accruedInterestCents'), commitments=await get('financingCommitmentsCents');
  assert(liquid>=reserved+commitments);assert(outstanding+accrued>=impairment);
  assert.equal(await get('fundAssetsCents'),liquid+outstanding+accrued-impairment);
  assert.equal(await get('navCents')+reserved,await get('fundAssetsCents'));
  assert.equal(await get('custodialAssetsCents')-await get('fundLiabilitiesCents'),await get('navCents'));
  assert.equal(await get('fundAssetsCents')+await get('totalRedeemedCents'),await get('totalSubscribedCents')+await get('processingIncomeCents')+await get('collectedInterestCents')+accrued-impairment);
  assert.equal(liquid+await get('totalRedeemedCents')+await get('netAdvancedCents'),await get('totalSubscribedCents')+await get('principalCollectedCents')+await get('collectedInterestCents'));
  let loans=0n,losses=0n,escrow=0n,committed=0n,reserve=0n,smeReserve=0n,base=0n,late=0n,principalPaid=0n,fees=0n,netAdvanced=0n,pending=0n;
  const entity=new Map(), wallets=new Map(), payers=new Map();
  const entityCommit=new Map(),payerCommit=new Map(),autoExposure=new Map(),autoCommit=new Map();let netCommitments=0n,liveAccrued=0n;
  const add=(map,key,value)=>map.set(key,(map.get(key)??0n)+value);
  for(let id=1n;id<=await get('invoiceCount');id++){
    const i=await f.call(manager,'invoices',[id]);const a=(await f.call(manager,'invoiceAccounting',[id]))[0];
    loans+=i.principal;losses+=i.impairment;smeReserve+=i.reservePayable;
    add(entity,i.entity,i.principal);add(wallets,i.sme,i.principal);add(payers,i.payer,i.principal);
    add(entityCommit,i.entity,i.commitment>0n?i.advance:0n);add(payerCommit,i.payer,i.commitment>0n?i.advance:0n);netCommitments+=i.commitment;
    add(autoExposure,i.entity,i.automatic?i.principal:0n);add(autoCommit,i.entity,i.automatic&&i.commitment>0n?i.advance:0n);
    liveAccrued+=a.accruedBaseCents+a.accruedOverdueCents;
    assert.equal(a.principalReceivableCents,i.principal);assert.equal(a.accruedBaseCents+a.accruedOverdueCents+i.principal,await get('obligationCents',id));
    assert.equal(a.payerCollectionsCents+a.smeCollectionsCents,a.collectedBaseCents+a.collectedOverdueCents+a.collectedPrincipalCents+a.reservePayableCents+a.reserveReleasedCents);
    base+=a.collectedBaseCents;late+=a.collectedOverdueCents;principalPaid+=a.collectedPrincipalCents;fees+=a.feeIncomeCents;netAdvanced+=a.netCashAdvancedCents;
  }
  for(const [key,value] of entity)assert.equal(await get('entityExposureCents',key),value);
  for(const [key,value] of wallets)assert.equal(await get('smeExposureCents',key),value);
  for(const [key,value] of payers)assert.equal(await get('payerExposureCents',key),value);
  for(const [key,value] of entityCommit)assert.equal(await get('entityCommitmentsCents',key),value);
  for(const [key,value] of payerCommit)assert.equal(await get('payerCommitmentsCents',key),value);
  for(const [key,value] of autoExposure)assert.equal(await get('entityAutoExposureCents',key),value);
  for(const [key,value] of autoCommit)assert.equal(await get('entityAutoCommitmentsCents',key),value);
  assert.equal(netCommitments,commitments);assert.equal(liveAccrued,accrued);
  for(let id=1n;id<=await get('redemptionCount');id++){
    const r=await f.call(manager,'redemptions',[id]);if(r.status<=2n)escrow+=r.units;if(r.status===2n){committed+=r.units;reserve+=r.payoutCents;}
  }
  for(let id=1n;id<=await get('subscriptionCount');id++){
    const s=await f.call(manager,'subscriptions',[id]);if(s.funded&&[0n,1n,2n,5n].includes(s.status))pending+=s.cents;
  }
  assert.equal(await get('pendingSubscriptionCents'),pending);
  assert.equal(await get('custodialCashCents'),liquid+pending+smeReserve);
  assert.equal(loans,outstanding);assert.equal(losses,impairment);assert.equal(await get('smeReservePoolCents'),smeReserve);
  assert.equal(base,await get('collectedBaseInterestCents'));assert.equal(late,await get('collectedOverdueInterestCents'));assert.equal(base+late,await get('collectedInterestCents'));
  assert.equal(principalPaid,await get('principalCollectedCents'));assert.equal(fees,await get('processingIncomeCents'));assert.equal(netAdvanced,await get('netAdvancedCents'));
  assert.equal(await get('balanceOf',f.address),escrow);assert.equal(await get('reservedRedemptionUnits'),committed);assert.equal(reserved,reserve);
  assert.equal(await get('pricingUnits')+committed,supply);
  const balances=await Promise.all([manager,investor,sme,executor,outsider,f.address].map(a=>get('balanceOf',a)));
  assert.equal(balances.reduce((a,b)=>a+b,0n),supply);
}
