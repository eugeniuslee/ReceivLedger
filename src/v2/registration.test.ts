import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {beforeAll,afterAll,beforeEach,describe,it,expect,vi} from 'vitest';
import type {SupabaseClient} from '@supabase/supabase-js';
import {Interface} from 'ethers';
import {createV2RegistryHandler,validateV2PermissionTransaction,validateV2Receipt,V2_REGISTRATION_ABI,type V2RegistryChain,type V2ReceiptEvidence} from '../../supabase/functions/_shared/v2registry';
const ids=['10000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000003'];
const wallets=['0x'+'11'.repeat(20),'0x'+'22'.repeat(20),'0x'+'33'.repeat(20)];
let db:PGlite;
async function user<T>(n:number,fn:()=>Promise<T>){await db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({sub:ids[n],wallet:wallets[n]})]);await db.exec('set role authenticated');try{return await fn();}finally{await db.exec('reset role');}}
async function apply(n=1){return (await user(n,()=>db.query<{id:string;version:number}>("select * from rl2_submit_application('investor','{\"display_name\":\"Demo investor\"}')"))).rows[0];}
beforeAll(async()=>{
 db=new PGlite();await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;
 create table auth.users(id uuid primary key);create table public.rl_profiles(user_id uuid,wallet text);
 create function auth.uid() returns uuid language sql stable as $$select (current_setting('request.jwt.claims',true)::jsonb->>'sub')::uuid$$;
 create function public.rl_current_wallet() returns text language sql stable as $$select current_setting('request.jwt.claims',true)::jsonb->>'wallet'$$;
 grant usage on schema auth,public to authenticated,anon,service_role;`);
 for(let n=0;n<3;n++){await db.query('insert into auth.users values($1)',[ids[n]]);await db.query('insert into rl_profiles values($1,$2)',[ids[n],wallets[n]]);}
 await db.exec(readFileSync(new URL('../../supabase/v2/registration.sql',import.meta.url),'utf8'));
},30000);
beforeEach(async()=>{await db.exec('reset role;truncate rl2_review_audit,rl2_applications,rl2_identities restart identity cascade;');});
afterAll(async()=>{await db?.close();});
describe('isolated V2 PostgreSQL registration controls',()=>{
 it('uses session identity, rejects duplicates and keeps another wallet private',async()=>{
  const a=await apply();await expect(apply()).rejects.toThrow(/requested information/);
  expect((await user(2,()=>db.query('select * from rl2_applications'))).rows).toHaveLength(0);
  await expect(user(1,()=>db.query("update rl2_applications set status=3 where id=$1",[a.id]))).rejects.toThrow(/permission denied/);
 });
 it('denies direct applicant approval and self-review even through a privileged misuse',async()=>{
  const a=await apply();await expect(user(1,()=>db.query('select rl2_review_application($1,1,$2,3,$3,null)',[a.id,ids[1],'Self approve']))).rejects.toThrow(/permission denied/);
  await expect(db.query('select rl2_bind_identity($1,1,$2,$3)',[a.id,'a'.repeat(64),ids[1]])).rejects.toThrow(/Self review/);
 });
 it('updates only requested information, preserves status and rejects stale edits',async()=>{
  const a=await apply();await db.query('select rl2_review_application($1,1,$2,1,$3,null)',[a.id,ids[0],'More fictional information']);
  await user(1,()=>db.query("select rl2_submit_application('investor','{\"display_name\":\"Updated demo\"}',2)"));
  expect((await db.query<{status:number}>('select status from rl2_applications')).rows[0].status).toBe(1);
  await expect(user(1,()=>db.query("select rl2_submit_application('investor','{\"display_name\":\"Stale demo\"}',2)"))).rejects.toThrow(/current version/);
 });
 it('links associated wallets to one canonical identity and cannot rebind to reset limits',async()=>{
  const a=await apply(),b=await apply(2);
  for(const id of [a.id,b.id])await db.query('select rl2_bind_identity($1,1,$2,$3)',[id,'a'.repeat(64),ids[0]]);
  expect((await db.query('select * from rl2_identities')).rows).toHaveLength(1);
  await expect(db.query('select rl2_bind_identity($1,2,$2,$3)',[a.id,'b'.repeat(64),ids[0]])).rejects.toThrow(/permanently bound/);
  await expect(db.query('select rl2_review_application($1,2,$2,3,$3,null)',[a.id,ids[0],'Reviewed'])).rejects.toThrow(/receipt/);
  await db.query('select rl2_review_application($1,2,$2,3,$3,$4)',[a.id,ids[0],'Approved identity','0x'+'a'.repeat(64)]);
  expect((await db.query<{status:number}>('select status from rl2_applications')).rows.every(r=>r.status===3)).toBe(true);
 });
});

function query(data:unknown){const q={select:()=>q,eq:()=>q,single:async()=>({data,error:null}),then:(resolve:(v:unknown)=>unknown)=>Promise.resolve({data,error:null}).then(resolve)};return q;}
describe('V2 trusted backend gate and exact permission transaction verification',()=>{
 const entity='0x'+'aa'.repeat(32),iface=new Interface(V2_REGISTRATION_ABI);
 function fixture(){
  let wallet=wallets[0],status=3,valid=true;
  const app={id:ids[1],user_id:ids[1],wallet:wallets[1],kind:'investor',identity_id:ids[2],status:3,version:2};
  const rpc=vi.fn().mockResolvedValue({data:{ok:true},error:null});
  const chain:V2RegistryChain={permission:vi.fn(async()=>({owner:wallets[0],entity,status,approved:status===3})),verifyReceipt:vi.fn().mockResolvedValue(undefined)};
  const admin={auth:{getUser:vi.fn(async()=>({data:{user:valid?{id:wallet===wallets[0]?ids[0]:ids[1]}:null},error:null}))},from:(name:string)=>query(name==='rl2_applications'?app:{entity}),rpc} as unknown as SupabaseClient;
  const scoped={rpc:async(name:string)=>({data:name==='rl_current_wallet'?wallet:{},error:null}),from:()=>query(app)} as unknown as SupabaseClient;
  const handler=createV2RegistryHandler({admin,userClient:()=>scoped,chain,origins:['https://demo.test'],identityKey:'x'.repeat(32)});
  const request=(body:unknown,origin='https://demo.test',token='session')=>handler(new Request('https://edge.test',{method:'POST',headers:{origin,authorization:`Bearer ${token}`},body:JSON.stringify(body)}));
  return {request,rpc,chain,app,setWallet:(v:string)=>{wallet=v;},setStatus:(v:number)=>{status=v;},invalidate:()=>{valid=false;}};
 }
 it('rejects forged manager fields, wrong origins and invalid sessions',async()=>{
  const f=fixture();f.setWallet(wallets[1]);expect((await f.request({action:'review',id:ids[1],isManager:true,status:3})).status).toBe(403);expect(f.rpc).not.toHaveBeenCalled();
  expect((await f.request({},'https://evil.test')).status).toBe(403);f.invalidate();expect((await f.request({action:'status'})).status).toBe(401);
 });
 it('requires live on-chain approval in addition to an approved database row',async()=>{
  const f=fixture();f.setWallet(wallets[1]);f.setStatus(2);expect((await f.request({action:'authorize',id:ids[1]})).status).toBe(403);
  f.setStatus(3);expect((await f.request({action:'authorize',id:ids[1]})).status).toBe(200);
 });
 it('never saves a decision when receipt verification fails and does not leak internal errors',async()=>{
  const f=fixture();vi.mocked(f.chain.verifyReceipt).mockRejectedValue(new Error('SECRET_RPC_URL'));
  const response=await f.request({action:'review',id:ids[1],version:2,status:3,note:'Demo review',tx_hash:'0x'+'a'.repeat(64)});
  expect(response.status).toBe(400);expect(await response.text()).not.toContain('SECRET');expect(f.rpc).not.toHaveBeenCalled();
 });
 it('binds manager review to exact wallet, identity, role, status and method',()=>{
  const data=iface.encodeFunctionData('setInvestor',[wallets[1],entity,3]);
  expect(validateV2PermissionTransaction(data,wallets[1],'investor',entity,3)).toBe(true);
  expect(validateV2PermissionTransaction(data,wallets[2],'investor',entity,3)).toBe(false);
  expect(validateV2PermissionTransaction(data,wallets[1],'sme',entity,3)).toBe(false);
  expect(validateV2PermissionTransaction(data,wallets[1],'investor',entity,2)).toBe(false);
 });
 it('requires confirmed canonical Sepolia evidence, correct contract/owner and current approval',()=>{
  const address='0x'+'ab'.repeat(20),data=iface.encodeFunctionData('setInvestor',[wallets[1],entity,3]);
  const evidence:V2ReceiptEvidence={chainId:11155111n,status:1,confirmations:2,matchedBlock:true,to:address,from:wallets[0],data,current:{owner:wallets[0],entity,status:3,approved:true}};
  expect(()=>validateV2Receipt(evidence,address,wallets[1],'investor',entity,3)).not.toThrow();
  for(const changed of [{chainId:1n},{status:0},{confirmations:1},{matchedBlock:false},{to:wallets[2]},{from:wallets[2]},
    {current:{...evidence.current,approved:false}},{current:{...evidence.current,status:2}},{current:{...evidence.current,entity:'0x'+'bb'.repeat(32)}}]){
    expect(()=>validateV2Receipt({...evidence,...changed},address,wallets[1],'investor',entity,3)).toThrow();
  }
 });
});
