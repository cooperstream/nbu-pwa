import { addDays, buildHistorySampleDates, fmtYMD, toDayKey } from "../domain/rates.js";
import { cGet, cSet, keyHist, keyHistEmpty, keyHistLegacy, keyToday, TTL } from "./cache.js";

const NBU_BASE_URL = "https://bank.gov.ua/NBUStatService/v1/statdirectory/exchange";

export function buildNbuRatesUrl({date,valcode}){
  const params = new URLSearchParams({ json: "" });
  if(date) params.set("date", date);
  if(valcode) params.set("valcode", valcode);
  return `${NBU_BASE_URL}?${params.toString()}`;
}

export async function nbuFetch(url){
  const r=await fetch(url,{signal:AbortSignal.timeout(6000)});
  if(!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

export async function fetchHistoryPoint(url,timeoutMs=6000){
  try{
    const r=await fetch(url,{signal:AbortSignal.timeout(timeoutMs)});
    if(!r.ok) return {ok:false,kind:"http",status:r.status};
    const raw=await r.json();
    if(!Array.isArray(raw)||!raw.length||!raw[0]?.rate) return {ok:false,kind:"empty"};
    return {ok:true,rate:Number(raw[0].rate)};
  }catch(err){
    const name=err?.name||"";
    if(name==="TimeoutError"||name==="AbortError") return {ok:false,kind:"timeout"};
    return {ok:false,kind:"http"};
  }
}

export async function getCurrentRates(forceRefresh=false){
  const today=fmtYMD(new Date());
  if(!forceRefresh){
    const cached=cGet(keyToday(today),TTL.today);
    if(cached) return cached;
  }
  const data=await nbuFetch(buildNbuRatesUrl({date:today}));
  if(!data||!data.length) throw new Error("НБУ не повернуло поточні курси");
  cSet(keyToday(today),data);
  return data;
}

export async function getYesterdayRates(){
  const yest=fmtYMD(addDays(new Date(),-1));
  const cached=cGet(keyToday(yest),TTL.past);
  if(cached) return cached;
  try{
    const data=await nbuFetch(buildNbuRatesUrl({date:yest}));
    if(data&&data.length){ cSet(keyToday(yest),data); return data; }
  }catch(_e){}
  return [];
}

export async function getHistory(cc,periodKey){
  if(cc==="UAH") return buildHistorySampleDates(periodKey,new Date()).map((date)=>({date,rate:1}));

  const ttlH=periodKey==="30d"?TTL.h30:periodKey==="90d"?TTL.h90:TTL.h1y;
  const cKey=keyHist(cc,periodKey);
  const emptyKey=keyHistEmpty(cc,periodKey);
  if(cGet(emptyKey,TTL.hEmpty)) return [];

  const cached=cGet(cKey,ttlH);
  if(Array.isArray(cached)&&cached.length>0) return cached.map((i)=>({date:new Date(i.d),rate:i.r}));

  const legacyCached=cGet(keyHistLegacy(cc,periodKey),ttlH);
  if(Array.isArray(legacyCached)&&legacyCached.length>0) return legacyCached.map((i)=>({date:new Date(i.d),rate:i.r}));

  const dates=buildHistorySampleDates(periodKey,new Date());
  const minPointsByPeriod={"30d":5,"90d":6,"1y":6};
  const minPoints=minPointsByPeriod[periodKey]||4;
  const maxParallel=5;
  const result=new Array(dates.length).fill(null);
  const stats={timeout:0,http:0,empty:0,failed:0};

  async function runBatch(indexes,batchMaxParallel,timeoutMs){
    let cursor=0;
    async function worker(){
      while(cursor<indexes.length){
        const idx=indexes[cursor++];
        const d=dates[idx];
        const url=buildNbuRatesUrl({valcode:cc,date:fmtYMD(d)});
        const res=await fetchHistoryPoint(url,timeoutMs);
        if(res.ok){ result[idx]={date:d,rate:res.rate}; continue; }
        stats.failed++;
        if(res.kind==="timeout") stats.timeout++;
        else if(res.kind==="empty") stats.empty++;
        else stats.http++;
      }
    }
    const workers=Array.from({length:Math.min(batchMaxParallel,indexes.length)},()=>worker());
    await Promise.all(workers);
  }

  await runBatch(dates.map((_,idx)=>idx),maxParallel,6000);
  let normalized=result.filter(Boolean).sort((a,b)=>a.date-b.date);

  if(normalized.length<minPoints){
    const missingIndexes=result.map((v,idx)=>v?null:idx).filter((idx)=>idx!=null);
    if(missingIndexes.length){
      await runBatch(missingIndexes,2,9000);
      normalized=result.filter(Boolean).sort((a,b)=>a.date-b.date);
    }
  }

  const failRatio=dates.length?stats.failed/dates.length:0;
  if(!normalized.length && (stats.timeout+stats.http)>0 && failRatio>=0.3){
    const err=new Error("Сервер НБУ не відповідає стабільно, спробуйте пізніше.");
    err.code="HISTORY_FETCH_FAILED";
    throw err;
  }

  if(normalized.length===0){ cSet(emptyKey,true); return []; }
  cSet(cKey,normalized.map((i)=>({d:i.date.getTime(),r:i.rate})));
  return normalized;
}

export async function getDisplayHistory(cc,periodKey,baseCode){
  if(baseCode==="UAH") return getHistory(cc,periodKey);
  const [targetHist,baseHist]=await Promise.all([getHistory(cc,periodKey),getHistory(baseCode,periodKey)]);
  const baseByDate=new Map(baseHist.map((p)=>[toDayKey(p.date),p.rate]));
  if(cc==="UAH") return baseHist.filter((p)=>p.rate).map((p)=>({date:p.date,rate:1/p.rate}));
  return targetHist
    .map((p)=>{
      const baseRate=baseByDate.get(toDayKey(p.date));
      if(!baseRate) return null;
      return {date:p.date,rate:p.rate/baseRate};
    })
    .filter(Boolean);
}
