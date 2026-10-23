import assert from 'node:assert/strict';
import {test} from 'node:test';
import solc from 'solc';
import {keccak256} from 'ethers';
import {parseArguments,roleAddress,checkNetwork,prepare,V1} from '../../scripts/prepare-v2-deployment.mjs';
import {compiled,manager} from './harness.mjs';
import {classifySender,checkTarget,gasAllowance,DELEGATOR,AMSTERDAM_TIMESTAMP} from '../../scripts/v2-deployment-policy.mjs';
import {amsterdamDryRun} from '../../scripts/v2-amsterdam-dry-run.mjs';

test('unsigned Amsterdam type-2 CREATE from delegated EOA preserves delegation without executing sender code',async()=>{
 const data='0x'+compiled.evm.bytecode.object+'0'.repeat(24)+manager.slice(2);
 const result=await amsterdamDryRun({deployer:manager,manager,data,abi:compiled.abi,senderCode:'0xef0100'+DELEGATOR.slice(2),target:DELEGATOR,targetCode:'0x60006000fd',gasLimit:45338288n,nonce:26});
 assert.equal(result.initialStateVerified,true);assert.equal(result.delegationUnchanged,true);
 assert.equal(result.runtimeHash,keccak256('0x'+compiled.evm.deployedBytecode.object));
 assert.equal(result.signed,false);assert.equal(result.type,2);
});

test('delegation inspection fails closed for arbitrary code, unknown targets and changed implementation',()=>{
 assert.equal(classifySender('0x').kind,'EOA');
 assert.equal(classifySender('0xef0100'+DELEGATOR.slice(2)).target.toLowerCase(),DELEGATOR);
 for(const code of ['0x1234','0xef0100'+'11'.repeat(20),'0xef0100'+DELEGATOR.slice(2)+'00'])assert.throws(()=>classifySender(code));
 assert.throws(()=>checkTarget('0x'));
});
test('gas bounds distinguish Amsterdam state gas from pre-Amsterdam transaction cap',()=>{
 assert.equal(gasAllowance(37781906n,200000000n,AMSTERDAM_TIMESTAMP),45338288n);
 assert.throws(()=>gasAllowance(37781906n,200000000n,AMSTERDAM_TIMESTAMP-1));
 assert.throws(()=>gasAllowance(37781906n,40000000n,AMSTERDAM_TIMESTAMP));
 assert.throws(()=>gasAllowance(4294967295n,10000000000n,AMSTERDAM_TIMESTAMP));
 assert.throws(()=>gasAllowance(0n,200000000n,AMSTERDAM_TIMESTAMP));
});

test('deployment preparation rejects broadcasting switches, wrong networks and unsafe role addresses',()=>{
 for(const args of [['--broadcast'],['--private-key','secret'],['--manager',manager],['--rpc','http://public.test'],['--rpc','https://user:password@rpc.test'],['--manager',manager,'--manager',manager]])assert.throws(()=>parseArguments(args));
 for(const address of ['0x'+'00'.repeat(20),V1,'not-an-address'])assert.throws(()=>roleAddress(address));
 assert.throws(()=>checkNetwork(1n));assert.throws(()=>checkNetwork(31337n));checkNetwork(11155111n);
});
test('deployment script offline dry run creates an unsigned, independent zero-capital plan',async()=>{
 const result=await prepare(parseArguments([]));
 assert.equal(result.plan.broadcasted,false);assert.equal(result.plan.placeholderRoles,true);assert.equal(result.plan.mode,'UNSIGNED_ONLY');
 assert.equal(result.plan.chainId,11155111n);assert.equal(result.plan.manager,manager);assert.equal(result.transaction.to,undefined);
 assert.equal(result.transaction.value,'0x0');assert.equal(result.plan.deploymentDataHash,keccak256(result.transaction.data));
 assert.equal(result.constructorArguments.length,64);assert(result.plan.localOsakaGasEstimate<16777216n);assert(result.plan.runtimeBytes<=24576);assert(result.plan.creationBytesWithArguments<=49152);
 assert.equal(result.transaction.signature,undefined);assert.equal(result.plan.rpcCheck,null);
 assert.equal(result.transaction.type,'0x2');assert.equal(result.transaction.authorizationList,undefined);
 assert.equal(result.plan.offlineAmsterdam.initialStateVerified,true);
 assert.equal(result.plan.offlineAmsterdam.delegationUnchanged,true);
 assert.equal(result.plan.offlineAmsterdam.runtimeHash,result.plan.expectedRuntimeHash);
 assert(BigInt(result.transaction.gas)>=result.plan.offlineAmsterdam.gasUsed);
});
test('self-contained source-verification input recompiles to the exact creation/runtime bytecode',()=>{
 assert(Object.keys(compiled.standardInput.sources).some(name=>name.startsWith('@openzeppelin/contracts/')));
 const result=JSON.parse(solc.compile(JSON.stringify(compiled.standardInput)));
 assert.equal((result.errors??[]).filter(e=>e.severity==='error').length,0);
 const contract=result.contracts['contracts/ReceivLedgerV2.sol'].ReceivLedgerV2;
 assert.equal(contract.evm.bytecode.object,compiled.evm.bytecode.object);
 assert.equal(contract.evm.deployedBytecode.object,compiled.evm.deployedBytecode.object);
 assert.deepEqual(contract.abi,compiled.abi);
});
