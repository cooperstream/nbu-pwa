export const CURRENCY_META = {
  UAH:{name:"Українська гривня", symbol:"₴" },
  USD:{name:"Долар США",         symbol:"$" },
  EUR:{name:"Євро",              symbol:"€" },
  PLN:{name:"Польський злотий",  symbol:"zł"},
  CNY:{name:"Китайський юань",   symbol:"元"},
  XAU:{name:"Золото",            symbol:"Au"},
  XAG:{name:"Срібло",            symbol:"Ag"},
  XPT:{name:"Платина",           symbol:"Pt"},
  XPD:{name:"Паладій",           symbol:"Pd"},
};

export const ORDERED_CODES = ["UAH","USD","EUR","PLN","CNY","XAU","XAG","XPT","XPD"];
export const BASE_CODES = ["UAH","USD","EUR","PLN","CNY"];
export const FOREIGN_CODES = ORDERED_CODES.filter((cc) => cc !== "UAH");
export const PERIODS = {
  "30d":{label:"30 дн",days:30},
  "90d":{label:"90 дн",days:90},
  "1y" :{label:"1 рік",days:365},
};

export function pad(n){ return String(n).padStart(2,"0"); }
export function addDays(d,n){ const r = new Date(d); r.setDate(r.getDate()+n); return r; }
export function daysInMonth(year,monthIndex){ return new Date(year,monthIndex+1,0).getDate(); }
export function fmtYMD(d){ return `${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}`; }
export function toDayKey(dateObj){ return `${dateObj.getFullYear()}-${pad(dateObj.getMonth()+1)}-${pad(dateObj.getDate())}`; }
export function sameCalendarDay(a,b){
  return a.getFullYear()===b.getFullYear() && a.getMonth()===b.getMonth() && a.getDate()===b.getDate();
}

export function buildHistorySampleDates(periodKey,end){
  const endDate = new Date(end.getFullYear(),end.getMonth(),end.getDate());
  if(periodKey==="30d"){
    const start=addDays(endDate,-30);
    const dates=[];
    for(let d=new Date(start); d<=endDate; d=addDays(d,3)) dates.push(new Date(d));
    const yesterday=addDays(endDate,-1);
    if(!dates.some((date)=>sameCalendarDay(date,yesterday))) dates.push(new Date(yesterday));
    if(!dates.some((date)=>sameCalendarDay(date,endDate))) dates.push(new Date(endDate));
    dates.sort((a,b)=>a-b);
    return dates;
  }
  if(periodKey==="90d"){
    const start=addDays(endDate,-90);
    const dates=[];
    for(let d=new Date(start); d<=endDate; d=addDays(d,7)) dates.push(new Date(d));
    if(!dates.length || !sameCalendarDay(dates[dates.length-1],endDate)) dates.push(new Date(endDate));
    return dates;
  }
  const dates=[];
  const anchorDay=endDate.getDate();
  for(let i=11;i>=0;i--){
    const base=new Date(endDate.getFullYear(),endDate.getMonth()-i,1);
    const y=base.getFullYear();
    const m=base.getMonth();
    const d=Math.min(anchorDay,daysInMonth(y,m));
    dates.push(new Date(y,m,d));
  }
  return dates;
}

export function toRateMap(items){
  const map={UAH:1};
  (items||[]).forEach((i)=>{ if(i&&i.cc&&Number.isFinite(Number(i.rate))) map[i.cc]=Number(i.rate); });
  return map;
}

export function convertRateForBase(cc,rateMap,baseCode){
  if(cc===baseCode) return 1;
  if(baseCode==="UAH") return rateMap[cc] ?? null;
  if(cc==="UAH"){
    const baseRate=rateMap[baseCode];
    return baseRate ? 1/baseRate : null;
  }
  const baseRate=rateMap[baseCode];
  const targetRate=rateMap[cc];
  if(!baseRate||!targetRate) return null;
  return targetRate/baseRate;
}

export function getConverterRate(fromCode,toCode,rateMap){
  if(!fromCode||!toCode) return null;
  const fromRate = fromCode==="UAH" ? 1 : Number(rateMap[fromCode]);
  const toRate = toCode==="UAH" ? 1 : Number(rateMap[toCode]);
  if(!Number.isFinite(fromRate) || !Number.isFinite(toRate) || fromRate<=0 || toRate<=0) return null;
  return fromRate/toRate;
}

export function getDisplayRates(baseCode,ratesByCode){
  return ORDERED_CODES
    .filter((cc)=>cc!==baseCode)
    .map((cc)=>{
      const rawRate=convertRateForBase(cc,ratesByCode,baseCode);
      if(rawRate==null) return null;
      return {cc,txt:CURRENCY_META[cc]?.name||cc,rate:rawRate,units:1};
    })
    .filter(Boolean);
}

export function getDisplayPrevMap(baseCode,prevRatesByCode){
  const map={};
  ORDERED_CODES.forEach((cc)=>{
    if(cc===baseCode) return;
    const v=convertRateForBase(cc,prevRatesByCode,baseCode);
    if(v!=null) map[cc]=v;
  });
  return map;
}

export function getTrendSlope(values){
  if(!Array.isArray(values)||values.length<2) return 0;
  const pts=values.map((y,x)=>({x,y:Number(y)})).filter((p)=>Number.isFinite(p.y));
  if(pts.length<2) return 0;
  const n=pts.length;
  let sumX=0,sumY=0,sumXY=0,sumXX=0;
  for(const p of pts){ sumX+=p.x; sumY+=p.y; sumXY+=p.x*p.y; sumXX+=p.x*p.x; }
  const denominator=(n*sumXX)-(sumX*sumX);
  if(!denominator) return 0;
  return ((n*sumXY)-(sumX*sumY))/denominator;
}

export function isRisingTrend(values){
  return getTrendSlope(values) >= -1e-6;
}

export function fmtRate(v){ return Number(v).toLocaleString("uk-UA",{minimumFractionDigits:2,maximumFractionDigits:4}); }
export function fmtAmount(v){ return Number(v).toLocaleString("uk-UA",{minimumFractionDigits:0,maximumFractionDigits:4}); }
export function escHtml(s){ return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/\"/g,"&quot;"); }
