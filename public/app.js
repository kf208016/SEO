import { runAudit } from './core/crawl.js';
import { runChecks, botAccess } from './core/checks.js';
import { computeScore } from './core/score.js';
import { renderReport } from './core/report.js';
import { decodeFrame } from './core/frame.js';
import { safeHref } from './core/html.js';

const form = document.querySelector('#audit-form');
const input = document.querySelector('#site-url');
const submit = document.querySelector('#submit-button');
const status = document.querySelector('#form-status');
const progressPanel = document.querySelector('#progress-panel');
const progressText = document.querySelector('#progress-text');
const progressBar = document.querySelector('#progress-bar');
const output = document.querySelector('#report-output');
const actions = document.querySelector('#report-actions');
const privacyContact = document.querySelector('#privacy-contact');

let config = { maxPages: 15, contactUrl: null, lineId: '', turnstileSiteKey: null };
let widgetId = null;
let current = null;
let detail = false;
const mobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);

const ERROR_MESSAGES = Object.freeze({
  invalid_url:'網址格式不正確，或該網址不能由本服務檢查。',rate_limited:'請求太頻繁，請稍後再試。',daily_cap:'今天的免費檢查額度已用完，請改天再試。',host_busy:'這個網站目前有其他檢查正在進行，請稍後再試。',turnstile_failed:'人機驗證失敗，請重新驗證。',service_paused:'健檢服務目前暫停。',service_misconfigured:'健檢服務尚未完成設定。',bad_origin:'請從本站頁面啟動健檢。',internal:'服務暫時發生錯誤，請稍後再試。'
});

function setStatus(message='') { status.textContent = message; }
function apiError(code) { return ERROR_MESSAGES[code] || '無法開始檢查，請稍後再試。'; }
function resetTurnstile() { if (widgetId !== null && window.turnstile) window.turnstile.reset(widgetId); }
function renderCurrent() {
  if (!current) return;
  output.innerHTML = renderReport(current.snapshot,current.findings,current.score,current.bots,{detail,contactUrl:config.contactUrl,lineId:config.lineId,mobile});
  document.querySelector('#toggle-detail').textContent = detail ? '切換簡易報告' : '切換完整報告';
}
function fallbackResult(url,error) {
  return { status:0,finalUrl:url,location:null,chain:[],stop:null,headers:{},error:`proxy_${error}`,bodyLimit:0,skipped:null,truncated:false,accessBlocked:false,truncatedHeaders:false,bytes:null };
}

async function apiFetchTarget(token,url,kind,retry=true) {
  let response;
  try {
    response=await fetch('/api/fetch',{method:'POST',headers:{'content-type':'application/json','authorization':`Bearer ${token}`},body:JSON.stringify({u:url,k:kind})});
  } catch { return fallbackResult(url,'network'); }
  if (response.ok) {
    try {
      const decoded=decodeFrame(await response.arrayBuffer());
      return {...decoded.meta,bytes:decoded.meta.skipped||decoded.meta.error?null:decoded.bytes};
    } catch { return fallbackResult(url,'bad_response'); }
  }
  let error='http_'+response.status;
  try { error=(await response.json()).error || error; } catch {}
  if (response.status===429 && error==='too_fast' && retry) {
    await new Promise(resolve=>setTimeout(resolve,300));
    return apiFetchTarget(token,url,kind,false);
  }
  return fallbackResult(url,error);
}

async function waitForTurnstile(timeout=10000) {
  const started=Date.now();
  while (!window.turnstile && Date.now()-started<timeout) await new Promise(resolve=>setTimeout(resolve,50));
  return window.turnstile || null;
}
async function initialize() {
  try {
    const response=await fetch('/api/config',{headers:{accept:'application/json'}});
    if (response.ok) config={...config,...await response.json()};
  } catch { setStatus('無法讀取服務設定，請重新整理頁面。'); }
  const contact=safeHref(config.contactUrl);
  if (contact?.startsWith('https:')) {
    const a=document.createElement('a'); a.href=contact;a.target='_blank';a.rel='noopener noreferrer nofollow';a.textContent='LINE 官方帳號';privacyContact.replaceChildren(a);
  }
  if (config.turnstileSiteKey) {
    const turnstile=await waitForTurnstile();
    if (turnstile) widgetId=turnstile.render('#turnstile',{sitekey:config.turnstileSiteKey,action:'audit_start'});
    else setStatus('人機驗證元件載入失敗，請重新整理頁面。');
  }
}

