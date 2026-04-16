import { fmtRate, isRisingTrend } from "../domain/rates.js";

const chartInstances = {};
const activePeriod = {};
const chartRequestTokens = {};
let sparkPrefetchLaunched = false;
let sparkPrefetchPromise = null;

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

export function createChartsUI({ getDisplayHistory, getSelectedBase, scheduleEnsureCardVisible, setMsg, getOpenCardCode }){
  function renderChart(cc,history,pKey,baseCode){
    const Chart = window.Chart;
    const cwrap=document.getElementById(`cwrap-${cc}`);
    const canvas=document.getElementById(`chart-${cc}`);
    const topTip=document.getElementById(`tip-${cc}`);
    if(!cwrap||!canvas||!Chart) return;

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

    requestAnimationFrame(()=>{ chartInstances[cc]?.resize(); scheduleEnsureCardVisible(cc,80); });
  }

  async function loadChart(cc,pKey){
    activePeriod[cc]=pKey;
    const requestToken=`${Date.now()}_${Math.random().toString(36).slice(2,8)}`;
    chartRequestTokens[cc]=requestToken;
    const cwrap=document.getElementById(`cwrap-${cc}`);
    cwrap?.classList.remove("ready");
    cwrap?.classList.add("loading");
    setMsg(cc,"loader",false); setMsg(cc,"err",false); setMsg(cc,"empty",false);

    try{
      const history=await getDisplayHistory(cc,pKey,getSelectedBase());
      if(chartRequestTokens[cc]!==requestToken) return;
      if(activePeriod[cc]!==pKey) return;
      if(getOpenCardCode()!==cc) return;
      if(!history.length){ cwrap?.classList.remove("loading"); setMsg(cc,"empty",true,"Немає даних за цей період."); return; }
      renderChart(cc,history,pKey,getSelectedBase());
    }catch(err){
      if(chartRequestTokens[cc]!==requestToken) return;
      cwrap?.classList.remove("loading");
      setMsg(cc,"err",true,`Помилка: ${String(err.message||err)}`);
    }
  }

  async function switchPeriod(cc,pKey){
    if(activePeriod[cc]===pKey&&chartInstances[cc]) return;
    activePeriod[cc]=pKey;
    document.getElementById(`wrap-${cc}`)?.querySelectorAll(".period-tab").forEach((b)=>b.classList.toggle("active",b.dataset.period===pKey));
    await loadChart(cc,pKey);
    scheduleEnsureCardVisible(cc,220);
  }

  async function runPrefetchSparklines(getDisplayCodes){
    if(window.matchMedia("(max-width: 560px)").matches) return;
    const codes=getDisplayCodes();
    let failures=0;
    const queue=[...codes];
    async function worker(){
      while(queue.length && failures<3){
        const cc=queue.shift();
        const el=document.getElementById(`spark-${cc}`);
        if(!el||el.classList.contains("ready")||el.dataset.sparkReady==="1") continue;
        const rect=el.getBoundingClientRect();
        if(!(rect.bottom>=-120&&rect.top<=window.innerHeight+120)) continue;
        try{
          const h=await getDisplayHistory(cc,"30d",getSelectedBase());
          if(h.length<2) continue;
          el.innerHTML=buildSparkline(h.map((p)=>p.rate));
          el.classList.add("ready");
          el.dataset.sparkReady="1";
        }catch(_e){ failures++; }
      }
    }
    await Promise.all(Array.from({length:3},()=>worker()));
  }

  function launchSparklinesPrefetch(getDisplayCodes){
    if(sparkPrefetchLaunched) return sparkPrefetchPromise||Promise.resolve();
    sparkPrefetchLaunched=true;
    sparkPrefetchPromise=runPrefetchSparklines(getDisplayCodes).catch(()=>{}).finally(()=>{ sparkPrefetchPromise=null; });
    return sparkPrefetchPromise;
  }

  function resetChartState(){
    Object.values(chartInstances).forEach((c)=>{ try{c.destroy();}catch(_e){} });
    Object.keys(chartInstances).forEach((k)=>delete chartInstances[k]);
    Object.keys(activePeriod).forEach((k)=>delete activePeriod[k]);
    sparkPrefetchLaunched=false; sparkPrefetchPromise=null;
  }

  return { loadChart, switchPeriod, launchSparklinesPrefetch, resetChartState, getActivePeriod:(cc)=>activePeriod[cc]||"30d" };
}
