import { fmtRate, isRisingTrend } from "../domain/rates.js";

const chartInstances = {};
const activePeriod = {};
const chartRequestTokens = {};
let sparkPrefetchPromise = null;
let sparkPrefetchTimer = null;
let queuedSparkRequest = null;
let sparkObserver = null;
const observedSparkTargets = new Map();
const queuedSparkCodes = new Set();
let chartJsLoadPromise = null;

export function buildSparkline(values,W=68,H=30){
  if(!values||values.length<2) return "";
  const min=Math.min(...values),max=Math.max(...values),rng=max-min||1;
  const px=i=>((i/(values.length-1))*W).toFixed(1);
  const py=v=>(H-2-((v-min)/rng)*(H-4)).toFixed(1);
  const pts=values.map((v,i)=>`${px(i)},${py(v)}`).join(" ");
  const area=`M 0,${H} `+values.map((v,i)=>`L ${px(i)},${py(v)}`).join(" ")+` L ${W},${H} Z`;
  const col=isRisingTrend(values)?"#22c55e":"#f87171";
  const gid="sg"+Math.random().toString(36).slice(2,8);
  return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" fill="none" aria-hidden="true">
    <defs><linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${col}" stop-opacity=".28"/>
      <stop offset="100%" stop-color="${col}" stop-opacity="0"/>
    </linearGradient></defs>
    <path d="${area}" fill="url(#${gid})"/>
    <polyline points="${pts}" stroke="${col}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`;
}

function ensureChartJsLoaded(){
  if(window.Chart) return Promise.resolve(window.Chart);
  if(chartJsLoadPromise) return chartJsLoadPromise;

  // Lazy Chart.js loader with singleton in-flight promise.
  chartJsLoadPromise=new Promise((resolve,reject)=>{
    const script=document.createElement("script");
    script.src="https://cdn.jsdelivr.net/npm/chart.js@4.4.3/dist/chart.umd.min.js";
    script.async=true;
    script.onload=()=>resolve(window.Chart);
    script.onerror=()=>reject(new Error("Не вдалося завантажити Chart.js"));
    document.head.appendChild(script);
  }).finally(()=>{
    if(!window.Chart) chartJsLoadPromise=null;
  });

  return chartJsLoadPromise;
}