form.addEventListener('submit',async event=>{
  event.preventDefault();
  if (submit.disabled) return;
  const turnstileToken=widgetId!==null&&window.turnstile?window.turnstile.getResponse(widgetId):'';
  if (!input.value.trim()) { setStatus('請輸入網站網址。');input.focus();return; }
  if (config.turnstileSiteKey&&!turnstileToken) { setStatus('請先完成人機驗證。');return; }
  submit.disabled=true;setStatus('');output.replaceChildren();actions.hidden=true;progressPanel.hidden=false;progressText.textContent='正在確認網址與使用額度…';progressBar.value=0;
  try {
    const startResponse=await fetch('/api/start',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({url:input.value.trim(),turnstileToken})});
    const started=await startResponse.json().catch(()=>({error:'bad_response'}));
    if (!startResponse.ok) throw new Error(started.error||'bad_response');
    let pageRequests=0;
    const snapshot=await runAudit(started.url,{maxPages:started.maxPages||config.maxPages||15,fetchFn:(url,kind)=>apiFetchTarget(started.token,url,kind),parseHtml:(text)=>new DOMParser().parseFromString(text,'text/html'),onProgress:update=>{if(update?.kind==='page')pageRequests+=1;progressBar.value=Math.min(15,pageRequests);progressText.textContent=`正在讀取與分析公開頁面（${Math.min(pageRequests,started.maxPages||15)}／${started.maxPages||15}）…`;}});
    const findings=runChecks(snapshot);const score=computeScore(findings,snapshot.coverage);const bots=botAccess(snapshot);
    current={snapshot,findings,score,bots};detail=false;renderCurrent();actions.hidden=false;progressPanel.hidden=true;output.scrollIntoView({behavior:'smooth',block:'start'});
  } catch (error) {
    setStatus(apiError(error.message));progressPanel.hidden=true;resetTurnstile();
  } finally { submit.disabled=false; }
});

document.querySelector('#toggle-detail').addEventListener('click',()=>{detail=!detail;renderCurrent();});
document.querySelector('#print-report').addEventListener('click',()=>window.print());
document.querySelector('#restart').addEventListener('click',()=>{current=null;output.replaceChildren();actions.hidden=true;progressPanel.hidden=true;form.scrollIntoView({behavior:'smooth'});resetTurnstile();input.focus();});
document.querySelector('#download-json').addEventListener('click',()=>{
  if (!current) return;
  const blob=new Blob([JSON.stringify({snapshot:current.snapshot,findings:current.findings,score:current.score,bots:current.bots},null,2)],{type:'application/json'});
  const href=URL.createObjectURL(blob);const a=document.createElement('a');const date=new Date();const stamp=`${date.getFullYear()}${String(date.getMonth()+1).padStart(2,'0')}${String(date.getDate()).padStart(2,'0')}-${String(date.getHours()).padStart(2,'0')}${String(date.getMinutes()).padStart(2,'0')}`;a.href=href;a.download=`seo-check_${String(current.snapshot.siteHost||'site').replace(/[^a-z0-9.-]/gi,'_')}_${stamp}.json`;a.click();URL.revokeObjectURL(href);
});

output.addEventListener('click',async event=>{
  const button=event.target?.closest?.('[data-copy="summary"]');
  if (!button || !output.contains(button)) return;
  const summary=output.querySelector('.line-summary')?.textContent;
  if (summary===undefined) return;
  const original=button.textContent;
  try {
    if (!navigator.clipboard?.writeText) throw new Error('clipboard_unavailable');
    await navigator.clipboard.writeText(summary);
    button.textContent='已複製';
    setTimeout(()=>{if(button.isConnected)button.textContent=original;},2000);
  } catch {
    button.textContent='無法複製，請手動選取文字';
  }
});

initialize();
