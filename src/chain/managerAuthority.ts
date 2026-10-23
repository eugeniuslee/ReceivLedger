import { useCallback, useEffect, useRef, useState } from 'react';
import { Contract, isAddress, type Provider } from 'ethers';
import { V2_DEPLOYMENT } from '../v2/config';
export async function readV2Owner(provider:Provider):Promise<string> {
  if((await provider.getNetwork()).chainId!==BigInt(V2_DEPLOYMENT.chainId))throw new Error('V2 manager recognition requires Sepolia.');
  const owner=String(await new Contract(V2_DEPLOYMENT.address,['function owner() view returns (address)'],provider).getFunction('owner')());
  if(!isAddress(owner)||/^0x0{40}$/i.test(owner))throw new Error('The deployed V2 owner is unavailable.');
  return owner;
}
/** Public UI recognition only. Does not grant legacy writes or private access. */
export function useV2ManagerAuthority(provider:Provider|null,account:string|null,networkOk:boolean,epoch:number) {
  const key=account&&networkOk?account.toLowerCase()+':'+epoch:'';
  const identity=useRef({key,version:0});
  if(identity.current.key!==key)identity.current={key,version:identity.current.version+1};
  const request=useRef(0);
  const [state,setState]=useState<{key:string;version:number;owner:string|null;error:string|null;loading:boolean}|null>(null);
  const refresh=useCallback(async()=>{
    if(!provider||!key)return;
    const version=identity.current.version,sequence=++request.current;
    const current=()=>version===identity.current.version&&key===identity.current.key&&sequence===request.current;
    setState(previous=>({key,version,owner:previous?.key===key&&previous.version===version?previous.owner:null,error:null,loading:true}));
    try{const owner=await readV2Owner(provider);if(current())setState({key,version,owner,error:null,loading:false});}
    catch{if(current())setState({key,version,owner:null,error:'V2 owner could not be verified. Refresh public blockchain access; private authentication is separate.',loading:false});}
  },[provider,key]);
  useEffect(()=>{void refresh();const timer=window.setInterval(()=>void refresh(),12000);return()=>{request.current++;window.clearInterval(timer);};},[refresh]);
  const visible=state?.key===key&&state.version===identity.current.version?state:null;
  return {owner:visible?.owner??null,isManager:Boolean(account&&key&&visible?.owner?.toLowerCase()===account.toLowerCase()),loading:visible?.loading??Boolean(key),error:visible?.error??null,refresh};
}
