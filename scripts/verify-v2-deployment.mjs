// Read-only deployment verification. No signer, secret import or broadcast path.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { AbiCoder, Contract, FetchRequest, JsonRpcProvider, getCreateAddress, keccak256 } from 'ethers';
import { compileV2 } from './compile-v2.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const deployment = JSON.parse(fs.readFileSync(path.join(root,'src/v2/deployment.json'),'utf8'));
const same = (a,b) => typeof a==='string' && a.toLowerCase()===b.toLowerCase();
export async function verifyDeployment(provider, compiled = compileV2()) {
  const abiFile = fs.readFileSync(path.join(root,'src/v2/abi.json'),'utf8');
  const abi = JSON.parse(abiFile);
  assert.deepEqual(compiled.abi,abi,'Checked-in V2 ABI must match reviewed compilation.');
  assert.equal(compiled.warnings.length,0,'Review compiler warnings.');
  assert.equal(BigInt(await provider.send('eth_chainId',[])),BigInt(deployment.chainId),'Sepolia required.');
  const [tx,receipt,block] = await Promise.all([provider.getTransaction(deployment.transactionHash),provider.getTransactionReceipt(deployment.transactionHash),provider.getBlock('latest')]);
  assert(tx && receipt && block,'Deployment transaction, receipt and latest block required.');
  assert.equal(receipt.status,1,'Successful deployment receipt required.');
  assert.equal(tx.to,null,'Expected direct contract creation.');
  assert.equal(tx.type,2,'Expected reviewed type-2 creation.');
  assert.equal(tx.value,0n,'Expected zero-value creation.');
  assert(same(tx.from,deployment.manager),'Unexpected deployer.');
  assert(same(receipt.contractAddress,deployment.address),'Receipt created a different address.');
  assert.equal(receipt.blockNumber,deployment.deploymentBlock,'Unexpected deployment block.');
  assert(same(getCreateAddress({from:tx.from,nonce:tx.nonce}),deployment.address),'CREATE address mismatch.');
  assert(block.number>=receipt.blockNumber+1,'At least two confirmations required.');
  const payload='0x'+compiled.evm.bytecode.object+AbiCoder.defaultAbiCoder().encode(['address'],[deployment.manager]).slice(2);
  assert.equal(tx.data.toLowerCase(),payload.toLowerCase(),'Creation code / Manager constructor mismatch.');
  assert.equal(keccak256(tx.data),deployment.creationDataHash,'Reviewed creation hash mismatch.');
  const [code,deployedAt] = await Promise.all([provider.getCode(deployment.address,block.number),provider.getBlock(receipt.blockNumber)]);
  assert.equal(code.toLowerCase(),'0x'+compiled.evm.deployedBytecode.object.toLowerCase(),'Runtime differs from reviewed compiled bytecode.');
  assert.equal(keccak256(code),deployment.runtimeHash,'Reviewed runtime hash mismatch.');
  const contract = new Contract(deployment.address,abi,provider),at={blockTag:block.number};
  const names=['owner','pendingOwner','automationEnabled','paused','totalSupply','navCents','liquidCents','outstandingCents','invoiceCount','subscriptionCount','redemptionCount','newInvoiceOverdueBps'];
  const values=await Promise.all(names.map(name=>contract.getFunction(name)(at)));
  const state=Object.fromEntries(names.map((name,index)=>[name,values[index]]));
  assert(same(state.owner,deployment.manager),'Current owner is not the reviewed Manager.');
  const [explicitExecutor,explicitAttestor]=await Promise.all([contract.executors(deployment.manager,at),contract.invoiceAttestors(deployment.manager,at)]);
  return {schema:1,verification:'PASS',verificationMode:'READ_ONLY_RPC_AND_LOCAL_COMPILATION',...deployment,
    deployedAtUtc:deployedAt?.date?.toISOString()??null,readBlock:block.number,readBlockHash:block.hash,readBlockTimeUtc:block.date?.toISOString()??null,
    confirmations:block.number-receipt.blockNumber+1,receiptStatus:receipt.status,deployer:tx.from,nonce:tx.nonce,type:tx.type,valueWei:String(tx.value),
    runtimeBytes:(code.length-2)/2,creationBytesWithArguments:(tx.data.length-2)/2,
    compiler:compiled.compiler,settings:{optimizerRuns:200,viaIR:true,evmVersion:'cancun',openzeppelin:'5.6.1'},
    sourceSha256:createHash('sha256').update(fs.readFileSync(path.join(root,'contracts/ReceivLedgerV2.sol'))).digest('hex'),
    abiSha256:createHash('sha256').update(abiFile).digest('hex'),abiMatchesCompilation:true,runtimeMatchesCompilation:true,creationMatchesCompilation:true,
    state,managerPermissions:{currentOwner:true,explicitExecutor,explicitAttestor,ownerImplicitExecutorAndAttestor:true,
    basis:'owner() matches and exact compiled runtime retains reviewed onlyOwner / owner-or-operator permissions; no state-changing call was sent.'},
    limits:['Snapshot only; future permissions/balances may change.','Explorer source publication was not verified.','Private registry, document binding, automation workers and signed frontend execution were not activated or tested live.']};
}
const stringify = value=>JSON.stringify(value,(_,v)=>typeof v==='bigint'?v.toString():v,2)+'\n';
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  let provider;
  try{
    assert(process.argv.slice(2).every(arg=>arg==='--write-report'),'Only --write-report is supported.');
    const request=new FetchRequest('https://ethereum-sepolia-rpc.publicnode.com'); request.timeout=20000;
    provider=new JsonRpcProvider(request,11155111,{staticNetwork:true});
    const result=await verifyDeployment(provider);
    if(process.argv.includes('--write-report'))fs.writeFileSync(path.join(root,'docs/V2_DEPLOYMENT_VERIFICATION.json'),stringify(result));
    console.log(stringify(result));
  }catch(cause){console.error('Read-only verification failed: '+(cause.shortMessage??cause.message));process.exitCode=1;}
  finally{provider?.destroy();}
}
