import { CURRENCY_META, PERIODS, escHtml, fmtRate } from "../domain/rates.js";

export function createCardsUI({ gridEl, getSelectedBase, getPrevMap, charts, onCloseConverter, scheduleEnsureCardVisible }){
  function buildDelta(today,prev,baseCode){
    if(prev==null) return `<span class="delta loading" aria-hidden="true">&nbsp;</span>`;
    const diff=today-prev,pct=(diff/prev)*100;
    if(Math.abs(pct)<0.005) return `<span class="delta flat">±0%</span>`;
    const cls=pct>0?"up":"down",arrow=pct>0?"↑":"↓";
    return `<span class="delta ${cls}" title="${pct>0?'+':'−'}${Math.abs(diff).toFixed(4)} ${baseCode}">${arrow}${Math.abs(pct).toFixed(2)}%</span>`;
  }

  function renderCards(rates){
    const prevMap=getPrevMap();
    const baseCode=getSelectedBase();
    gridEl.innerHTML="";
    rates.forEach((item)=>{
      const meta=CURRENCY_META[item.cc]||{};
      const w=document.createElement("section");
      w.className="item-wrapper"; w.id=`wrap-${item.cc}`;
      w.innerHTML=`
        <button class="card" type="button" aria-expanded="false" aria-controls="det-${item.cc}">
          <div class="currency-info">
            <div class="currency-badge" aria-hidden="true">${meta.symbol||item.cc}</div>
            <div class="currency-text">
              <div class="currency-code">${item.cc}</div>
              <div class="currency-name">${meta.name||escHtml(item.txt)}</div>
            </div>
          </div>
          <div class="right-side">
            <div class="sparkline-col" id="spark-${item.cc}"></div>
            <div class="rate-box"><div class="rate-row"><div class="rate-main">
              <span class="rate-value"><span class="rate-number">${fmtRate(item.rate)}</span><span class="rate-currency">${baseCode}</span></span>
              <div class="rate-meta">${buildDelta(item.rate,prevMap[item.cc],baseCode)}<div class="rate-note">за ${item.units||1}&thinsp;${item.cc}</div></div>
            </div></div></div>
            <svg class="chevron" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M6 9l6 6 6-6" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </div>
        </button>
        <div class="details" id="det-${item.cc}" role="region" aria-label="Деталі ${item.cc}">
          <div class="details-inner">
            <div class="period-tabs" role="group" aria-label="Обрати період">
              ${Object.entries(PERIODS).map(([k,p])=>`<button class="period-tab${k==='30d'?' active':''}" data-cc="${item.cc}" data-period="${k}">${p.label}</button>`).join("")}
            </div>
            <div class="loader-text" id="loader-${item.cc}" style="display:none">Завантаження…</div>
            <div class="chart-error" id="err-${item.cc}" style="display:none"></div>
            <div class="chart-empty" id="empty-${item.cc}" style="display:none">Немає даних.</div>
            <div class="chart-wrap" id="cwrap-${item.cc}"><div class="chart-top-indicator" id="tip-${item.cc}" aria-live="polite"></div><canvas id="chart-${item.cc}"></canvas></div>
          </div>
        </div>`;
      w.querySelector(".card").addEventListener("click",()=>toggleCard(item.cc));
      w.querySelectorAll(".period-tab").forEach((btn)=>btn.addEventListener("click",(e)=>{ e.stopPropagation(); switchPeriod(item.cc,btn.dataset.period); }));
      gridEl.appendChild(w);
    });
  }


  function updateCardDeltas(rates){
    const prevMap=getPrevMap();
    const baseCode=getSelectedBase();
    rates.forEach((item)=>{
      const wrap=document.getElementById(`wrap-${item.cc}`);
      const rateMeta=wrap?.querySelector(".rate-meta");
      if(!rateMeta) return;
      rateMeta.innerHTML=`${buildDelta(item.rate,prevMap[item.cc],baseCode)}<div class="rate-note">за ${item.units||1}&thinsp;${item.cc}</div>`;
    });
  }

  function updateCardsBaseData(rates){
    const prevMap=getPrevMap();
    const baseCode=getSelectedBase();
    rates.forEach((item)=>{
      const wrap=document.getElementById(`wrap-${item.cc}`);
      if(!wrap) return;
      const rateNumber=wrap.querySelector(".rate-number");
      const rateCurrency=wrap.querySelector(".rate-currency");
      const rateMeta=wrap.querySelector(".rate-meta");
      if(rateNumber) rateNumber.textContent=fmtRate(item.rate);
      if(rateCurrency) rateCurrency.textContent=baseCode;
      if(rateMeta) rateMeta.innerHTML=`${buildDelta(item.rate,prevMap[item.cc],baseCode)}<div class="rate-note">за ${item.units||1}&thinsp;${item.cc}</div>`;
    });
  }

  async function toggleCard(cc){
    const w=document.getElementById(`wrap-${cc}`);
    const btn=w?.querySelector(".card");
    if(!w||!btn) return;
    const wasOpen=w.classList.contains("active");
    if(!wasOpen) onCloseConverter();

    document.querySelectorAll(".item-wrapper.active").forEach((el)=>{ if(el===w)return; el.classList.remove("active"); el.querySelector(".card")?.setAttribute("aria-expanded","false"); });

    if(wasOpen){ w.classList.remove("active"); btn.setAttribute("aria-expanded","false"); return; }
    w.classList.add("active"); btn.setAttribute("aria-expanded","true");
    scheduleEnsureCardVisible(cc,40);

    const hasCanvas = !!document.getElementById(`chart-${cc}`);
    if(hasCanvas) await charts.loadChart(cc, charts.getActivePeriod(cc));
    scheduleEnsureCardVisible(cc,150);
  }

  async function switchPeriod(cc,pKey){
    await charts.switchPeriod(cc,pKey);
  }

  return {
    renderCards,
    updateCardDeltas,
    updateCardsBaseData,
    toggleCard,
    switchPeriod,
    getOpenCardCode:() => document.querySelector('.item-wrapper.active')?.id?.replace('wrap-','')||null,
  };
}
