import { BASE_CODES, FOREIGN_CODES, getDisplayPrevMap, getDisplayRates, toRateMap } from "./domain/rates.js";
import { getCurrentRates, getDisplayHistory, getDisplayHistoriesBatch, getYesterdayRates } from "./services/nbu-api.js";
import { createCardsUI } from "./ui/cards.js";
import { createChartsUI } from "./ui/charts.js";
import { createConverterUI } from "./ui/converter.js";

const grid=document.getElementById("rates-grid");
const headerEl=document.querySelector(".header");
const lastUpd=document.getElementById("last-updated");
const refreshBtn=document.getElementById("refresh-btn");
const installBtn=document.getElementById("install-btn");
const baseSwitcher=document.getElementById("base-switcher");

let selectedBase="UAH";
let ratesByCode={};
let prevRatesByCode={};
let dashboardLoadToken=0;
let isConverterFocused=false;
let focusedMode="none";
let listRevealTimer=0;
const LIST_REVEAL_CLASS="list-reveal";
const LIST_REVEAL_DURATION_MS=165;

function triggerListReveal(){
  if(!grid) return;
  grid.classList.remove(LIST_REVEAL_CLASS);
  void grid.offsetWidth;
  grid.classList.add(LIST_REVEAL_CLASS);
  window.clearTimeout(listRevealTimer);
  listRevealTimer=window.setTimeout(()=>{
    grid.classList.remove(LIST_REVEAL_CLASS);
  },LIST_REVEAL_DURATION_MS);
}

function setFocusedMode(mode){
  const prevMode=focusedMode;
  focusedMode=mode;
  const isCardFocused=mode==="card";
  const isConverterMode=mode==="converter";
  isConverterFocused=isConverterMode;
  grid.classList.toggle("focused-converter-mode",isConverterMode);
  headerEl?.classList.toggle("converter-focus",isConverterMode);
  headerEl?.classList.toggle("has-open-card",isCardFocused);
  if(prevMode==="converter"&&mode==="none"){
    triggerListReveal();
  }
}

const converter = createConverterUI({
  headerEl,
  converterOpenBtn:document.getElementById("converter-open"),
  amountInput:document.getElementById("converter-amount"),
  fromSelect:document.getElementById("converter-from"),
  toSelect:document.getElementById("converter-to"),
  swapBtn:document.getElementById("converter-swap"),
  resultEl:document.getElementById("converter-result"),
  rateEl:document.getElementById("converter-rate"),
  onCloseActiveCards:()=>{
    cards?.closeActiveCard?.({ restoreScroll:true });
  },
  onFocusModeChange:(isFocused)=>{
    if(isFocused){
      setFocusedMode("converter");
      return;
    }
    if(focusedMode==="converter") setFocusedMode("none");
  },
});

function setMsg(cc,type,visible,text){
  const el=document.getElementById(`${type}-${cc}`);
  if(!el) return;
  el.style.display=visible?"block":"none";
  if(visible&&text!=null) el.textContent=text;
}

let cards;
const charts = createChartsUI({
  getDisplayHistory,
  getDisplayHistoriesBatch,
  getSelectedBase:()=>selectedBase,
  setMsg,
  getOpenCardCode:()=>cards?.getOpenCardCode?.()||null,
});
cards = createCardsUI({
  gridEl:grid,
  getSelectedBase:()=>selectedBase,
  getPrevMap:()=>getDisplayPrevMap(selectedBase,prevRatesByCode),
  charts,
  onCloseConverter:()=>converter.closeConverter(),
  onFocusModeChange:(isFocused)=>{
    if(isFocused){
      setFocusedMode("card");
      return;
    }
    if(focusedMode==="card") setFocusedMode("none");
  },
});

function updateBaseButtons(){
  document.querySelectorAll(".base-switcher .base-btn").forEach((btn)=>{
    const isActive=btn.dataset.base===selectedBase;
    btn.classList.toggle("active",isActive);
  });
  document.querySelectorAll(".base-switcher-inline .base-btn").forEach((btn)=>{
    const isActive=btn.dataset.base===selectedBase;
    btn.classList.toggle("active",isActive);
  });
}

function handleBaseSwitchClick(e){
  const btn=e.target.closest(".base-btn");
  if(!btn) return;
  const nextBase=btn.dataset.base;
  if(!BASE_CODES.includes(nextBase)||nextBase===selectedBase) return;
  const prevBase=selectedBase;
  selectedBase=nextBase;
  updateBaseButtons();
  const nextDisplayRates=getDisplayRates(selectedBase,ratesByCode);
  cards.syncCards(nextDisplayRates);
  charts.refreshForBaseChange(nextDisplayRates.map((item)=>item.cc),selectedBase);
  updateBaseButtons();
  // Preserve existing cards DOM; only local rate/delta/list updates are applied for base switching.
  if(prevBase!==selectedBase){
    converter.updateConverterResult();
  }
}

