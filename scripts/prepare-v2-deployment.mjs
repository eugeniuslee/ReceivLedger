// Read-only deployment preparation. No signer, wallet import, signing or broadcasting path exists.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {randomUUID,createHash} from 'node:crypto';
import {FetchRequest,JsonRpcProvider,getAddress,getCreateAddress,isAddress,keccak256,toBeHex} from 'ethers';
import {compiled,fixture,manager as placeholderManager} from '../test/v2/harness.mjs';
import {classifySender,checkTarget,gasAllowance,REVIEWED_CREATION_HASH,REVIEWED_RUNTIME_HASH} from './v2-deployment-policy.mjs';
import {amsterdamDryRun} from './v2-amsterdam-dry-run.mjs';

export const V1='0x18c6751a1a116053e413459464c9b1af356dbf1f';
export const CHAIN_ID=11155111n;
const root=fs.realpathSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'));
export function parseArguments(argv){
  const options={};
  for(let n=0;n<argv.length;n++){
    const key=argv[n];
    if(!['--manager','--deployer','--rpc'].includes(key)||options[key.slice(2)]!==undefined||!argv[n+1]||argv[n+1].startsWith('--'))throw new Error('Only --manager, --deployer and --rpc are accepted. Broadcasting is not supported.');
    options[key.slice(2)]=argv[++n];
  }
  if(Boolean(options.manager)!==Boolean(options.deployer))throw new Error('Specify both public role addresses or neither for a placeholder dry run.');
  if(options.rpc){const url=new URL(options.rpc);if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash)throw new Error('Use a public HTTPS RPC without credentials, query or fragment.');}
  return options;
}
export function roleAddress(value){
  if(!isAddress(value)||/^0x0{40}$/i.test(value)||value.toLowerCase()===V1)throw new Error('A nonzero independent public wallet address is required.');
  return getAddress(value);
}
export function checkNetwork(chainId){if(chainId!==CHAIN_ID)throw new Error('Only Sepolia chain ID 11155111 is allowed.');}
function assertRepository(){
  const gitRoot=fs.realpathSync(execFileSync('git',['rev-parse','--show-toplevel'],{cwd:root,encoding:'utf8'}).trim());
  const branch=execFileSync('git',['branch','--show-current'],{cwd:root,encoding:'utf8'}).trim();
  if(gitRoot.toLowerCase()!==root.toLowerCase()||branch!=='feat/v2-financing-redemption')throw new Error('The V2 development repository and branch are required.');
  return {root,branch,commit:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),uncommitted:execFileSync('git',['status','--porcelain'],{cwd:root,encoding:'utf8'}).length>0};
}
export async function prepare(options){
  const repository=assertRepository(),placeholderRoles=!options.manager;
  if(createHash('sha256').update(fs.readFileSync(path.join(root,'contracts/ReceivLedgerV2.sol'))).digest('hex')!=='15092c6c595fcc186c2dab03e367c5b3f3343441cde5c2a32c76de7309eee14c')throw new Error('Reviewed Solidity source changed.');
  const manager=roleAddress(options.manager??placeholderManager),deployer=roleAddress(options.deployer??placeholderManager);
  const f=await fixture({initialOwner:manager,deployer});checkNetwork(f.chainId);
  if((await f.get('owner')).toLowerCase()!==manager.toLowerCase()||await f.get('totalSupply')!==0n||await f.get('liquidCents')!==0n||await f.get('outstandingCents')!==0n||await f.get('automationEnabled')!==false||await f.get('newInvoiceOverdueBps')!==0n)throw new Error('Unexpected initial fund state.');
  if(compiled.warnings.length)throw new Error('Compiler warnings require review.');
  if(keccak256('0x'+compiled.evm.deployedBytecode.object)!==REVIEWED_RUNTIME_HASH)throw new Error('Reviewed runtime changed.');
  if(!placeholderRoles&&manager.toLowerCase()==='0x79b246212650b686a0e9e5726092b1558b35d974'&&keccak256(f.deploymentData)!==REVIEWED_CREATION_HASH)throw new Error('Reviewed creation payload changed.');
  const localGas=f.receipts[0].gas,conservativeGas=f.receipts[0].preRefundGas;
  let suggestedGas=(conservativeGas*120n+99n)/100n;
  let rpcCheck=null,nonce=0,maxFeePerGas=null,maxPriorityFeePerGas=null,provider;
  let offlineAmsterdam=await amsterdamDryRun({deployer,manager,data:f.deploymentData,abi:compiled.abi});
  suggestedGas=gasAllowance(offlineAmsterdam.gasUsed,200000000n,1792728000);
  try{
    if(options.rpc){
      const request=new FetchRequest(options.rpc);request.timeout=15000;
      provider=new JsonRpcProvider(request);checkNetwork((await provider.getNetwork()).chainId);
      const [block,fees]=await Promise.all([provider.getBlock('latest'),provider.getFeeData()]);
      let liveGas=null,balance=null,predicted=null;
      // eth_estimateGas is read-only; the placeholder run makes no funded-sender claim.
      if(!placeholderRoles){
        if(manager.toLowerCase()!=='0x79b246212650b686a0e9e5726092b1558b35d974'||deployer!==manager)throw new Error('Live preflight requires the confirmed reviewed manager/deployer.');
        const [code,funds,pendingNonce,latestNonce]=await Promise.all([provider.getCode(deployer),provider.getBalance(deployer),provider.getTransactionCount(deployer,'pending'),provider.getTransactionCount(deployer,'latest')]);
        if(pendingNonce!==latestNonce)throw new Error('Pending transactions require review before deployment.');
        const sender=classifySender(code);
        const targetCode=sender.target?await provider.getCode(sender.target):'0x';
        const targetReview=sender.target?checkTarget(targetCode):null;
        balance=funds;nonce=pendingNonce;predicted=getCreateAddress({from:deployer,nonce});
        if(predicted.toLowerCase()===V1||await provider.getCode(predicted)!=='0x')throw new Error('Creation address is not empty and independent.');
        if(!block)throw new Error('Missing latest block.');
        liveGas=await provider.estimateGas({type:2,from:deployer,data:f.deploymentData,value:0n,nonce});
        suggestedGas=gasAllowance(liveGas,block.gasLimit,block.timestamp);
        // Prove that this exact allowance and normal creation transaction execute successfully.
        const boundedEstimate=await provider.estimateGas({type:2,from:deployer,data:f.deploymentData,value:0n,nonce,gasLimit:suggestedGas});
        if(boundedEstimate>suggestedGas)throw new Error('Bounded estimate exceeds allowance.');
        const simulatedRuntime=await provider.call({type:2,from:deployer,data:f.deploymentData,value:0n,nonce,gasLimit:suggestedGas});
        if(keccak256(simulatedRuntime)!==REVIEWED_RUNTIME_HASH)throw new Error('Live creation returned unexpected runtime.');
        offlineAmsterdam=await amsterdamDryRun({deployer,manager,data:f.deploymentData,abi:compiled.abi,senderCode:code,target:sender.target,targetCode,gasLimit:suggestedGas,blockGasLimit:block.gasLimit,nonce,balance:funds});
        if(offlineAmsterdam.runtimeHash!==REVIEWED_RUNTIME_HASH||offlineAmsterdam.createdAddress.toLowerCase()!==predicted.toLowerCase())throw new Error('Offline creation disagrees with reviewed deployment.');
        rpcCheck={sender,targetReview,boundedEstimate,liveRuntimeVerified:true,clientVersion:await provider.send('web3_clientVersion',[])};
      }
      maxFeePerGas=fees.maxFeePerGas;maxPriorityFeePerGas=fees.maxPriorityFeePerGas;
      if(!block)throw new Error('Missing latest block.');
      if(suggestedGas>block.gasLimit)throw new Error('Allowance exceeds latest block limit.');
      if(maxFeePerGas===null||maxPriorityFeePerGas===null)throw new Error('Missing EIP-1559 fee quote.');
      const maximumGasCost=maxFeePerGas===null?null:suggestedGas*maxFeePerGas;
      if(balance!==null&&balance<maximumGasCost)throw new Error('Insufficient wallet balance for maximum gas cost.');
      rpcCheck={...rpcCheck,observedAtUTC:new Date().toISOString(),chainId:CHAIN_ID,block:block.number,blockTimestamp:block.timestamp,blockGasLimit:block.gasLimit,predictedAddress:predicted,deployerBalanceWei:balance,pendingNonce:placeholderRoles?null:nonce,liveEstimateGas:liveGas,maximumGasCostWei:placeholderRoles?null:maximumGasCost,maxFeePerGas,maxPriorityFeePerGas,sufficientBalance:balance===null?null:balance>=maximumGasCost};
    }
  }finally{provider?.destroy();}
  if(f.deploymentData.length/2-1>49152)throw new Error('Deployment exceeds the conservative initcode limit.');
  const plan={schema:1,mode:'UNSIGNED_ONLY',broadcasted:false,placeholderRoles,requiresSeparateApproval:true,repository,chainId:CHAIN_ID,manager,deployer,
    compiler:compiled.compiler,openzeppelin:'5.6.1',contract:'contracts/ReceivLedgerV2.sol:ReceivLedgerV2',
    runtimeBytes:compiled.size,creationBytesWithArguments:f.deploymentData.length/2-1,localOsakaGasEstimate:localGas,localPreRefundGas:conservativeGas,suggestedGasLimit:suggestedGas,
    deploymentDataHash:keccak256(f.deploymentData),expectedRuntimeHash:keccak256('0x'+compiled.evm.deployedBytecode.object),rpcCheck,offlineAmsterdam,
    initialState:{capSgdCents:1000000000,capital:0,shares:0,automation:false,additionalOverdueBps:0},
    note:'Osaka gas is historical only. Amsterdam uses an unsigned in-memory type-2 transaction with state-gas accounting. Live allowance is 120% of eth_estimateGas, bounded and re-simulated on RPC. Wallet confirmation and separate deployment approval remain required. Never use type 4, authorizationList, a bundler or wallet_sendCalls for this creation.'};
  const transaction={type:'0x2',from:deployer,chainId:toBeHex(CHAIN_ID),nonce:toBeHex(nonce),data:f.deploymentData,value:'0x0',gas:toBeHex(suggestedGas),
    ...(maxFeePerGas===null?{}:{maxFeePerGas:toBeHex(maxFeePerGas),maxPriorityFeePerGas:toBeHex(maxPriorityFeePerGas??0n)}),
    warning:'Unsigned creation request only. Offline nonce/placeholder roles are not usable for broadcasting.'};
  return {plan,transaction,standardInput:compiled.standardInput,abi:compiled.abi,constructorArguments:f.deploymentData.slice(2+compiled.evm.bytecode.object.length)};
}
const stringify=value=>JSON.stringify(value,(_,v)=>typeof v==='bigint'?v.toString():v,2)+'\n';
export function writePackage(result){
  const temp=path.join(root,'supabase','.temp');
  if(!fs.existsSync(temp))fs.mkdirSync(temp,{recursive:true});
  const resolved=fs.realpathSync(temp),relative=path.relative(root,resolved);
  if(relative.startsWith('..')||path.isAbsolute(relative))throw new Error('Artifact directory must stay inside this repository.');
  const out=path.join(resolved,'v2-deployment-'+new Date().toISOString().replace(/[^0-9]/g,'')+'-'+randomUUID().slice(0,6));
  fs.mkdirSync(out);
  const files={'plan.json':result.plan,'unsigned-transaction.json':result.transaction,'standard-input.json':result.standardInput,'abi.json':result.abi};
  for(const [name,value] of Object.entries(files))fs.writeFileSync(path.join(out,name),stringify(value),{flag:'wx'});
  fs.writeFileSync(path.join(out,'constructor-arguments.txt'),result.constructorArguments+'\n',{flag:'wx'});
  fs.writeFileSync(path.join(out,'creation-bytecode.txt'),result.transaction.data+'\n',{flag:'wx'});
  for(const [name,source] of Object.entries(result.standardInput.sources)){
    const target=path.resolve(out,'sources',name),base=path.join(out,'sources');
    if(path.relative(base,target).startsWith('..')||path.isAbsolute(path.relative(base,target)))throw new Error('Invalid source path');
    fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,source.content,{flag:'wx'});
  }
  return out;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{const result=await prepare(parseArguments(process.argv.slice(2))),out=writePackage(result);console.log(stringify({output:out,...result.plan}));}
  catch{console.error('V2 preparation stopped. Check the branch, public role addresses, pinned dependencies and Sepolia RPC. No transaction was signed or broadcast.');process.exitCode=1;}
}
