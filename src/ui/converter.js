import { fmtAmount, fmtRate, getConverterRate, ORDERED_CODES } from "../domain/rates.js";

export function createConverterUI({ headerEl, converterOpenBtn, amountInput, fromSelect, toSelect, swapBtn, resultEl, rateEl }){
  let converterFrom = "USD";
  let converterTo = "UAH";
  let ratesByCode = {};

  function getConverterCodes(){ return ORDERED_CODES.filter((cc)=>cc==="UAH"||Number.isFinite(ratesByCode[cc])); }

  function ensureConverterSelections(){
    const codes=getConverterCodes();
    if(!codes.length) return;
    if(!codes.includes(converterFrom)) converterFrom=codes.includes("USD")?"USD":codes[0];
    if(!codes.includes(converterTo)||converterTo===converterFrom){
      const preferredTo=codes.includes("UAH")&&converterFrom!=="UAH"?"UAH":null;
      converterTo=preferredTo||codes.find((cc)=>cc!==converterFrom)||converterFrom;
    }
  }

  function formatConverterAmountInput(raw){
    const normalized=(raw||"").replace(/\s+/g,"");
    if(!normalized) return "";
    const match=normalized.match(/^(\d*)([.,]?)(\d*)/);
    if(!match) return "";
    let [,integerPart,separator,decimalPart]=match;
    integerPart=(integerPart||"").replace(/\D/g,"");
    decimalPart=(decimalPart||"").replace(/\D/g,"");
    const groupedInteger=(integerPart||"0").replace(/\B(?=(\d{3})+(?!\d))/g," ");
    return separator ? `${groupedInteger}${separator}${decimalPart}` : groupedInteger;
  }

  function getAmountNumber(){ return Number((amountInput.value||"").replace(/\s+/g,"").replace(",",".")); }

  function updateConverterResult(){
    const amount=getAmountNumber();
    const codes=getConverterCodes();
    if(!codes.length || !Number.isFinite(amount) || amount<0){ resultEl.textContent="Введіть коректну суму"; rateEl.textContent="Курс: —"; return; }
    const rate=getConverterRate(converterFrom,converterTo,ratesByCode);
    if(!Number.isFinite(rate)){ resultEl.textContent="Немає даних для обраної пари"; rateEl.textContent="Курс: —"; return; }
    resultEl.textContent=`${fmtAmount(amount)} ${converterFrom} = ${(amount*rate).toLocaleString("uk-UA",{minimumFractionDigits:2,maximumFractionDigits:2})} ${converterTo}`;
    rateEl.textContent=`Курс: 1 ${converterFrom} = ${fmtRate(rate)} ${converterTo}`;
  }

  function renderConverterOptions(){
    ensureConverterSelections();
    const options=getConverterCodes().map((cc)=>`<option value="${cc}">${cc}</option>`).join("");
    fromSelect.innerHTML=options; toSelect.innerHTML=options;
    fromSelect.value=converterFrom; toSelect.value=converterTo;
  }

  function openConverter(){
    document.querySelectorAll(".item-wrapper.active").forEach((el)=>{ el.classList.remove("active"); el.querySelector('.card')?.setAttribute("aria-expanded","false"); });
    renderConverterOptions(); updateConverterResult();
    headerEl.classList.add("converter-open");
    converterOpenBtn?.setAttribute("aria-expanded","true");
  }

  function closeConverter(){ headerEl.classList.remove("converter-open"); converterOpenBtn?.setAttribute("aria-expanded","false"); }

  function bindEvents(){
    converterOpenBtn?.addEventListener("click",()=> headerEl.classList.contains("converter-open") ? closeConverter() : openConverter());
    amountInput?.addEventListener("input",()=>{
      const caret=amountInput.selectionStart??0;
      const digitsBefore=(amountInput.value.slice(0,caret).match(/\d/g)||[]).length;
      const formatted=formatConverterAmountInput(amountInput.value); amountInput.value=formatted;
      let nextCaret=formatted.length, seen=0;
      for(let i=0;i<formatted.length;i++){ if(/\d/.test(formatted[i])) seen++; if(seen>=digitsBefore){ nextCaret=i+1; break; } }
      amountInput.setSelectionRange(nextCaret,nextCaret);
      updateConverterResult();
    });
    fromSelect?.addEventListener("change",()=>{ converterFrom=fromSelect.value; if(converterFrom===converterTo){ const next=getConverterCodes().find((cc)=>cc!==converterFrom); if(next){ converterTo=next; toSelect.value=next; } } updateConverterResult(); });
    toSelect?.addEventListener("change",()=>{ converterTo=toSelect.value; if(converterTo===converterFrom){ const next=getConverterCodes().find((cc)=>cc!==converterTo); if(next){ converterFrom=next; fromSelect.value=next; } } updateConverterResult(); });
    swapBtn?.addEventListener("click",()=>{ const n=converterTo; converterTo=converterFrom; converterFrom=n; fromSelect.value=converterFrom; toSelect.value=converterTo; updateConverterResult(); });
    document.addEventListener("keydown",(e)=>{ if(e.key==="Escape" && headerEl.classList.contains("converter-open")) closeConverter(); });
  }

  return {
    bindEvents,
    openConverter,
    closeConverter,
    renderConverterOptions,
    updateConverterResult,
    setRates:(nextRates)=>{ ratesByCode=nextRates||{}; },
  };
}
