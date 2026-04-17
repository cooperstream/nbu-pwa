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
  const batch=await getHistoriesBatch([cc],periodKey);
  return batch[cc]||[];
}

export async function getHistoriesBatch(codes,periodKey){
  const uniqueCodes=[...new Set((codes||[]).filter(Boolean))];
  if(!uniqueCodes.length) return {};

  const dates=buildHistorySampleDates(periodKey,new Date());
  const ttlH=periodKey==="30d"?TTL.h30:periodKey==="90d"?TTL.h90:TTL.h1y;
  const response={};
  const pendingCodes=[];

  for(const cc of uniqueCodes){
    if(cc==="UAH"){
      response[cc]=dates.map((date)=>({date,rate:1}));
      continue;
    }
    const cKey=keyHist(cc,periodKey);
    const emptyKey=keyHistEmpty(cc,periodKey);
    if(cGet(emptyKey,TTL.hEmpty)){ response[cc]=[]; continue; }

    const cached=cGet(cKey,ttlH);
    if(Array.isArray(cached)&&cached.length>0){
      response[cc]=cached.map((i)=>({date:new Date(i.d),rate:i.r}));
      continue;
    }

    const legacyCached=cGet(keyHistLegacy(cc,periodKey),ttlH);
    if(Array.isArray(legacyCached)&&legacyCached.length>0){
      response[cc]=legacyCached.map((i)=>({date:new Date(i.d),rate:i.r}));
      continue;
    }

    pendingCodes.push(cc);
  }
  if(!pendingCodes.length) return response;

  // Batch history builder: one sampled date set + one day payload stream for all requested currencies.
  const minPointsByPeriod={"30d":5,"90d":6,"1y":6};
  const minPoints=minPointsByPeriod[periodKey]||4;
  const maxParallel=5;
  const resultByCode=Object.fromEntries(pendingCodes.map((cc)=>[cc,new Array(dates.length).fill(null)]));
  const statsByCode=Object.fromEntries(pendingCodes.map((cc)=>[cc,{timeout:0,http:0,empty:0,failed:0}]));

  async function runBatch(indexes,batchMaxParallel,timeoutMs){
    let cursor=0;
    async function worker(){
      while(cursor<indexes.length){
        const idx=indexes[cursor++];
        const d=dates[idx];
        const ymd=fmtYMD(d);
        const dayRes=await getRatesByDate(ymd,timeoutMs);
        if(dayRes.ok){
          for(const code of pendingCodes){
            if(resultByCode[code][idx]) continue;
            if(Number.isFinite(dayRes.ratesByCode?.[code])){
              resultByCode[code][idx]={date:d,rate:Number(dayRes.ratesByCode[code])};
            }
          }
          continue;
        }
        for(const code of pendingCodes){
          if(resultByCode[code][idx]) continue;
          const stats=statsByCode[code];
          stats.failed++;
          if(dayRes.kind==="timeout") stats.timeout++;
          else if(dayRes.kind==="empty") stats.empty++;
          else stats.http++;
        }
      }
    }
    const workers=Array.from({length:Math.min(batchMaxParallel,indexes.length)},()=>worker());
    await Promise.all(workers);
  }

  await runBatch(dates.map((_,idx)=>idx),maxParallel,6000);
  const needsRetry=pendingCodes.some((cc)=>resultByCode[cc].filter(Boolean).length<minPoints);
  if(needsRetry){
    const missingIndexes=dates
      .map((_,idx)=>pendingCodes.some((cc)=>!resultByCode[cc][idx])?idx:null)
      .filter((idx)=>idx!=null);
    if(missingIndexes.length){
      await runBatch(missingIndexes,2,9000);
    }
  }

  for(const cc of pendingCodes){
    const normalized=resultByCode[cc].filter(Boolean).sort((a,b)=>a.date-b.date);
    const stats=statsByCode[cc];
    const failRatio=dates.length?stats.failed/dates.length:0;
    if(!normalized.length && (stats.timeout+stats.http)>0 && failRatio>=0.3){
      const err=new Error("Сервер НБУ не відповідає стабільно, спробуйте пізніше.");
      err.code="HISTORY_FETCH_FAILED";
      throw err;
    }
    if(normalized.length===0){
      cSet(keyHistEmpty(cc,periodKey),true);
      response[cc]=[];
      continue;
    }
    cSet(keyHist(cc,periodKey),normalized.map((i)=>({d:i.date.getTime(),r:i.rate})));
    response[cc]=normalized;
  }

  return response;
}

export async function getDisplayHistory(cc,periodKey,baseCode){
  const batch=await getDisplayHistoriesBatch([cc],periodKey,baseCode);
  return batch[cc]||[];
}

export async function getDisplayHistoriesBatch(codes,periodKey,baseCode){
  const uniqueCodes=[...new Set((codes||[]).filter(Boolean))];
  if(!uniqueCodes.length) return {};
  if(baseCode==="UAH") return getHistoriesBatch(uniqueCodes,periodKey);

  const sourceCodes=[...new Set([...uniqueCodes,baseCode])];
  const sourceBatch=await getHistoriesBatch(sourceCodes,periodKey);
  const baseHist=sourceBatch[baseCode]||[];
  const baseByDate=new Map(baseHist.map((p)=>[toDayKey(p.date),p.rate]));
  const response={};

  for(const cc of uniqueCodes){
    if(cc==="UAH"){
      response[cc]=baseHist.filter((p)=>p.rate).map((p)=>({date:p.date,rate:1/p.rate}));
      continue;
    }
    const targetHist=sourceBatch[cc]||[];
    response[cc]=targetHist
      .map((p)=>{
        const baseRate=baseByDate.get(toDayKey(p.date));
        if(!baseRate) return null;
        return {date:p.date,rate:p.rate/baseRate};
      })
      .filter(Boolean);
  }
  return response;
}
