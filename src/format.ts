export const sh=(a:string)=>a.slice(0,6)+'…'+a.slice(-4), money=(n:number)=>'S$'+Math.round(n).toLocaleString('en-SG');
export const dt=(t:number)=>new Date(t).toLocaleDateString('en-SG',{day:'2-digit',month:'short',year:'numeric'});
export const dtm=(t:number)=>dt(t)+', '+new Date(t).toLocaleTimeString('en-SG',{hour:'2-digit',minute:'2-digit'});
export const pkey=(n:string)=>n.replace(/[A-Z]/g,c=>c.toLowerCase());          // same normalisation as normalizePayerName()
