export const TTL = {
  today: 30*60*1000,
  past:  24*60*60*1000,
  h30:   20*60*1000,
  h90:   60*60*1000,
  h1y:   12*60*60*1000,
  hEmpty:2*60*1000,
};

export const HIST_CACHE_VERSION = 3;

const memCache = {};

export function cSet(k,v){
  const t = Date.now();
  memCache[k] = {v,t};
  try{ localStorage.setItem(`nbu5_${k}`, JSON.stringify({v,t})); }catch(_e){}
}

export function cGet(k,ttl){
  const m=memCache[k];
  if(m && Date.now()-m.t<=ttl) return m.v;
  try{
    const raw=localStorage.getItem(`nbu5_${k}`);
    if(!raw) return null;
    const {v,t}=JSON.parse(raw);
    if(Date.now()-t>ttl) return null;
    memCache[k]={v,t};
    return v;
  }catch(_e){
    return null;
  }
}

export function keyToday(ymd){ return `rates_${ymd}`; }
export function keyHist(cc,periodKey){ return `hist_v${HIST_CACHE_VERSION}_${cc}_${periodKey}`; }
export function keyHistEmpty(cc,periodKey){ return `hist_empty_v${HIST_CACHE_VERSION}_${cc}_${periodKey}`; }
