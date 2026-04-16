import { BASE_CODES, FOREIGN_CODES, getDisplayPrevMap, getDisplayRates, toRateMap } from "./domain/rates.js";
import { getCurrentRates, getDisplayHistory, getYesterdayRates } from "./services/nbu-api.js";
import { createCardsUI } from "./ui/cards.js";
import { createChartsUI } from "./ui/charts.js";
import { createConverterUI } from "./ui/converter.js";

const grid=document.getElementById("rates-grid");
const mainScrollEl=document.getElementById("dashboard-main");
const headerEl=document.querySelector(".header");
const lastUpd=document.getElementById("last-updated");
const refreshBtn=document.getElementById("refresh-btn");
const installBtn=document.getElementById("install-btn");
const baseSwitcher=document.getElementById("base-switcher");

let selectedBase="UAH";
let ratesByCode={};
let prevRatesByCode={};

const converter = createConverterUI({
  headerEl,
  converterOpenBtn:document.getElementById("converter-open"),
  amountInput:document.getElementById("converter-amount"),
  fromSelect:document.getElementById("converter-from"),
  toSelect:document.getElementById("converter-to"),
  swapBtn:document.getElementById("converter-swap"),
  resultEl:document.getElementById("converter-result"),
  rateEl:document.getElementById("converter-rate"),
});

function setMsg(cc,type,visible,text){
  const el=document.getElementById(`${type}-${cc}`);
  if(!el) return;
  el.style.display=visible?"block":"none";
  if(visible&&text!=null) el.textContent=text;
}

function ensureCardFullyVisible(cc, smooth=true){
  const wrap=document.getElementById(`wrap-${cc}`); if(!wrap) return;
  if(mainScrollEl){
    const rect=wrap.getBoundingClientRect();
    const mainRect=mainScrollEl.getBoundingClientRect();
    if(rect.bottom > mainRect.bottom - 12){
      mainScrollEl.scrollBy({top:rect.bottom-mainRect.bottom+12,behavior:smooth?"smooth":"auto"});
    }else if(rect.top < mainRect.top + 10){
      mainScrollEl.scrollBy({top:rect.top-mainRect.top-10,behavior:smooth?"smooth":"auto"});
    }
    return;
  }
  const rect=wrap.getBoundingClientRect();
  if(rect.bottom > window.innerHeight - 12){ window.scrollBy({top:rect.bottom-window.innerHeight+12,behavior:smooth?"smooth":"auto"}); }
  else if(rect.top < 10){ window.scrollBy({top:rect.top-10,behavior:smooth?"smooth":"auto"}); }
}
function scheduleEnsureCardVisible(cc,delay=0){ window.setTimeout(()=>ensureCardFullyVisible(cc),delay); }

let cards;
const charts = createChartsUI({
  getDisplayHistory,
  getSelectedBase:()=>selectedBase,
  scheduleEnsureCardVisible,
  setMsg,
  getOpenCardCode:()=>cards?.getOpenCardCode?.()||null,
});
cards = createCardsUI({
  gridEl:grid,
  getSelectedBase:()=>selectedBase,
  getPrevMap:()=>getDisplayPrevMap(selectedBase,prevRatesByCode),
  charts,
  onCloseConverter:()=>converter.closeConverter(),
  scheduleEnsureCardVisible,
});

function updateBaseButtons(){
  baseSwitcher?.querySelectorAll(".base-btn").forEach((btn)=>btn.classList.toggle("active",btn.dataset.base===selectedBase));
}

function renderDashboard(){
  charts.resetChartState();
  cards.renderCards(getDisplayRates(selectedBase,ratesByCode));
  charts.launchSparklinesPrefetch(()=>Object.keys(ratesByCode).filter((cc)=>cc!==selectedBase));
  converter.setRates(ratesByCode);
  converter.renderConverterOptions();
  converter.updateConverterResult();
}

async function loadDashboard(forceRefresh=false){
  refreshBtn.classList.add("spinning"); refreshBtn.disabled=true;
  try{
    const [curRes,yestRes]=await Promise.allSettled([getCurrentRates(forceRefresh),getYesterdayRates()]);
    const currentRaw=(curRes.status==="fulfilled"?curRes.value:[]).filter((i)=>FOREIGN_CODES.includes(i.cc));
    if(!currentRaw.length) throw new Error("Дані НБУ недоступні");
    ratesByCode=toRateMap(currentRaw);
    prevRatesByCode=toRateMap((yestRes.status==="fulfilled"?yestRes.value:[]).filter((i)=>FOREIGN_CODES.includes(i.cc)));
    renderDashboard();
    const t=new Date().toLocaleTimeString("uk-UA",{hour:"2-digit",minute:"2-digit"});
    lastUpd.textContent=`Дані на: ${currentRaw[0]?.exchangedate||"—"} · оновлено о ${t}`;
    localStorage.setItem("nbu5_last_fetch",Date.now().toString());
  }catch(err){
    grid.innerHTML=`<div class="global-error">Не вдалося завантажити курси НБУ.<br><small>${String(err.message||err)}</small></div>`;
    lastUpd.textContent="Дані недоступні";
  }finally{
    refreshBtn.classList.remove("spinning"); refreshBtn.disabled=false;
  }
}

refreshBtn.addEventListener("click",()=>loadDashboard(true));
baseSwitcher?.addEventListener("click",(e)=>{
  const btn=e.target.closest(".base-btn");
  if(!btn) return;
  const nextBase=btn.dataset.base;
  if(!BASE_CODES.includes(nextBase)||nextBase===selectedBase) return;
  selectedBase=nextBase;
  updateBaseButtons();
  renderDashboard();
});
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
window.addEventListener("resize",()=>{ const active=document.querySelector(".item-wrapper.active"); if(active) scheduleEnsureCardVisible(active.id.replace("wrap-",""),80); });
window.addEventListener("orientationchange",()=>{ const active=document.querySelector(".item-wrapper.active"); if(active) scheduleEnsureCardVisible(active.id.replace("wrap-",""),250); });

converter.bindEvents();
updateBaseButtons();
loadDashboard();