function renderDashboard(){
  charts.resetChartState();
  cards.renderCards(getDisplayRates(selectedBase,ratesByCode));
  // Sparkline prefetch is deferred to idle time so it does not compete with first paint.
  charts.launchSparklinesPrefetch(()=>Object.keys(ratesByCode).filter((cc)=>cc!==selectedBase),selectedBase);
  converter.setRates(ratesByCode);
  converter.renderConverterOptions();
  converter.updateConverterResult();
}

function refreshDeltaCards(){
  cards.updateCardDeltas(getDisplayRates(selectedBase,ratesByCode));
}

function getCurrentDisplayCodes(){
  return getDisplayRates(selectedBase,ratesByCode).map((item)=>item.cc);
}

function refreshSparklineTargetsForViewport(){
  if(!Object.keys(ratesByCode).length) return;
  charts.handleViewportModeChange(getCurrentDisplayCodes(),selectedBase);
}

function loadYesterdayRatesInBackground(loadToken){
  // Deferred yesterday update: do not block the first dashboard render.
  getYesterdayRates().then((yesterdayRaw)=>{
    if(loadToken!==dashboardLoadToken) return;
    prevRatesByCode=toRateMap((yesterdayRaw||[]).filter((i)=>FOREIGN_CODES.includes(i.cc)));
    refreshDeltaCards();
  }).catch(()=>{
    // Keep dashboard interactive even if yesterday rates are unavailable.
  });
}

async function loadDashboard(forceRefresh=false){
  const loadToken=++dashboardLoadToken;
  refreshBtn.classList.add("spinning"); refreshBtn.disabled=true;
  try{
    const currentRaw=(await getCurrentRates(forceRefresh)).filter((i)=>FOREIGN_CODES.includes(i.cc));
    if(loadToken!==dashboardLoadToken) return;
    if(!currentRaw.length) throw new Error("Дані НБУ недоступні");

    ratesByCode=toRateMap(currentRaw);
    prevRatesByCode={};
    renderDashboard();
    loadYesterdayRatesInBackground(loadToken);

    const t=new Date().toLocaleTimeString("uk-UA",{hour:"2-digit",minute:"2-digit"});
    lastUpd.textContent=`Дані на: ${currentRaw[0]?.exchangedate||"—"} · оновлено о ${t}`;
    localStorage.setItem("nbu5_last_fetch",Date.now().toString());
  }catch(err){
    if(loadToken!==dashboardLoadToken) return;
    grid.innerHTML=`<div class="global-error">Не вдалося завантажити курси НБУ.<br><small>${String(err.message||err)}</small></div>`;
    lastUpd.textContent="Дані недоступні";
  }finally{
    if(loadToken===dashboardLoadToken){
      refreshBtn.classList.remove("spinning"); refreshBtn.disabled=false;
    }
  }
}

refreshBtn.addEventListener("click",()=>loadDashboard(true));
grid.addEventListener("click",(e)=>{
  if(e.target.closest(".base-switcher-inline .base-btn")){
    handleBaseSwitchClick(e);
  }
});
baseSwitcher?.addEventListener("click",handleBaseSwitchClick);
document.addEventListener("visibilitychange",()=>{
  if(document.hidden) return;
  const last=parseInt(localStorage.getItem("nbu5_last_fetch")||"0",10);
  if(Date.now()-last>30*60*1000) loadDashboard(false);
});

let deferredPrompt=null;
window.addEventListener("beforeinstallprompt",(e)=>{ e.preventDefault(); deferredPrompt=e; installBtn.style.display="flex"; });
installBtn.addEventListener("click",async()=>{
  if(!deferredPrompt) return;
  deferredPrompt.prompt();
  const {outcome}=await deferredPrompt.userChoice;
  if(outcome==="accepted") installBtn.style.display="none";
  deferredPrompt=null;
});
window.addEventListener("appinstalled",()=>{ deferredPrompt=null; installBtn.style.display="none"; });

if("serviceWorker" in navigator){ window.addEventListener("load",()=>navigator.serviceWorker.register("./sw.js").catch(()=>{})); }
window.addEventListener("resize",()=>{
  refreshSparklineTargetsForViewport();
});
window.addEventListener("orientationchange",()=>{
  refreshSparklineTargetsForViewport();
});
const sparklineViewportQuery=window.matchMedia("(max-width: 560px)");
sparklineViewportQuery.addEventListener("change",refreshSparklineTargetsForViewport);

converter.bindEvents();
updateBaseButtons();
loadDashboard();