export function createChartsUI({ getDisplayHistory, getDisplayHistoriesBatch, getSelectedBase, setMsg, getOpenCardCode }){
  function clearChartHoverState(cc){
    if(!cc) return;
    const topTip=document.getElementById(`tip-${cc}`);
    if(topTip){
      topTip.classList.remove("visible");
      topTip.textContent="";
      topTip.style.left="";
    }
    const chart=chartInstances[cc];
    if(!chart) return;
    try{
      chart.setActiveElements?.([]);
      chart.tooltip?.setActiveElements?.([],{x:0,y:0});
      chart.update?.("none");
    }catch(_e){}
  }

  function isSparklineDisabled(){
    return window.matchMedia("(max-width: 560px)").matches;
  }
  let sparklineViewportDisabled=isSparklineDisabled();

  function renderChart(cc,history,pKey,baseCode){
    const Chart = window.Chart;
    const cwrap=document.getElementById(`cwrap-${cc}`);
    const canvas=document.getElementById(`chart-${cc}`);
    const topTip=document.getElementById(`tip-${cc}`);
    if(!cwrap||!canvas||!Chart) return;

    clearChartHoverState(cc);
    if(chartInstances[cc]){ try{chartInstances[cc].destroy();}catch(_e){} delete chartInstances[cc]; }
    const existingChart = typeof Chart.getChart === "function" ? Chart.getChart(canvas) : null;
    if(existingChart){ try{existingChart.destroy();}catch(_e){} }

    const labels=history.map((p)=>p.date.toLocaleDateString("uk-UA",pKey==="1y"?{month:"short",year:"2-digit"}:{day:"numeric",month:"short"}));
    const values=history.map((p)=>p.rate);
    const xValues=history.map((p)=>new Date(p.date.getFullYear(),p.date.getMonth(),p.date.getDate()).getTime());
    const isUpTrend=isRisingTrend(values);
    const trendLineColor=isUpTrend ? "#22c55e" : "#f87171";
    const trendFillColor=isUpTrend ? "rgba(34,197,94,.11)" : "rgba(248,113,113,.14)";
    const trendPointBg=isUpTrend ? "#86efac" : "#fca5a5";
    cwrap.classList.remove("loading");
    cwrap.classList.add("ready");

    function hideTopTip(){ if(topTip){ topTip.classList.remove("visible"); topTip.textContent=""; } }
    function showTopTip(chart,activeEl){
      if(!topTip||!activeEl) return;
      const x=activeEl.element.x;
      const idx=activeEl.index;
      topTip.textContent=`${fmtRate(values[idx])} ${baseCode} · ${labels[idx]||""}`;
      const bubbleWidth=topTip.offsetWidth;
      const chartArea=chart.chartArea||{};
      const left=Number.isFinite(chartArea.left)?chartArea.left:0;
      const right=Number.isFinite(chartArea.right)?chartArea.right:chart.width;
      const safeCenter=Math.max(left+6+bubbleWidth/2,Math.min(right-6-bubbleWidth/2,x));
      topTip.style.left=`${safeCenter}px`;
      topTip.classList.add("visible");
    }

    chartInstances[cc]=new Chart(canvas.getContext("2d"),{
      plugins:[{ id:`hoverGuide_${cc}`,
        afterDatasetsDraw(chart){
          const active=chart.tooltip?.getActiveElements?.()||[];
          if(!active.length) return;
          const x=active[0].element.x;
          const {top,bottom}=chart.chartArea||{};
          if(!Number.isFinite(top)||!Number.isFinite(bottom)) return;
          const ctx=chart.ctx; ctx.save(); ctx.setLineDash([4,4]); ctx.strokeStyle="rgba(148,163,184,.75)"; ctx.lineWidth=1;
          ctx.beginPath(); ctx.moveTo(x,top); ctx.lineTo(x,bottom); ctx.stroke(); ctx.restore();
        },
        afterEvent(chart){
          const active=chart.tooltip?.getActiveElements?.()||[];
          if(!active.length){ hideTopTip(); return; }
          showTopTip(chart,active[0]);
        }
      }],
      type:"line",
      data:{ labels, datasets:[{
        label:`Курс (${baseCode})`,
        data:pKey==="30d"?values.map((v,i)=>({x:xValues[i],y:v})):values,
        borderColor:trendLineColor, backgroundColor:trendFillColor, fill:true, borderWidth:pKey==="30d"?2.1:2.3,
        cubicInterpolationMode:pKey==="30d"?"default":"monotone", tension:pKey==="30d"?0.42:0, spanGaps:true,
        pointRadius:2, pointHoverRadius:4, pointHitRadius:14, pointBackgroundColor:trendPointBg, pointBorderColor:trendLineColor, pointBorderWidth:1,
      }]},
      options:{ responsive:true, maintainAspectRatio:false, layout:{padding:{top:42}}, interaction:{mode:"index",intersect:false},
        plugins:{ legend:{display:false}, tooltip:{enabled:false, external(context){
          const active=context.tooltip?.getActiveElements?.()||[];
          if(!active.length){ hideTopTip(); return; }
          showTopTip(context.chart,active[0]);
        }}},
        scales:{
          x:{ grid:{display:false}, ...(pKey==="30d"?{type:"linear",min:xValues[0],max:xValues[xValues.length-1],ticks:{color:"#94a3b8",maxRotation:0,stepSize:3*24*60*60*1000,autoSkip:false,maxTicksLimit:8,callback:v=>new Date(Number(v)).toLocaleDateString("uk-UA",pKey==="1y"?{month:"short",year:"2-digit"}:{day:"numeric",month:"short"})}}:{ticks:{color:"#94a3b8",maxRotation:0,autoSkip:true,maxTicksLimit:pKey==="1y"?6:(pKey==="90d"?7:8)}}), border:{color:"#243041"}},
          y:{ticks:{color:"#94a3b8",callback:v=>fmtRate(v)},grid:{color:"rgba(148,163,184,.07)"},border:{color:"#243041"}}
        }
      }
    });

    requestAnimationFrame(()=>{ chartInstances[cc]?.resize(); });
  }

  async function loadChart(cc,pKey){
    activePeriod[cc]=pKey;
    const requestToken=`${Date.now()}_${Math.random().toString(36).slice(2,8)}`;
    chartRequestTokens[cc]=requestToken;
    clearChartHoverState(cc);
    const cwrap=document.getElementById(`cwrap-${cc}`);
    cwrap?.classList.remove("ready");
    cwrap?.classList.add("loading");
    setMsg(cc,"loader",false); setMsg(cc,"err",false); setMsg(cc,"empty",false);

    try{
      await ensureChartJsLoaded();
      const history=await getDisplayHistory(cc,pKey,getSelectedBase());
      if(chartRequestTokens[cc]!==requestToken) return;
      if(activePeriod[cc]!==pKey) return;
      if(getOpenCardCode()!==cc) return;
      if(!history.length){ clearChartHoverState(cc); cwrap?.classList.remove("loading"); setMsg(cc,"empty",true,"Немає даних за цей період."); return; }
      renderChart(cc,history,pKey,getSelectedBase());
    }catch(err){
      if(chartRequestTokens[cc]!==requestToken) return;
      clearChartHoverState(cc);
      cwrap?.classList.remove("loading");
      setMsg(cc,"err",true,`Помилка: ${String(err.message||err)}`);
    }
  }

  async function switchPeriod(cc,pKey){
    if(activePeriod[cc]===pKey&&chartInstances[cc]) return;
    clearChartHoverState(cc);
    activePeriod[cc]=pKey;
    document.getElementById(`wrap-${cc}`)?.querySelectorAll(".period-tab").forEach((b)=>b.classList.toggle("active",b.dataset.period===pKey));
    await loadChart(cc,pKey);
  }

  async function runPrefetchSparklines(codes,baseCode){
    if(isSparklineDisabled()) return;
    const requestedCodes=(codes||[]).filter((cc)=>!!getPendingSparklineEl(cc));
    if(!requestedCodes.length) return;
    requestedCodes.forEach((cc)=>{
      const el=document.getElementById(`spark-${cc}`);
      if(el) el.dataset.sparkLoading="1";
    });
    try{
      // Batch sparkline warmup reuses one history build flow for the whole intersected set.
      const histories=await getDisplayHistoriesBatch(requestedCodes,"30d",baseCode);
      requestedCodes.forEach((cc)=>{
        const el=document.getElementById(`spark-${cc}`);
        const h=histories[cc]||[];
        if(!el) return;
        el.dataset.sparkLoading="0";
        if(getSelectedBase()!==baseCode || h.length<2) return;
        el.innerHTML=buildSparkline(h.map((p)=>p.rate));
        el.classList.add("ready");
        el.dataset.sparkReady="1";
        // Stop observing once this sparkline is rendered to avoid duplicate jobs.
        if(sparkObserver){
          sparkObserver.unobserve(el);
          observedSparkTargets.delete(cc);
        }
      });
    }catch(_e){
      // Keep prefetch best-effort.
      requestedCodes.forEach((cc)=>{
        const el=document.getElementById(`spark-${cc}`);
        if(el) el.dataset.sparkLoading="0";
      });
    }
  }

  function scheduleSparkPrefetch(run){
    // Idle sparkline prefetch with fallback for browsers without requestIdleCallback.
    if(typeof window.requestIdleCallback==="function"){
      sparkPrefetchTimer=window.requestIdleCallback(run,{timeout:1500});
      return;
    }
    sparkPrefetchTimer=window.setTimeout(run,180);
  }

  function clearSparkPrefetchTimer(){
    if(!sparkPrefetchTimer) return;
    if(typeof window.cancelIdleCallback==="function") window.cancelIdleCallback(sparkPrefetchTimer);
    else window.clearTimeout(sparkPrefetchTimer);
    sparkPrefetchTimer=null;
  }

  function clearPendingSparklineJobs(codes){
    clearSparkPrefetchTimer();
    queuedSparkCodes.clear();
    queuedSparkRequest=null;
    sparkPrefetchPromise=null;
    (codes||[]).forEach((cc)=>{
      const el=document.getElementById(`spark-${cc}`);
      if(el) el.dataset.sparkLoading="0";
    });
  }

  function getPendingSparklineEl(cc,{allowLoading=false}={}){
    const el=document.getElementById(`spark-${cc}`);
    if(!el||el.classList.contains("ready")||el.dataset.sparkReady==="1") return null;
    if(!allowLoading&&el.dataset.sparkLoading==="1") return null;
    return el;
  }

  function queueSparklinePrefetch(codes,prefetchKey){
    if(!codes.length) return Promise.resolve();
    codes.forEach((cc)=>queuedSparkCodes.add(cc));
    if(sparkPrefetchPromise){
      queuedSparkRequest={ prefetchKey };
      return sparkPrefetchPromise;
    }
    clearSparkPrefetchTimer();
    sparkPrefetchPromise=new Promise((resolve)=>{
      scheduleSparkPrefetch(async()=>{
        sparkPrefetchTimer=null;
        const pendingCodes=[...queuedSparkCodes];
        queuedSparkCodes.clear();
        const baseCode=getSelectedBase();
        try{
          await runPrefetchSparklines(pendingCodes,baseCode);
        }catch(_e){}
        resolve();
      });
    }).finally(()=>{
      sparkPrefetchPromise=null;
      if(queuedSparkRequest){
        const nextPrefetchKey=queuedSparkRequest.prefetchKey;
        queuedSparkRequest=null;
        if(queuedSparkCodes.size){
          queueSparklinePrefetch([...queuedSparkCodes],nextPrefetchKey);
        }
      }
    });

    return sparkPrefetchPromise;
  }

  function disconnectSparklineObserver(){
    if(sparkObserver){
      sparkObserver.disconnect();
      sparkObserver=null;
    }
    observedSparkTargets.clear();
    queuedSparkCodes.clear();
  }

  function queueVisibleFallbackSparklineTargets(codes,prefetchKey){
    const visibleCodes=(codes||[]).filter((cc)=>{
      const el=getPendingSparklineEl(cc);
      if(!el) return false;
      const rect=el.getBoundingClientRect();
      return rect.bottom>=-120&&rect.top<=window.innerHeight+220;
    });
    return queueSparklinePrefetch(visibleCodes,prefetchKey);
  }

  function initSparklineObserver(prefetchKey){
    if(isSparklineDisabled()){
      disconnectSparklineObserver();
      return null;
    }
    if(sparkObserver) return sparkObserver;
    if(typeof IntersectionObserver!=="function") return null;

    sparkObserver=new IntersectionObserver((entries)=>{
      const intersectedCodes=entries.filter((entry)=>entry.isIntersecting||entry.intersectionRatio>0).map((entry)=>{
        const target=entry.target;
        return target.id.replace("spark-","");
      });
      if(!intersectedCodes.length) return;
      queueSparklinePrefetch(intersectedCodes,prefetchKey);
    },{ root:null, rootMargin:"180px 0px 220px 0px", threshold:0.01 });

    return sparkObserver;
  }

  function observeSparklineTargets(codes,prefetchKey){
    const observer=initSparklineObserver(prefetchKey);
    const nextCodes=new Set(codes||[]);

    observedSparkTargets.forEach((el,cc)=>{
      if(nextCodes.has(cc) && el.isConnected) return;
      observer?.unobserve(el);
      observedSparkTargets.delete(cc);
    });

    if(!observer){
      return queueVisibleFallbackSparklineTargets(codes,prefetchKey);
    }

    nextCodes.forEach((cc)=>{
      const el=getPendingSparklineEl(cc,{allowLoading:true});
      if(!el) return;
      if(observedSparkTargets.get(cc)===el) return;
      observer.observe(el);
      observedSparkTargets.set(cc,el);
    });
    return Promise.resolve();
  }

  function launchSparklinesPrefetch(getDisplayCodes,prefetchKey="default"){
    return observeSparklineTargets(getDisplayCodes()||[],prefetchKey);
  }

  function handleViewportModeChange(displayCodes,prefetchKey="default"){
    const nextDisabled=isSparklineDisabled();
    if(nextDisabled===sparklineViewportDisabled){
      if(nextDisabled) return Promise.resolve();
      return observeSparklineTargets(displayCodes||[],prefetchKey);
    }
    sparklineViewportDisabled=nextDisabled;
    if(nextDisabled){
      disconnectSparklineObserver();
      clearPendingSparklineJobs(displayCodes);
      return Promise.resolve();
    }
    return observeSparklineTargets(displayCodes||[],prefetchKey);
  }

  function resetChartState(){
    Object.values(chartInstances).forEach((c)=>{ try{c.destroy();}catch(_e){} });
    Object.keys(chartInstances).forEach((k)=>delete chartInstances[k]);
    Object.keys(activePeriod).forEach((k)=>delete activePeriod[k]);
    Object.keys(chartRequestTokens).forEach((k)=>delete chartRequestTokens[k]);
    clearSparkPrefetchTimer();
    disconnectSparklineObserver();
    sparkPrefetchPromise=null;
    queuedSparkRequest=null;
    sparklineViewportDisabled=isSparklineDisabled();
  }

  function disposeCard(cc){
    if(!cc) return;
    clearChartHoverState(cc);
    if(chartInstances[cc]){
      try{ chartInstances[cc].destroy(); }catch(_e){}
      delete chartInstances[cc];
    }
    delete activePeriod[cc];
    delete chartRequestTokens[cc];
    const observedEl=observedSparkTargets.get(cc);
    if(observedEl&&sparkObserver){
      sparkObserver.unobserve(observedEl);
    }
    observedSparkTargets.delete(cc);
    queuedSparkCodes.delete(cc);
  }

  function resetSparklineMarkers(codes){
    (codes||[]).forEach((cc)=>{
      const el=document.getElementById(`spark-${cc}`);
      if(!el) return;
      el.classList.remove("ready");
      el.dataset.sparkReady="0";
      el.dataset.sparkLoading="0";
      el.innerHTML="";
    });
  }

  function refreshForBaseChange(displayCodes,nextBase){
    const openCode=getOpenCardCode();
    if(openCode) clearChartHoverState(openCode);
    resetSparklineMarkers(displayCodes);
    launchSparklinesPrefetch(()=>displayCodes,nextBase);
    if(openCode) loadChart(openCode,activePeriod[openCode]||"30d");
  }

  return { loadChart, switchPeriod, launchSparklinesPrefetch, handleViewportModeChange, resetChartState, refreshForBaseChange, disposeCard, getActivePeriod:(cc)=>activePeriod[cc]||"30d" };
}
