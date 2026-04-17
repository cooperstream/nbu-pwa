import { addDays, buildHistorySampleDates, fmtYMD, toDayKey } from "../domain/rates.js";
import { cGet, cSet, keyHist, keyHistEmpty, keyHistLegacy, keyToday, TTL } from "./cache.js";

const NBU_BASE_URL = "https://bank.gov.ua/NBUStatService/v1/statdirectory/exchange";
const dayRatesInflight = new Map();

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

function keyHistDay(ymd){
  return `hist_day_${ymd}`;
}

function normalizeRatesByCode(raw){
  if(!Array.isArray(raw)||!raw.length) return null;
  const byCode={};
  for(const item of raw){
    const code=item?.cc;
    const rate=Number(item?.rate);
    if(!code||!Number.isFinite(rate)) continue;
    byCode[code]=rate;
  }
  return Object.keys(byCode).length?byCode:null;
}

async function fetchDayRates(ymd,timeoutMs=6000){
  const url=buildNbuRatesUrl({date:ymd});
  try{
    const r=await fetch(url,{signal:AbortSignal.timeout(timeoutMs)});
    if(!r.ok) return {ok:false,kind:"http",status:r.status};
    const raw=await r.json();
    const ratesByCode=normalizeRatesByCode(raw);
    if(!ratesByCode) return {ok:false,kind:"empty"};
    return {ok:true,ratesByCode};
  }catch(err){
    const name=err?.name||"";
    if(name==="TimeoutError"||name==="AbortError") return {ok:false,kind:"timeout"};
    return {ok:false,kind:"http"};
  }
}

async function getRatesByDate(ymd,timeoutMs=6000){
  const ttlByDate=ymd===fmtYMD(new Date())?TTL.today:TTL.past;
  const cKey=keyHistDay(ymd);
  const cached=cGet(cKey,ttlByDate);
  if(cached&&typeof cached==="object") return {ok:true,ratesByCode:cached};

  if(dayRatesInflight.has(ymd)) return dayRatesInflight.get(ymd);

  const pending=fetchDayRates(ymd,timeoutMs).then((res)=>{
    if(res.ok) cSet(cKey,res.ratesByCode);
    return res;
  }).finally(()=>dayRatesInflight.delete(ymd));
  dayRatesInflight.set(ymd,pending);
  return pending;
}

function readHistoryFromCache(cc,periodKey){
  const ttlH=periodKey==="30d"?TTL.h30:periodKey==="90d"?TTL.h90:TTL.h1y;
  const cKey=keyHist(cc,periodKey);
  const emptyKey=keyHistEmpty(cc,periodKey);
  if(cGet(emptyKey,TTL.hEmpty)) return [];

  const cached=cGet(cKey,ttlH);
  if(Array.isArray(cached)&&cached.length>0) return cached.map((i)=>({date:new Date(i.d),rate:i.r}));

  const legacyCached=cGet(keyHistLegacy(cc,periodKey),ttlH);
  if(Array.isArray(legacyCached)&&legacyCached.length>0) return legacyCached.map((i)=>({date:new Date(i.d),rate:i.r}));
  return null;
}

