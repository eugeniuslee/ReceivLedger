import assert from 'node:assert/strict';
import {test} from 'node:test';
import childProcess from 'node:child_process';
import {syncBuiltinESMExports} from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath,pathToFileURL} from 'node:url';
import solc from 'solc';
import {keccak256} from 'ethers';
import {parseArguments,roleAddress,checkNetwork,prepare,V1} from '../../scripts/prepare-v2-deployment.mjs';
import {compiled,manager} from './harness.mjs';
import {classifySender,checkTarget,gasAllowance,DELEGATOR,AMSTERDAM_TIMESTAMP} from '../../scripts/v2-deployment-policy.mjs';
import {amsterdamDryRun} from '../../scripts/v2-amsterdam-dry-run.mjs';

// Exercise the historical deployment guard without checking out a different branch.
// Repository root, commit, worktree status and all preparation checks remain real.
async function withGitBranch(t,branch,run){
 const original=childProcess.execFileSync;
 const replacement=t.mock.method(childProcess,'execFileSync',(file,args,options)=>
  file==='git'&&args.length===2&&args[0]==='branch'&&args[1]==='--show-current'
   ?branch+'\n':original(file,args,options));
 syncBuiltinESMExports();
 try{return await run();}finally{replacement.mock.restore();syncBuiltinESMExports();}
}

async function reviewedCheckout(t){
 const sourceRoot=fileURLToPath(new URL('../../',import.meta.url));
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'receivledger-reviewed-test-'));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 for(const name of ['package.json','contracts/ReceivLedgerV2.sol','test/v2/harness.mjs',
  'scripts/prepare-v2-deployment.mjs','scripts/compile-v2.mjs','scripts/v2-deployment-policy.mjs','scripts/v2-amsterdam-dry-run.mjs']){
  const target=path.join(root,name);fs.mkdirSync(path.dirname(target),{recursive:true});
  const source=fs.readFileSync(path.join(sourceRoot,name));
  // The approved historical source hash records Windows CRLF bytes. Restore
  // them only in this disposable checkout, leaving the user's contract intact.
  fs.writeFileSync(target,name.endsWith('.sol')?source.toString('utf8').replace(/\r?\n/g,'\r\n'):source);
 }
 fs.symlinkSync(path.join(sourceRoot,'node_modules'),path.join(root,'node_modules'),'junction');
 const git=args=>childProcess.execFileSync('git',args,{cwd:root,encoding:'utf8',stdio:'pipe'});
 git(['init','--initial-branch=feat/v2-financing-redemption']);git(['add','.']);
 git(['-c','user.name=ReceivLedger test fixture','-c','user.email=fixture@example.invalid','-c','commit.gpgsign=false','commit','-m','Reviewed deployment fixture']);
 const module=await import(pathToFileURL(path.join(root,'scripts/prepare-v2-deployment.mjs')).href);
 return {root,prepare:module.prepare};
}

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
test('deployment preparation rejects another feature branch',async t=>{
 await withGitBranch(t,'feat/unreviewed-change',()=>assert.rejects(prepare(parseArguments([])),/The V2 development repository and branch are required/));
});
test('deployment script offline dry run creates an unsigned, independent zero-capital plan',async t=>{
 const checkout=await reviewedCheckout(t);
 const result=await checkout.prepare(parseArguments([]));
 assert.equal(result.plan.repository.branch,'feat/v2-financing-redemption');
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
 const source=path.join(checkout.root,'contracts/ReceivLedgerV2.sol');
 fs.writeFileSync(source,fs.readFileSync(source,'utf8').replace(/\r\n/g,'\n'));
 await assert.rejects(checkout.prepare(parseArguments([])),/Reviewed Solidity source changed/);
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
