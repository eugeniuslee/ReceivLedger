import {getAddress,keccak256} from 'ethers';
export const EXECUTION_CAP=16777216n, TOTAL_CAP=4294967295n;
export const AMSTERDAM_TIMESTAMP=1791294816;
export const DELEGATOR='0x63c0c19a282a1b52b07dd5a65b58948a07dae32b';
export const DELEGATOR_HASH='0x9270f73d98e7ed6978677bf0550038289efd510e67e700d024502d62510fc1e4';
export const REVIEWED_CREATION_HASH='0x05c064223cbf7177b86b379f4786bfa4a2e337bca9ffc454703c7ecbed723b0d';
export const REVIEWED_RUNTIME_HASH='0x178c217074a782a35c93fab8752cc7980ba850628de4ebf279728bc9d427a12d';
export function classifySender(code){
  if(code==='0x')return {kind:'EOA',target:null};
  if(!/^0xef0100[0-9a-f]{40}$/i.test(code))throw new Error('Unsupported sender code; only EOAs or exact EIP-7702 markers are accepted.');
  const target=getAddress('0x'+code.slice(8));
  if(target.toLowerCase()!==DELEGATOR)throw new Error('Unreviewed delegation target.');
  return {kind:'EIP7702',target};
}
export function checkTarget(code){
  if(keccak256(code)!==DELEGATOR_HASH)throw new Error('Delegator implementation changed or is absent.');
  return {bytes:(code.length-2)/2,hash:keccak256(code)};
}
export function gasAllowance(estimate,blockLimit,timestamp){
  if(estimate<=0n)throw new Error('Invalid estimate.');
  const cap=timestamp>=AMSTERDAM_TIMESTAMP?TOTAL_CAP:EXECUTION_CAP;
  const allowance=(estimate*120n+99n)/100n;
  if(allowance>cap||allowance>blockLimit)throw new Error('Gas allowance exceeds current transaction/block bounds.');
  return allowance;
}
