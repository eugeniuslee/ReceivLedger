import { describe, expect, it, vi } from 'vitest';
import { V2Ledger } from './V2Ledger';
const wallet='0x'+'11'.repeat(20);
function fixture(){
  const values:Record<string,unknown>={MAX_FUND_CENTS:1000000000n,SME_CAP_CENTS:10000000n,totalSupply:1000n,pricingUnits:1000n,balanceOf:700n,navCents:1000n,fundAssetsCents:1000n,invoiceCount:1n,subscriptionCount:1n,redemptionCount:1n,investorEntities:'0x'+'aa'.repeat(32),automaticSubscriptionCents:500n,
    invoices:{sme:wallet,entity:'entity',payer:'payer',face:100n,advance:100n,principal:50n,commitment:0n,maturity:200n,status:3n},
    invoiceAccounting:{netCashAdvancedCents:80n,feeIncomeCents:20n,principalReceivableCents:50n,accruedBaseCents:2n,accruedOverdueCents:0n,collectedBaseCents:1n,collectedOverdueCents:0n,collectedPrincipalCents:50n,payerCollectionsCents:51n,smeCollectionsCents:0n,reservePayableCents:0n,reserveReleasedCents:0n},
    subscriptions:{investor:wallet,cents:1000n,minimumUnits:900n,funded:true,reviewed:false,status:3n},
    redemptions:{investor:wallet,units:100n,minimumCents:1n,payoutCents:0n,status:0n}};
  const calls=new Map<string,ReturnType<typeof vi.fn>>();
  const queryFilter=vi.fn().mockResolvedValue([]);
  const ledger=Object.create(V2Ledger.prototype) as V2Ledger;
  Object.defineProperty(ledger,'contract',{value:{runner:{provider:{getNetwork:async()=>({chainId:11155111n}),getBlockNumber:async()=>10000,getBlock:async()=>({timestamp:100})}},getFunction:(name:string)=>{
    if(!calls.has(name))calls.set(name,vi.fn().mockImplementation(async()=>values[name]??0n));return calls.get(name);
  },filters:{NavMovement:()=>({event:'NavMovement'})},queryFilter}});
  return {ledger,values,calls,queryFilter};
}
describe('block-pinned V2 request and repayment reads',()=>{
  it('reads actual records at one block and keeps gross/principal/interest distinct',async()=>{
    const {ledger,calls,queryFilter}=fixture(),report=await ledger.readReport(wallet);
    expect(report.automaticUsedCents).toBe(500n);
    expect(report.subscriptions[0]).toMatchObject({id:1n,cents:1000n,status:3n});
    expect(report.redemptions[0]).toMatchObject({id:1n,units:100n,status:0n});
    expect(report.invoices[0].breakdown).toMatchObject({fee:20n,principal:50n,baseInterest:2n,payerCollections:51n});
    expect(report.assets.activeUnits).toBe(800n);
    for(const call of calls.values())for(const args of call.mock.calls)expect(args.at(-1)).toEqual({blockTag:10000});
    expect(queryFilter).toHaveBeenCalledTimes(5);
    expect(report.movements).toEqual([]);
  });
  it('rejects a missing accounting record instead of creating a zero-valued repayment',async()=>{
    const {ledger,calls}=fixture();
    await ledger.readFund(wallet);
    calls.set('invoiceAccounting',vi.fn().mockRejectedValue(new Error('RPC failed')));
    await expect(ledger.readReport(wallet)).rejects.toThrow('RPC failed');
  });
  it('refuses partial histories above the prototype subscription bound',async()=>{
    const {ledger,values}=fixture();values.subscriptionCount=1001n;
    await expect(ledger.readReport(wallet)).rejects.toThrow('1000-record bound');
  });
});