function storeHistoryToCache(cc,periodKey,history){
  const cKey=keyHist(cc,periodKey);
  const emptyKey=keyHistEmpty(cc,periodKey);
  if(!Array.isArray(history)||history.length===0){ cSet(emptyKey,true); return; }
  cSet(cKey,history.map((i)=>({d:i.date.getTime(),r:i.rate})));
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

export async function getHistoriesBatch(codes,periodKey){
  const uniqueCodes=[...new Set((codes||[]).filter(Boolean))];
  const historiesByCode={};
  if(!uniqueCodes.length) return historiesByCode;

  const sampledDates=buildHistorySampleDates(periodKey,new Date());
  uniqueCodes.forEach((cc)=>{
    if(cc==="UAH") historiesByCode[cc]=sampledDates.map((date)=>({date,rate:1}));
  });

  const missingCodes=uniqueCodes.filter((cc)=>{
    if(cc==="UAH") return false;
    const cached=readHistoryFromCache(cc,periodKey);
    if(cached!==null){ historiesByCode[cc]=cached; return false; }
    return true;
  });
  if(!missingCodes.length) return historiesByCode;

  // Batch mode: one sampled date set and one date pass are reused for all missing currencies.
  const dates=buildHistorySampleDates(periodKey,new Date());
  const minPointsByPeriod={"30d":5,"90d":6,"1y":6};
  const minPoints=minPointsByPeriod[periodKey]||4;
  const maxParallel=5;
  const resultsByCode=Object.fromEntries(missingCodes.map((cc)=>[cc,new Array(dates.length).fill(null)]));
  const statsByCode=Object.fromEntries(missingCodes.map((cc)=>[cc,{timeout:0,http:0,empty:0,failed:0}]));

  async function runBatch(indexes,batchMaxParallel,timeoutMs){
    let cursor=0;
    async function worker(){
      while(cursor<indexes.length){
        const idx=indexes[cursor++];
        const d=dates[idx];
        const ymd=fmtYMD(d);
        const dayRes=await getRatesByDate(ymd,timeoutMs);
        if(dayRes.ok){
          for(const cc of missingCodes){
            const nextRate=Number(dayRes.ratesByCode?.[cc]);
            if(Number.isFinite(nextRate)){
              resultsByCode[cc][idx]={date:d,rate:nextRate};
              continue;
            }
            statsByCode[cc].failed++;
            statsByCode[cc].empty++;
          }
          continue;
        }
        for(const cc of missingCodes){
          statsByCode[cc].failed++;
          if(dayRes.kind==="timeout") statsByCode[cc].timeout++;
          else if(dayRes.kind==="empty") statsByCode[cc].empty++;
          else statsByCode[cc].http++;
        }
      }
    }
    const workers=Array.from({length:Math.min(batchMaxParallel,indexes.length)},()=>worker());
    await Promise.all(workers);
  }

  await runBatch(dates.map((_,idx)=>idx),maxParallel,6000);
  const buildNormalized=(cc)=>resultsByCode[cc].filter(Boolean).sort((a,b)=>a.date-b.date);

  const indexesForRetry=new Set();
  for(const cc of missingCodes){
    if(buildNormalized(cc).length>=minPoints) continue;
    resultsByCode[cc].forEach((point,idx)=>{ if(!point) indexesForRetry.add(idx); });
  }

  if(indexesForRetry.size){
    await runBatch([...indexesForRetry],2,9000);
  }

  for(const cc of missingCodes){
    const normalized=buildNormalized(cc);
    const stats=statsByCode[cc];
    const failRatio=dates.length?stats.failed/dates.length:0;
    if(!normalized.length && (stats.timeout+stats.http)>0 && failRatio>=0.3){
      const err=new Error("Сервер НБУ не відповідає стабільно, спробуйте пізніше.");
      err.code="HISTORY_FETCH_FAILED";
      throw err;
    }
    storeHistoryToCache(cc,periodKey,normalized);
    historiesByCode[cc]=normalized;
  }

  return historiesByCode;
}

export async function getHistory(cc,periodKey){
  const batch=await getHistoriesBatch([cc],periodKey);
  return batch[cc]||[];
}

export async function getDisplayHistoriesBatch(codes,periodKey,baseCode){
  const uniqueCodes=[...new Set((codes||[]).filter(Boolean))];
  const displayByCode={};
  if(!uniqueCodes.length) return displayByCode;
  if(baseCode==="UAH"){
    return getHistoriesBatch(uniqueCodes,periodKey);
  }

  const neededRaw=[...new Set([...uniqueCodes,baseCode])];
  const rawByCode=await getHistoriesBatch(neededRaw,periodKey);
  const baseHist=rawByCode[baseCode]||[];
  const baseByDate=new Map(baseHist.map((p)=>[toDayKey(p.date),p.rate]));

  uniqueCodes.forEach((cc)=>{
    if(cc==="UAH"){
      displayByCode[cc]=baseHist.filter((p)=>p.rate).map((p)=>({date:p.date,rate:1/p.rate}));
      return;
    }
    const targetHist=rawByCode[cc]||[];
    displayByCode[cc]=targetHist
      .map((p)=>{
        const baseRate=baseByDate.get(toDayKey(p.date));
        if(!baseRate) return null;
        return {date:p.date,rate:p.rate/baseRate};
      })
      .filter(Boolean);
  });
  return displayByCode;
}

export async function getDisplayHistory(cc,periodKey,baseCode){
  const batch=await getDisplayHistoriesBatch([cc],periodKey,baseCode);
  return batch[cc]||[];
}
