import { fmtAmount, fmtRate, getConverterRate, ORDERED_CODES } from "../domain/rates.js";

const CONVERTER_CLOSE_DURATION_MS=210;
const MOBILE_PICKER_READY_CLASS="mobile-picker-ready";

export function createConverterUI({ headerEl, converterOpenBtn, amountInput, fromSelect, toSelect, swapBtn, resultEl, rateEl, onCloseActiveCards, onFocusModeChange }){
  let converterFrom = "USD";
  let converterTo = "UAH";
  let ratesByCode = {};
  let openPickerName = null;
  const mqlMobile = window.matchMedia("(max-width: 560px)");
  const fromTrigger = document.getElementById("converter-from-trigger");
  const toTrigger = document.getElementById("converter-to-trigger");
  const fromMenu = document.getElementById("converter-from-menu");
  const toMenu = document.getElementById("converter-to-menu");
  const pickers = {
    from: { select: fromSelect, trigger: fromTrigger, menu: fromMenu },
    to: { select: toSelect, trigger: toTrigger, menu: toMenu },
  };
  let eventsBound=false;
  let mobilePickerReady=false;

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
    if(integerPart){
      integerPart=integerPart.replace(/^0+(?=\d)/,"");
    }
    if(!integerPart && (separator || decimalPart)) integerPart="0";
    const groupedInteger=(integerPart||"0").replace(/\B(?=(\d{3})+(?!\d))/g," ");
    return separator ? `${groupedInteger}${separator}${decimalPart}` : groupedInteger;
  }

  function getCaretFromDigits(formatted, digitsBefore){
    if(digitsBefore<=0) return 0;
    let seen=0;
    for(let i=0;i<formatted.length;i++){
      if(/\d/.test(formatted[i])) seen++;
      if(seen>=digitsBefore) return i+1;
    }
    return formatted.length;
  }

  function getCaretFromNumericContext(formatted, { digitsBefore, hasSeparatorBeforeCaret, fractionDigitsBeforeCaret }){
    if(!hasSeparatorBeforeCaret) return getCaretFromDigits(formatted, digitsBefore);
    const separatorIndex=formatted.search(/[.,]/);
    if(separatorIndex<0) return getCaretFromDigits(formatted, digitsBefore);
    if(fractionDigitsBeforeCaret<=0) return separatorIndex+1;

    let seenFractionDigits=0;
    for(let i=separatorIndex+1;i<formatted.length;i++){
      if(/\d/.test(formatted[i])) seenFractionDigits++;
      if(seenFractionDigits>=fractionDigitsBeforeCaret) return i+1;
    }
    return formatted.length;
  }

  function restoreInputCaret(input, nextCaret){
    const safeCaret=Math.max(0, Math.min(nextCaret, input.value.length));
    const applyCaret=()=>{
      if(document.activeElement!==input) return;
      input.setSelectionRange(safeCaret, safeCaret);
    };
    applyCaret();
    requestAnimationFrame(applyCaret);
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
    const codes=getConverterCodes();
    const options=codes.map((cc)=>`<option value="${cc}">${cc}</option>`).join("");
    fromSelect.innerHTML=options; toSelect.innerHTML=options;
    fromSelect.value=converterFrom; toSelect.value=converterTo;
    renderPickerOptions("from", codes, converterFrom);
    renderPickerOptions("to", codes, converterTo);
    syncPickerValues();
  }

  function renderPickerOptions(name, codes, selectedValue){
    const picker=pickers[name];
    if(!picker?.menu) return;
    picker.menu.innerHTML=codes
      .map((cc)=>`<li><button class="conv-picker-option${cc===selectedValue?" selected":""}" type="button" data-value="${cc}" role="option" aria-selected="${cc===selectedValue}">${cc}</button></li>`)
      .join("");
  }

  function syncPickerValues(){
    if(fromTrigger) fromTrigger.textContent=converterFrom;
    if(toTrigger) toTrigger.textContent=converterTo;
    markPickerSelection(fromMenu, converterFrom);
    markPickerSelection(toMenu, converterTo);
  }

  function markPickerSelection(menu, value){
    if(!menu) return;
    menu.querySelectorAll(".conv-picker-option").forEach((option)=>{
      const selected=option.dataset.value===value;
      option.classList.toggle("selected", selected);
      option.setAttribute("aria-selected", String(selected));
    });
  }

  function closePicker(name){
    const picker=pickers[name];
    if(!picker?.menu || !picker?.trigger) return;
    picker.menu.hidden=true;
    picker.trigger.setAttribute("aria-expanded", "false");
    if(openPickerName===name) openPickerName=null;
  }

  function closeAllPickers(){ closePicker("from"); closePicker("to"); }

  function openPicker(name){
    if(!mqlMobile.matches) return;
    const picker=pickers[name];
    if(!picker?.menu || !picker?.trigger) return;
    const otherName=name==="from"?"to":"from";
    closePicker(otherName);
    picker.menu.hidden=false;
    picker.trigger.setAttribute("aria-expanded", "true");
    openPickerName=name;
    positionPicker(name);
  }

  function positionPicker(name){
    const picker=pickers[name];
    if(!picker?.menu || !picker?.trigger || picker.menu.hidden) return;
    const triggerRect=picker.trigger.getBoundingClientRect();
    const menu=picker.menu;
    const minGap=8;
    const preferredWidth=Math.max(triggerRect.width, 88);
    menu.style.setProperty("--menu-width", `${preferredWidth}px`);
    const menuHeight=Math.min(menu.scrollHeight, 220);
    const spaceBelow=window.innerHeight-triggerRect.bottom-minGap;
    const spaceAbove=triggerRect.top-minGap;
    const openUp=spaceBelow<Math.min(148, menuHeight) && spaceAbove>spaceBelow;
    const top=openUp
      ? Math.max(minGap, triggerRect.top-menuHeight-6)
      : Math.min(window.innerHeight-menuHeight-minGap, triggerRect.bottom+6);
    const left=Math.min(
      window.innerWidth-preferredWidth-minGap,
      Math.max(minGap, triggerRect.left),
    );
    menu.style.top=`${top}px`;
    menu.style.left=`${left}px`;
  }

  function focusAmountInput(){
    if(!amountInput) return;
    try{
      amountInput.focus({ preventScroll:true });
    }catch{
      amountInput.focus();
    }
    const caretPosition=amountInput.value.length;
    amountInput.setSelectionRange(caretPosition, caretPosition);
  }

  function enableMobilePicker(){
    if(mobilePickerReady || !eventsBound) return;
    if(!fromMenu?.children.length || !toMenu?.children.length) return;
    syncPickerValues();
    document.documentElement.classList.add(MOBILE_PICKER_READY_CLASS);
    mobilePickerReady=true;
  }

  function openConverter(){
    onCloseActiveCards?.();
    renderConverterOptions(); updateConverterResult();
    enableMobilePicker();
    headerEl.classList.add("converter-open");
    converterOpenBtn?.setAttribute("aria-expanded","true");
    onFocusModeChange?.(true);
    focusAmountInput();
  }

  function closeConverter(){
    closeAllPickers();
    if(!headerEl.classList.contains("converter-open")) return;
    const converterPanel=headerEl.querySelector(".header-converter");
    let isFinalized=false;
    const finalizeClose=()=>{
      if(isFinalized) return;
      isFinalized=true;
      onFocusModeChange?.(false);
    };
    const onTransitionEnd=(event)=>{
      if(event.target!==converterPanel || event.propertyName!=="max-height") return;
      finalizeClose();
    };
    headerEl.classList.remove("converter-open");
    converterOpenBtn?.setAttribute("aria-expanded","false");
    if(converterPanel){
      converterPanel.addEventListener("transitionend",onTransitionEnd,{ once:true });
      window.setTimeout(finalizeClose,CONVERTER_CLOSE_DURATION_MS+40);
    }else{
      finalizeClose();
    }
  }

  function bindEvents(){
    converterOpenBtn?.addEventListener("click",()=> headerEl.classList.contains("converter-open") ? closeConverter() : openConverter());
    amountInput?.addEventListener("input",()=>{
      const caret=amountInput.selectionStart??0;
      const rawValue=amountInput.value;
      const valueBeforeCaret=rawValue.slice(0,caret);
      const digitsBefore=(valueBeforeCaret.match(/\d/g)||[]).length;
      const separatorMatch=valueBeforeCaret.match(/[.,]/);
      const hasSeparatorBeforeCaret=Boolean(separatorMatch);
      const fractionDigitsBeforeCaret=hasSeparatorBeforeCaret
        ? (valueBeforeCaret.slice((separatorMatch.index??-1)+1).match(/\d/g)||[]).length
        : 0;
      const formatted=formatConverterAmountInput(rawValue);
      amountInput.value=formatted;
      const nextCaret=getCaretFromNumericContext(formatted, {
        digitsBefore,
        hasSeparatorBeforeCaret,
        fractionDigitsBeforeCaret,
      });
      restoreInputCaret(amountInput, nextCaret);
      updateConverterResult();
    });
    fromSelect?.addEventListener("change",()=>{
      converterFrom=fromSelect.value;
      if(converterFrom===converterTo){
        const next=getConverterCodes().find((cc)=>cc!==converterFrom);
        if(next){ converterTo=next; toSelect.value=next; }
      }
      syncPickerValues();
      updateConverterResult();
    });
    toSelect?.addEventListener("change",()=>{
      converterTo=toSelect.value;
      if(converterTo===converterFrom){
        const next=getConverterCodes().find((cc)=>cc!==converterTo);
        if(next){ converterFrom=next; fromSelect.value=next; }
      }
      syncPickerValues();
      updateConverterResult();
    });
    swapBtn?.addEventListener("click",()=>{
      const n=converterTo;
      converterTo=converterFrom;
      converterFrom=n;
      fromSelect.value=converterFrom;
      toSelect.value=converterTo;
      syncPickerValues();
      updateConverterResult();
    });
    fromTrigger?.addEventListener("click",()=> openPickerName==="from" ? closePicker("from") : openPicker("from"));
    toTrigger?.addEventListener("click",()=> openPickerName==="to" ? closePicker("to") : openPicker("to"));
    [fromMenu,toMenu].forEach((menu,idx)=>{
      menu?.addEventListener("click",(event)=>{
        const option=event.target.closest(".conv-picker-option");
        if(!option) return;
        const targetSelect=idx===0 ? fromSelect : toSelect;
        targetSelect.value=option.dataset.value;
        targetSelect.dispatchEvent(new Event("change", { bubbles:true }));
        closeAllPickers();
      });
    });
    document.addEventListener("click",(event)=>{
      if(!openPickerName) return;
      const activePicker=pickers[openPickerName];
      if(activePicker?.trigger?.contains(event.target) || activePicker?.menu?.contains(event.target)) return;
      closeAllPickers();
    });
    document.addEventListener("keydown",(e)=>{
      if(e.key==="Escape"){
        closeAllPickers();
        if(headerEl.classList.contains("converter-open")) closeConverter();
      }
    });
    window.addEventListener("resize",()=>{
      if(!mqlMobile.matches) closeAllPickers();
      if(openPickerName) positionPicker(openPickerName);
    });
    document.addEventListener("scroll",()=>{ if(openPickerName) positionPicker(openPickerName); }, true);
    eventsBound=true;
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
