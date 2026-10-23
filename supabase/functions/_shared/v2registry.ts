import type { SupabaseClient } from '@supabase/supabase-js';
import { Contract, Interface, JsonRpcProvider, isAddress } from 'ethers';
import { CONTRACT_ADDRESS } from './domain.ts';

export const V2_REGISTRATION_ABI = [
  'function owner() view returns(address)', 'function investors(address) view returns(bool)',
  'function verifiedSmes(address) view returns(bool)', 'function investorEntities(address) view returns(bytes32)',
  'function smeEntities(address) view returns(bytes32)', 'function investorStatus(bytes32) view returns(uint8)',
  'function smeStatus(bytes32) view returns(uint8)',
  'function setInvestor(address,bytes32,uint8)', 'function setSme(address,bytes32,bool)', 'function setSmeStatus(bytes32,uint8)',
];
type Kind='investor'|'sme';
export interface V2Application { id:string; user_id:string; wallet:string; kind:Kind; identity_id:string|null; status:number; version:number }
export interface V2Permission { owner:string; entity:string; status:number; approved:boolean }
export interface V2RegistryChain {
  permission(wallet:string,kind:Kind):Promise<V2Permission>;
  verifyReceipt(tx:string,wallet:string,kind:Kind,entity:string,status:number):Promise<void>;
}
const iface=new Interface(V2_REGISTRATION_ABI);
export function validateV2PermissionTransaction(data:string,wallet:string,kind:Kind,entity:string,status:number) {
  const tx=iface.parseTransaction({data});
  if(kind==='investor')return tx?.name==='setInvestor'&&String(tx.args[0]).toLowerCase()===wallet&&tx.args[1]===entity&&Number(tx.args[2])===status;
  return (tx?.name==='setSme'&&String(tx.args[0]).toLowerCase()===wallet&&tx.args[1]===entity&&tx.args[2]===true&&status===3)
    ||(tx?.name==='setSmeStatus'&&tx.args[0]===entity&&Number(tx.args[1])===status);
}
export interface V2ReceiptEvidence {
  chainId:bigint;status:number|null;confirmations:number;matchedBlock:boolean;to:string|null;from:string;data:string;current:V2Permission;
}
export function validateV2Receipt(e:V2ReceiptEvidence,address:string,wallet:string,kind:Kind,entity:string,status:number){
  if(e.status!==1||e.confirmations<2||e.chainId!==11155111n||!e.matchedBlock||e.to?.toLowerCase()!==address.toLowerCase()
    ||e.from.toLowerCase()!==e.current.owner||e.current.entity!==entity||e.current.status!==status||(status===3&&!e.current.approved)
    ||!validateV2PermissionTransaction(e.data,wallet,kind,entity,status))throw new Error('Current manager permission receipt required');
}
export function createV2RegistryChain(rpc:string,address:string):V2RegistryChain {
  if(!isAddress(address)||/^0x0{40}$/i.test(address)||address.toLowerCase()===CONTRACT_ADDRESS)throw new Error('Independent V2 deployment required');
  const provider=new JsonRpcProvider(rpc),contract=new Contract(address,V2_REGISTRATION_ABI,provider);
  async function permission(wallet:string,kind:Kind):Promise<V2Permission>{
    if((await provider.getNetwork()).chainId!==11155111n)throw new Error('Sepolia required');
    const blockTag=await provider.getBlockNumber();
    const [owner,entity]=await Promise.all([contract.getFunction('owner')({blockTag}),contract.getFunction(kind==='investor'?'investorEntities':'smeEntities')(wallet,{blockTag})]);
    const [status,approved]=await Promise.all([contract.getFunction(kind==='investor'?'investorStatus':'smeStatus')(entity,{blockTag}),contract.getFunction(kind==='investor'?'investors':'verifiedSmes')(wallet,{blockTag})]);
    return {owner:String(owner).toLowerCase(),entity:String(entity).toLowerCase(),status:Number(status),approved:Boolean(approved)&&Number(status)===3&&wallet!==String(owner).toLowerCase()};
  }
  return {permission,async verifyReceipt(tx,wallet,kind,entity,status){
    if(!/^0x[\da-f]{64}$/i.test(tx))throw new Error('Receipt required');
    const current=await permission(wallet,kind);
    const [receipt,transaction,head]=await Promise.all([provider.getTransactionReceipt(tx),provider.getTransaction(tx),provider.getBlockNumber()]);
    if(!receipt||!transaction)throw new Error('Mined permission receipt required');
    validateV2Receipt({status:receipt.status,confirmations:head-receipt.blockNumber+1,chainId:transaction.chainId,matchedBlock:transaction.blockHash===receipt.blockHash,
      to:transaction.to,from:transaction.from,data:transaction.data,current},address,wallet,kind,entity,status);
  }};
}
function checked<T>(r:{data:T;error:unknown}):T{if(r.error)throw new Error('Database request rejected');return r.data;}
interface Dependencies {admin:SupabaseClient;userClient:(token:string)=>SupabaseClient;chain:V2RegistryChain;origins:string[];identityKey:string}
export function createV2RegistryHandler(d:Dependencies){
  return async(request:Request):Promise<Response>=>{
    const origin=request.headers.get('origin')??'',allowed=d.origins.includes(origin);
    const headers={'Cache-Control':'no-store','Vary':'Origin',...(allowed?{'Access-Control-Allow-Origin':origin}:{}),'Access-Control-Allow-Headers':'authorization, apikey, content-type','Access-Control-Allow-Methods':'POST, OPTIONS'};
    const json=(body:unknown,status=200)=>Response.json(body,{status,headers});
    if(!allowed)return json({error:'Origin denied'},403);
    if(request.method==='OPTIONS')return new Response(null,{status:204,headers});
    if(request.method!=='POST')return json({error:'POST required'},405);
    try{
      const token=request.headers.get('authorization')?.match(/^Bearer (.+)$/i)?.[1];
      if(!token)return json({error:'Wallet sign-in required'},401);
      const auth=await d.admin.auth.getUser(token);if(auth.error||!auth.data.user)return json({error:'Invalid wallet session'},401);
      const user=d.userClient(token),wallet=checked(await user.rpc('rl_current_wallet')) as string|null;
      if(!wallet)return json({error:'Verified wallet session required'},401);
      checked(await user.rpc('rl_ensure_profile'));
      const reader=request.body?.getReader();let raw='';
      if(!reader)throw new Error('Body required');
      let length=0;const decoder=new TextDecoder();
      for(;;){const chunk=await reader.read();if(chunk.done)break;length+=chunk.value.length;if(length>20000){await reader.cancel();throw new Error('Body too large');}raw+=decoder.decode(chunk.value,{stream:true});}raw+=decoder.decode();
      const input=JSON.parse(raw);
      if(input.action==='submit'){
        if(input.demo_consent!==true)throw new Error('Fictional information required');
        return json(checked(await user.rpc('rl2_submit_application',{p_kind:input.kind,p_details:input.details,p_version:input.version??null})));
      }
      if(input.action==='status')return json(checked(await user.from('rl2_applications').select('*')));
      if(input.action==='applications'){
        if(wallet!==(await d.chain.permission(wallet,'investor')).owner)return json({error:'V2 manager required'},403);
        return json(checked(await d.admin.from('rl2_applications').select('*,rl2_identities(entity)').order('updated_at',{ascending:false}).limit(200)));
      }
      if(!['bind_identity','review','authorize'].includes(input.action))throw new Error('Unknown action');
      const app=checked(await (input.action==='authorize'?user:d.admin).from('rl2_applications').select('*').eq('id',input.id).single()) as V2Application;
      const permission=await d.chain.permission(app.wallet,app.kind);
      if(input.action==='authorize'){
        if(app.user_id!==auth.data.user.id||app.wallet!==wallet||app.status!==3||!permission.approved||permission.status!==3) return json({error:'Registration approval required'},403);
        const identity=checked(await d.admin.from('rl2_identities').select('entity').eq('id',app.identity_id).single());
        if(!identity||identity.entity!==permission.entity)throw new Error('Identity mismatch');
        return json({approved:true,wallet,kind:app.kind,entity:permission.entity,notice:'Informational gate only; Solidity rechecks every transaction.'});
      }
      if(wallet!==permission.owner||app.wallet===wallet||app.user_id===auth.data.user.id)return json({error:'Independent V2 manager required'},403);
      if(input.action==='bind_identity'){
        if(d.identityKey.length<32||typeof input.verified_reference!=='string'||input.verified_reference.trim().length<3)throw new Error('Verified canonical reference required');
        const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(d.identityKey),{name:'HMAC',hash:'SHA-256'},false,['sign']);
        const digest=Array.from(new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(input.verified_reference.trim().toUpperCase())))).map(v=>v.toString(16).padStart(2,'0')).join('');
        return json(checked(await d.admin.rpc('rl2_bind_identity',{p_id:app.id,p_version:input.version,p_canonical_digest:digest,p_actor:auth.data.user.id})));
      }
      if(!Number.isInteger(input.status)||input.status<0||input.status>5)throw new Error('Invalid status');
      if(app.identity_id){
        const identity=checked(await d.admin.from('rl2_identities').select('entity').eq('id',app.identity_id).single());
        if(!identity)throw new Error('Identity required');
        await d.chain.verifyReceipt(input.tx_hash,app.wallet,app.kind,identity.entity,input.status);
      }
      return json(checked(await d.admin.rpc('rl2_review_application',{p_id:app.id,p_version:input.version,p_actor:auth.data.user.id,p_status:input.status,p_note:input.note,p_tx:app.identity_id?input.tx_hash:null})));
    }catch{return json({error:'V2 registration request rejected. Check approval, current version and server configuration.'},400);}
  };
}
