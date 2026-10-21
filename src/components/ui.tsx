import type { ReactNode } from 'react';
import type { State } from '../types';
import { dtm, money } from '../format';

export const COL:Record<string,[string,string]>={Submitted:['#e2e8f0','#475569'],Approved:['#dbeafe','#1d4ed8'],Financed:['#ccfbf1','#0f766e'],Rejected:['#fee2e2','#b91c1c'],Repaid:['#dcfce7','#15803d'],Revoked:['#fef3c7','#92400e'],Success:['#dcfce7','#15803d'],Reverted:['#fee2e2','#b91c1c']};
export const Bd=({t}:{t:string})=><span className="bd" style={{background:COL[t][0],color:COL[t][1]}}>{t}</span>;
export const Table=({head,rows,empty='Nothing to show.'}:{head:string[];rows:ReactNode[][];empty?:string})=><div className="tw"><table><thead><tr>{head.map(h=><th key={h}>{h}</th>)}</tr></thead><tbody>{rows.length?rows.map((r,i)=><tr key={i}>{r.map((c,j)=><td key={j}>{c}</td>)}</tr>):<tr><td colSpan={head.length} className="sub">{empty}</td></tr>}</tbody></table></div>;
export const Recent=({s,n=6}:{s:State;n?:number})=><Table head={['Time','Event','Details','Amount','Status']} rows={s.log.slice(0,n).map(l=>[dtm(l.ts),<b>{l.type}</b>,l.detail,l.amount?money(l.amount):'—',<Bd t={l.status}/>])}/>;
