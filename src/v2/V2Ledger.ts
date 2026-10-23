import { Contract, isAddress, type ContractRunner } from 'ethers';
import abi from './abi.json';
import { RECEIVLEDGER_ADDRESS } from '../chain/abi';
import {decodeBytes32String} from 'ethers';
import {concentrationReport,myAssets,type ReportingInvoice} from './reporting';
import policyErrors from './policyErrors.json';
/** Explicit independent V2 address only. Nothing reads an address from V1 configuration. */
export class V2Ledger {
  readonly contract: Contract;
  constructor(address: string, runner: ContractRunner) {
    if (!isAddress(address) || /^0x0{40}$/i.test(address) || address.toLowerCase() === RECEIVLEDGER_ADDRESS.toLowerCase()) throw new Error('An independently deployed V2 address is required.');
    this.contract = new Contract(address, abi, runner);
  }
  async readFund(wallet: string) {
    if (!isAddress(wallet)) throw new Error('Invalid wallet.');
    const provider = this.contract.runner?.provider;
    if (!provider || (await provider.getNetwork()).chainId !== 11155111n) throw new Error('V2 reads require Sepolia.');
    const blockTag = await provider.getBlockNumber();
    const names = ['MAX_FUND_CENTS','SME_CAP_CENTS','navCents','fundAssetsCents','liquidCents','freeLiquidityCents','outstandingCents','accruedInterestCents','bookedAccruedCents','earnedInterestCents','impairmentCents','pricingUnits','totalSupply','reservedRedemptionCents','financingCommitmentsCents','pendingSubscriptionCents','smeReservePoolCents','processingIncomeCents','collectedInterestCents','invoiceCount','subscriptionCount','redemptionCount','automationEnabled','paused','owner'];
    const values = await Promise.all(names.map(name => this.contract.getFunction(name)({blockTag})));
    if (values[0] !== 1_000_000_000n||values[1]!==10_000_000n) throw new Error('Unexpected V2 contract policy.');
    const [units,approvedInvestor,verifiedSme] = await Promise.all(['balanceOf','investors','verifiedSmes'].map(name=>this.contract.getFunction(name)(wallet,{blockTag})));
    return { blockTag, wallet, units: BigInt(units), approvedInvestor: Boolean(approvedInvestor), verifiedSme: Boolean(verifiedSme), fund: Object.fromEntries(names.map((name,index)=>[name,values[index]])) };
  }
  async readReport(wallet:string){
    const snapshot=await this.readFund(wallet),provider=this.contract.runner!.provider!,blockTag=snapshot.blockTag;
    const block=await provider.getBlock(blockTag);if(!block)throw new Error('Reporting block unavailable');
    const invoiceCount=Number(snapshot.fund.invoiceCount),redemptionCount=Number(snapshot.fund.redemptionCount);
    if(invoiceCount>1000||redemptionCount>1000)throw new Error('Complete report exceeds the prototype 1000-record bound. Use a reviewed indexer; partial totals are not displayed.');
    const invoices:ReportingInvoice[]=[];let pendingUnits=0n,allocatedClaim=0n;
    for(let first=1;first<=invoiceCount;first+=10){
      const page=await Promise.all(Array.from({length:Math.min(10,invoiceCount-first+1)},async(_,offset)=>{
        const id=BigInt(first+offset),[i,a]=await Promise.all([this.contract.getFunction('invoices')(id,{blockTag}),this.contract.getFunction('invoiceAccounting')(id,{blockTag})]);
        return {id,entity:String(i.entity),payer:String(i.payer),face:BigInt(i.face),advance:BigInt(i.advance),principal:BigInt(i.principal),commitment:BigInt(i.commitment),maturity:BigInt(i.maturity),status:BigInt(i.status),collectedBase:BigInt(a.collectedBaseCents),collectedOverdue:BigInt(a.collectedOverdueCents),collectedPrincipal:BigInt(a.collectedPrincipalCents)};
      }));invoices.push(...page);
    }
    for(let first=1;first<=redemptionCount;first+=10){
      const page=await Promise.all(Array.from({length:Math.min(10,redemptionCount-first+1)},(_,offset)=>this.contract.getFunction('redemptions')(first+offset,{blockTag})));
      for(const r of page)if(String(r.investor).toLowerCase()===wallet.toLowerCase()){
        if(r.status===0n||r.status===1n)pendingUnits+=BigInt(r.units);if(r.status===2n)allocatedClaim+=BigInt(r.payoutCents);
      }
    }
    const fromBlock=Math.max(0,blockTag-9999);
    const movements=await this.readMovements(fromBlock,blockTag);
    return {...snapshot,timestamp:BigInt(block.timestamp),concentrations:concentrationReport(invoices,BigInt(snapshot.fund.navCents),BigInt(block.timestamp)),
      assets:myAssets(BigInt(snapshot.fund.navCents),BigInt(snapshot.fund.pricingUnits),snapshot.units,pendingUnits,allocatedClaim),movements,movementsFromBlock:fromBlock};
  }
  async readMovements(fromBlock:number,toBlock:number){
    if(!Number.isSafeInteger(fromBlock)||!Number.isSafeInteger(toBlock)||fromBlock<0||toBlock<fromBlock||toBlock-fromBlock>=10000)throw new Error('Read at most 10000 blocks per movement page');
    const provider=this.contract.runner?.provider;if(!provider||(await provider.getNetwork()).chainId!==11155111n)throw new Error('Sepolia required');
    const logs=await this.contract.queryFilter(this.contract.filters.NavMovement(),fromBlock,toBlock);
    return logs.map(log=>{
      const event=this.contract.interface.parseLog(log);if(!event)throw new Error('Invalid accounting event');const a=event.args;
      return {timestamp:BigInt(a.timestamp),reference:BigInt(a.refId),kind:decodeBytes32String(a.kind),cash:BigInt(a.cash),loans:BigInt(a.loans),income:BigInt(a.income),nav:BigInt(a.nav),transaction:log.transactionHash,block:log.blockNumber,index:log.index};
    });
  }
  /** Future explicit wallet-driven execution only; the current V2 preview never calls this. */
  async execute(method: 'requestSubscription'|'requestRedemption'|'cancelSubscription'|'cancelRedemption'|'transfer'|'submitInvoice'|'approveInvoice'|'rejectInvoice'|'financeInvoice'|'recordCollection'|'approveSubscription'|'processSubscription'|'approveRedemption'|'allocateRedemption'|'settleRedemption', args: readonly unknown[]) {
    const runner=this.contract.runner;
    if (!runner?.sendTransaction || !runner.provider || (await runner.provider.getNetwork()).chainId!==11155111n) throw new Error('An explicitly connected Sepolia signer is required.');
    let tx;
    try{tx=await this.contract.getFunction(method)(...args);}catch(cause){
      const data=(cause as {data?:string}).data;
      if(data){const error=this.contract.interface.parseError(data);if(error?.name==='PolicyViolation')throw new Error((policyErrors as Record<string,string>)[String(error.args[0])]??'V2 policy rejected');}
      throw cause;
    }
    const receipt=await tx.wait();
    if (!receipt || receipt.status!==1) throw new Error('V2 transaction was not confirmed.');
    return receipt;
  }
}
