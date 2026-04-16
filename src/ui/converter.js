import { fmtAmount, fmtRate, getConverterRate, ORDERED_CODES } from "../domain/rates.js";

export function createConverterUI({ headerEl, converterOpenBtn, amountInput, fromSelect, toSelect, swapBtn, resultEl, rateEl }){
  const customDropdownState = new Map();
  const shouldUseCustomConverterDropdown = window.matchMedia("(pointer:coarse)").matches;
  let activeCustomListbox = null;
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

  function closeActiveCustomListbox(){
    if(!activeCustomListbox) return;
    const state=customDropdownState.get(activeCustomListbox);
    if(!state) return;
    state.listbox.hidden=true;
    state.button.setAttribute("aria-expanded","false");
    activeCustomListbox=null;
  }

  function ensureCustom(selectEl){
    if(!shouldUseCustomConverterDropdown || !selectEl || customDropdownState.has(selectEl)) return;
    const listboxId=`${selectEl.id}-listbox`;
    const btn=document.createElement("button");
    btn.type="button"; btn.className="conv-listbox-btn";
    btn.setAttribute("aria-expanded","false"); btn.setAttribute("aria-controls",listboxId); btn.setAttribute("aria-haspopup","listbox");
    const listbox=document.createElement("ul");
    listbox.className="conv-listbox"; listbox.id=listboxId; listbox.setAttribute("role","listbox"); listbox.hidden=true;
    const wrap=document.createElement("div"); wrap.className="conv-listbox-wrap"; wrap.append(btn);
    selectEl.insertAdjacentElement("afterend",wrap);
    let portal=document.getElementById("conv-listbox-portal");
    if(!portal){ portal=document.createElement("div"), portal.id="conv-listbox-portal", portal.className="conv-listbox-portal", document.body.append(portal); }
    portal.append(listbox);
    selectEl.classList.add("conv-select-native-hidden");

    btn.addEventListener("click",()=>{
      const isOpen=btn.getAttribute("aria-expanded")==="true";
      closeActiveCustomListbox();
      listbox.hidden=isOpen; btn.setAttribute("aria-expanded",String(!isOpen));
      if(!isOpen) activeCustomListbox=selectEl;
    });

    customDropdownState.set(selectEl,{button:btn,listbox});
  }

  function rebuildCustom(selectEl){
    const state=customDropdownState.get(selectEl);
    if(!state) return;
    state.listbox.innerHTML="";
    [...selectEl.options].forEach((opt)=>{
      const li=document.createElement("li");
      const optBtn=document.createElement("button");
      optBtn.type="button"; optBtn.className="conv-listbox-option";
      optBtn.setAttribute("role","option"); optBtn.dataset.value=opt.value;
      optBtn.setAttribute("aria-selected",String(opt.value===selectEl.value));
      optBtn.textContent=opt.textContent||opt.value;
      optBtn.addEventListener("click",()=>{ selectEl.value=opt.value; selectEl.dispatchEvent(new Event("change",{bubbles:true})); closeActiveCustomListbox(); });
      li.append(optBtn); state.listbox.append(li);
    });
    state.button.textContent=selectEl.value||"—";
  }

  function setupCustom(){ [fromSelect,toSelect].forEach((s)=>{ ensureCustom(s); rebuildCustom(s); }); }

  function renderConverterOptions(){
    ensureConverterSelections();
    const options=getConverterCodes().map((cc)=>`<option value="${cc}">${cc}</option>`).join("");
    fromSelect.innerHTML=options; toSelect.innerHTML=options;
    fromSelect.value=converterFrom; toSelect.value=converterTo;
    setupCustom();
  }

  function openConverter(){
    document.querySelectorAll(".item-wrapper.active").forEach((el)=>{ el.classList.remove("active"); el.querySelector('.card')?.setAttribute("aria-expanded","false"); });
    renderConverterOptions(); updateConverterResult();
    headerEl.classList.add("converter-open");
    converterOpenBtn?.setAttribute("aria-expanded","true");
  }

  function closeConverter(){ closeActiveCustomListbox(); headerEl.classList.remove("converter-open"); converterOpenBtn?.setAttribute("aria-expanded","false"); }

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
    fromSelect?.addEventListener("change",()=>{ converterFrom=fromSelect.value; if(converterFrom===converterTo){ const next=getConverterCodes().find((cc)=>cc!==converterFrom); if(next){ converterTo=next; toSelect.value=next; } } setupCustom(); updateConverterResult(); });
    toSelect?.addEventListener("change",()=>{ converterTo=toSelect.value; if(converterTo===converterFrom){ const next=getConverterCodes().find((cc)=>cc!==converterTo); if(next){ converterFrom=next; fromSelect.value=next; } } setupCustom(); updateConverterResult(); });
    swapBtn?.addEventListener("click",()=>{ const n=converterTo; converterTo=converterFrom; converterFrom=n; fromSelect.value=converterFrom; toSelect.value=converterTo; setupCustom(); updateConverterResult(); });
    document.addEventListener("keydown",(e)=>{ if(e.key==="Escape"){ closeActiveCustomListbox(); if(headerEl.classList.contains("converter-open")) closeConverter(); } });
    document.addEventListener("click",(e)=>{
      const path=e.composedPath?.()||[];
      const inside=path.some((node)=>node?.classList && (node.classList.contains("conv-listbox-wrap")||node.classList.contains("conv-listbox")||node.classList.contains("conv-listbox-option")));
      if(!inside) closeActiveCustomListbox();
    });
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
