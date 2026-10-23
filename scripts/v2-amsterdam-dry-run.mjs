// Unsigned in-memory transaction execution only. Never connected to a provider.
import {createVM,runTx} from '@ethereumjs/vm';
import {Common,Sepolia,Hardfork} from '@ethereumjs/common';
import {createBlock} from '@ethereumjs/block';
import {createFeeMarket1559Tx} from '@ethereumjs/tx';
import {createAddressFromString,createAccount,hexToBytes,bytesToHex} from '@ethereumjs/util';
import {Interface,keccak256} from 'ethers';
export async function amsterdamDryRun({deployer,manager,data,abi,senderCode='0x',target,targetCode='0x',gasLimit=60000000n,blockGasLimit=200000000n,nonce=0,balance=10n**18n}){
  const common=new Common({chain:Sepolia,hardfork:Hardfork.Amsterdam});
  if(!common.isActivatedEIP(8037))throw new Error('State-gas accounting not active.');
  const vm=await createVM({common});
  const sender=createAddressFromString(deployer);
  await vm.stateManager.putAccount(sender,createAccount({balance,nonce:BigInt(nonce)}));
  if(senderCode!=='0x')await vm.stateManager.putCode(sender,hexToBytes(senderCode));
  if(target)await vm.stateManager.putCode(createAddressFromString(target),hexToBytes(targetCode));
  const block=createBlock({header:{timestamp:1792728000n,gasLimit:blockGasLimit,baseFeePerGas:0n}},{common});
  const tx=createFeeMarket1559Tx({chainId:11155111n,nonce:BigInt(nonce),gasLimit,maxFeePerGas:0n,maxPriorityFeePerGas:0n,value:0n,data:hexToBytes(data)},{common,freeze:false});
  // Supply the public sender to the offline VM; there is no key or signature.
  tx.getSenderAddress=()=>sender;
  const result=await runTx(vm,{tx,block});
  if(result.execResult.exceptionError)throw new Error('Amsterdam creation failed: '+result.execResult.exceptionError.error);
  if(!result.createdAddress)throw new Error('No CREATE address.');
  const runtime=await vm.stateManager.getCode(result.createdAddress),iface=new Interface(abi);
  for(const [method,expected] of [['owner',manager.toLowerCase()],['totalSupply',0n],['liquidCents',0n],['outstandingCents',0n],['automationEnabled',false]]){
    const call=await vm.evm.runCall({caller:sender,to:result.createdAddress,data:hexToBytes(iface.encodeFunctionData(method)),isStatic:true,gasLimit:1000000n,block});
    if(call.execResult.exceptionError)throw new Error('Initial state read failed.');
    const value=iface.decodeFunctionResult(method,bytesToHex(call.execResult.returnValue))[0];
    if((typeof value==='string'?value.toLowerCase():value)!==expected)throw new Error('Unexpected '+method);
  }
  if(bytesToHex(await vm.stateManager.getCode(sender))!==senderCode)throw new Error('Sender delegation changed in simulation.');
  return {hardfork:'amsterdam',signed:false,type:2,gasUsed:result.totalGasSpent,createdAddress:result.createdAddress.toString(),runtimeHash:keccak256(runtime),initialStateVerified:true,delegationUnchanged:true};
}
