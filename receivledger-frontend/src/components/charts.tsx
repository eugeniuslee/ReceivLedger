import type { LogEntry, State } from '../types';
import { dt, money, pkey } from '../format';
import { exposure, maxExp } from '../ledger/demoLedger';

export function Activity({log}:{log:LogEntry[]}){const pts=[...log].reverse();const W=560,H=190,mx=Math.max(...pts.map(p=>p.avail+p.out),1);
 const x=(i:number)=>30+i*(W-40)/Math.max(pts.length-1,1),y=(v:number)=>H-24-v/mx*(H-40);
 const line=(k:'avail'|'out')=>pts.map((p,i)=>(i?'L':'M')+x(i)+','+y(p[k])).join('');
 return <svg viewBox={`0 0 ${W} ${H}`} style={{width:'100%'}}>{[0,.5,1].map(t=><g key={t}><line x1="30" x2={W-10} y1={y(mx*t)} y2={y(mx*t)} stroke="#e2e8f0"/><text x="0" y={y(mx*t)+4} fontSize="9" fill="#64748b">{Math.round(mx*t/1000)}k</text></g>)}
 <path d={line('out')+`L${x(pts.length-1)},${y(0)}L${x(0)},${y(0)}Z`} fill="#14b8a622"/><path d={line('out')} fill="none" stroke="#14b8a6" strokeWidth="2.5"/><path d={line('avail')} fill="none" stroke="#0b1f3a" strokeWidth="2.5"/>
 {pts.map((p,i)=><circle key={i} cx={x(i)} cy={y(p.out)} r="4" fill="#14b8a6"><title>{`${dt(p.ts)} · ${p.type}\nOutstanding ${money(p.out)} · Available ${money(p.avail)}`}</title></circle>)}</svg>}
export function Payers({s}:{s:State}){const names=[...new Set(s.invoices.filter(i=>i.status===2).map(i=>pkey(i.payer)))];const lim=maxExp(s)||1;
 return names.length?names.map(n=>{const nm=s.invoices.find(i=>pkey(i.payer)===n)!.payer,e=exposure(s,nm),p=e/lim;return <div key={n} style={{marginBottom:14}}>
 <div style={{display:'flex',justifyContent:'space-between'}}><b>{nm}</b><span>{money(e)} · {(e/s.total*100).toFixed(1)}% of pool</span></div>
 <div className="bar"><i style={{width:Math.min(p*100,100)+'%',background:p>.85?'#f59e0b':undefined}}/></div></div>}):<p className="sub">No financed invoices yet.</p>}
