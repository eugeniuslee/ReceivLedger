import { createVM } from '@ethereumjs/vm';
import { Common, Sepolia, Hardfork } from '@ethereumjs/common';
import { createBlock } from '@ethereumjs/block';
import { createAddressFromString, createAccount, hexToBytes, bytesToHex } from '@ethereumjs/util';
import { Interface, id as hash } from 'ethers';
import { compileV2 } from '../../scripts/compile-v2.mjs';
export const compiled = compileV2();
export const iface = new Interface(compiled.abi);
export const actors = ['0x'+'11'.repeat(20), '0x'+'22'.repeat(20), '0x'+'33'.repeat(20), '0x'+'44'.repeat(20), '0x'+'55'.repeat(20)];
export const [manager, investor, sme, executor, outsider] = actors;
export { hash };
export async function fixture({ initialOwner=manager, deployer=manager, gasLimit=16777216n }={}) {
  const common = new Common({ chain: Sepolia, hardfork: Hardfork.Osaka });
  const vm = await createVM({ common });
  for (const a of actors) await vm.stateManager.putAccount(createAddressFromString(a), createAccount({ balance: 0n }));
  let now = 1800000000n; let nonce = 0;
  const block = () => createBlock({ header: { timestamp: now, gasLimit: 60000000n } }, { common });
  const receipts=[];
  async function execute(from,to,data,read=false){
    // Mirror transaction-boundary cleanup in @ethereumjs/vm runTx. No signing or network.
    await vm.evm.journal.cleanup();vm.stateManager.originalStorageCache.clear();
    for(const address of vm.evm.precompiles.keys())vm.evm.journal.addAlwaysWarmAddress(address);
    vm.evm.journal.addAlwaysWarmAddress(from);if(to)vm.evm.journal.addAlwaysWarmAddress(to.toString());
    vm.evm.journal.addAlwaysWarmAddress(block().header.coinbase.toString());
    const bytes=hexToBytes(data);let calldataGas=0n,tokens=0n;
    for(const byte of bytes){calldataGas+=byte===0?4n:16n;tokens+=byte===0?1n:4n;}
    const intrinsic=21000n+calldataGas+(to?0n:32000n+2n*BigInt(Math.ceil(bytes.length/32)));
    const floor=21000n+10n*tokens;
    const r=await vm.evm.runCall({caller:createAddressFromString(from),to,data:bytes,gasLimit:gasLimit-intrinsic,block:block(),isStatic:read,skipNonceIncrement:read});
    const gross=intrinsic+r.execResult.executionGasUsed,refund=r.execResult.gasRefund??0n;
    const cappedRefund=refund<gross/5n?refund:gross/5n;
    const used=gross-cappedRefund>floor?gross-cappedRefund:floor;
    if(!read)receipts.push({method:to?iface.parseTransaction({data})?.name:'constructor',from,timestamp:now,data,gas:used,preRefundGas:gross,success:!r.execResult.exceptionError,logs:r.execResult.logs??[],localOnly:true,transactionHash:null});
    return r;
  }
  const deploymentData='0x'+compiled.evm.bytecode.object+iface.encodeDeploy([initialOwner]).slice(2);
  const deploy = await execute(deployer,undefined,deploymentData);
  if (deploy.execResult.exceptionError) throw new Error('Local EVM construction failed: '+deploy.execResult.exceptionError.error);
  const to = deploy.createdAddress;
  const movements = [];
  async function call(from, method, args = []) {
    const fragment=iface.getFunction(method),read=['view','pure'].includes(fragment.stateMutability);
    const r = await execute(from,to,iface.encodeFunctionData(method,args),read);
    if (r.execResult.exceptionError) {
      const data=bytesToHex(r.execResult.returnValue); let reason;
      try { reason=iface.parseError(data)?.args[0]; } catch {}
      throw new Error(String(reason ?? r.execResult.exceptionError.error));
    }
    for (const log of r.execResult.logs ?? []) { try { const e=iface.parseLog({topics:log[1].map(bytesToHex),data:bytesToHex(log[2])}); if(e?.name==='NavMovement')movements.push(e.args); } catch {} }
    return iface.decodeFunctionResult(method,bytesToHex(r.execResult.returnValue));
  }
  const get = async (method, ...args) => (await call(manager,method,args))[0];
  const unique = () => hash('local-fixture-'+(++nonce));
  async function capital(cents=100000000n) {
    await call(manager,'setInvestor',[investor,hash('verified-investor'),3]);
    const id=await get('subscriptionCount')+1n;
    await call(investor,'requestSubscription',[cents,1n,unique()]);
    await call(manager,'approveSubscription',[id]); await call(manager,'confirmSubscriptionFunding',[id,unique()]);
    await call(manager,'processSubscription',[id]); return id;
  }
  async function invoice(face=500000n, { payer=hash('payer'), lowRisk=true, maturity=now+30n*86400n, late=0, borrower=sme }={}) {
    await call(manager,'setSme',[borrower,hash('verified-company'),true]);
    const id=await get('invoiceCount')+1n;
    await call(borrower,'submitInvoice',[payer,unique(),unique(),face,maturity,late]);
    await call(manager,'attestInvoice',[id,lowRisk,true]); return id;
  }
  const approve = async id => { await call(manager,'acknowledgeConcentration',[id]); return call(manager,'approveInvoice',[id]); };
  return { call,get,unique,capital,invoice,approve,movements,receipts,deploymentData,chainId:common.chainId(), address: to.toString(), time: () => now, advance: seconds => { now+=BigInt(seconds); } };
}
