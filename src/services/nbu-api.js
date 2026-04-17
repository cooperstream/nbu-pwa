import { addDays, buildHistorySampleDates, fmtYMD, toDayKey } from "../domain/rates.js";
import { cGet, cSet, keyHist, keyHistEmpty, keyHistLegacy, keyToday, TTL } from "./cache.js";

const NBU_BASE_URL = "https://bank.gov.ua/NBUStatService/v1/statdirectory/exchange";
const dayRatesInflight = new Map();
const historiesBatchInflight = new Map();
const displayHistoriesCache = new Map();

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

function getHistoryTtl(periodKey){
  return periodKey==="30d"?TTL.h30:periodKey==="90d"?TTL.h90:TTL.h1y;
}

function asCachedHistory(cached){
  return cached.map((i)=>({date:new Date(i.d),rate:i.r}));
}

function getBatchCacheKey(codes,periodKey){
  return `${periodKey}|${codes.slice().sort().join(",")}`;
}

export async function getHistoriesBatch(codes,periodKey){
  const uniqCodes=[...new Set((codes||[]).filter(Boolean))];
  if(!uniqCodes.length) return {};

  const inflightKey=getBatchCacheKey(uniqCodes,periodKey);
  if(historiesBatchInflight.has(inflightKey)) return historiesBatchInflight.get(inflightKey);

  const pending=(async()=>{
    const ttlH=getHistoryTtl(periodKey);
    const dates=buildHistorySampleDates(periodKey,new Date());
    const minPointsByPeriod={"30d":5,"90d":6,"1y":6};
    const minPoints=minPointsByPeriod[periodKey]||4;
    const result={};
    const fetchCodes=[];

    for(const cc of uniqCodes){
      if(cc==="UAH"){
        result[cc]=dates.map((date)=>({date,rate:1}));
        continue;
      }
      if(cGet(keyHistEmpty(cc,periodKey),TTL.hEmpty)){
        result[cc]=[];
        continue;
      }
      const cached=cGet(keyHist(cc,periodKey),ttlH);
      if(Array.isArray(cached)&&cached.length>0){
        result[cc]=asCachedHistory(cached);
        continue;
      }
      const legacyCached=cGet(keyHistLegacy(cc,periodKey),ttlH);
      if(Array.isArray(legacyCached)&&legacyCached.length>0){
        result[cc]=asCachedHistory(legacyCached);
        continue;
      }
      fetchCodes.push(cc);
    }

    if(!fetchCodes.length) return result;

    // Batch history builder: same sampled dates + same day payloads are reused for all requested currencies.
    const pointsByCode=Object.fromEntries(fetchCodes.map((cc)=>[cc,new Array(dates.length).fill(null)]));
    const dayFetchStats={failed:0,timeout:0,http:0,empty:0};

    async function runBatch(indexes,batchMaxParallel,timeoutMs){
      let cursor=0;
      async function worker(){
        while(cursor<indexes.length){
          const idx=indexes[cursor++];
          const ymd=fmtYMD(dates[idx]);
          const dayRes=await getRatesByDate(ymd,timeoutMs);
          if(dayRes.ok){
            for(const cc of fetchCodes){
              const rate=Number(dayRes.ratesByCode?.[cc]);
              if(Number.isFinite(rate) && !pointsByCode[cc][idx]) pointsByCode[cc][idx]={date:dates[idx],rate};
            }
            continue;
          }
          dayFetchStats.failed++;
          if(dayRes.kind==="timeout") dayFetchStats.timeout++;
          else if(dayRes.kind==="empty") dayFetchStats.empty++;
          else dayFetchStats.http++;
        }
      }
      const workers=Array.from({length:Math.min(batchMaxParallel,indexes.length)},()=>worker());
      await Promise.all(workers);
    }

    await runBatch(dates.map((_,idx)=>idx),5,6000);

    const missingIndexes=[];
    for(let idx=0; idx<dates.length; idx++){
      const unresolved=fetchCodes.some((cc)=>!pointsByCode[cc][idx]);
      if(unresolved) missingIndexes.push(idx);
    }
    if(missingIndexes.length) await runBatch(missingIndexes,2,9000);

    let hasAnyData=false;
    for(const cc of fetchCodes){
      const normalized=pointsByCode[cc].filter(Boolean).sort((a,b)=>a.date-b.date);
      const enoughPoints=normalized.length>=minPoints;
      if(normalized.length===0){
        cSet(keyHistEmpty(cc,periodKey),true);
        result[cc]=[];
        continue;
      }
      hasAnyData=true;
      if(!enoughPoints){
        // Keep sparse histories instead of failing hard: chart/sparkline can still render available trend.
      }
      cSet(keyHist(cc,periodKey),normalized.map((i)=>({d:i.date.getTime(),r:i.rate})));
      result[cc]=normalized;
    }

    const failRatio=dates.length?dayFetchStats.failed/dates.length:0;
    if(!hasAnyData && (dayFetchStats.timeout+dayFetchStats.http)>0 && failRatio>=0.3){
      const err=new Error("Сервер НБУ не відповідає стабільно, спробуйте пізніше.");
      err.code="HISTORY_FETCH_FAILED";
      throw err;
    }

    return result;
  })().finally(()=>historiesBatchInflight.delete(inflightKey));

  historiesBatchInflight.set(inflightKey,pending);
  return pending;
}

export async function getHistory(cc,periodKey){
  const batch=await getHistoriesBatch([cc],periodKey);
  return batch[cc]||[];
}

export async function getDisplayHistoriesBatch(codes,periodKey,baseCode){
  const uniqCodes=[...new Set((codes||[]).filter(Boolean))];
  if(!uniqCodes.length) return {};

  const displayKey=`${periodKey}|${baseCode}`;
  const cached=displayHistoriesCache.get(displayKey)||new Map();
  const missing=uniqCodes.filter((cc)=>!cached.has(cc));
  if(!missing.length){
    return Object.fromEntries(uniqCodes.map((cc)=>[cc,cached.get(cc)]));
  }

  if(baseCode==="UAH"){
    const rawBatch=await getHistoriesBatch(missing,periodKey);
    for(const cc of missing) cached.set(cc,rawBatch[cc]||[]);
    displayHistoriesCache.set(displayKey,cached);
    return Object.fromEntries(uniqCodes.map((cc)=>[cc,cached.get(cc)||[]]));
  }

  const rawCodes=[...new Set([...missing,baseCode])];
  const rawBatch=await getHistoriesBatch(rawCodes,periodKey);
  const baseHist=rawBatch[baseCode]||[];
  const baseByDate=new Map(baseHist.map((p)=>[toDayKey(p.date),p.rate]));

  for(const cc of missing){
    if(cc==="UAH"){
      cached.set(cc,baseHist.filter((p)=>p.rate).map((p)=>({date:p.date,rate:1/p.rate})));
      continue;
    }
    const targetHist=rawBatch[cc]||[];
    cached.set(cc,targetHist.map((p)=>{
      const baseRate=baseByDate.get(toDayKey(p.date));
      if(!baseRate) return null;
      return {date:p.date,rate:p.rate/baseRate};
    }).filter(Boolean));
  }

  displayHistoriesCache.set(displayKey,cached);
  return Object.fromEntries(uniqCodes.map((cc)=>[cc,cached.get(cc)||[]]));
}

export async function getDisplayHistory(cc,periodKey,baseCode){
  const batch=await getDisplayHistoriesBatch([cc],periodKey,baseCode);
  return batch[cc]||[];
}
