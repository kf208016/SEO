import test from 'node:test';
import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';
import { computeScore } from '../public/core/score.js';
import { escapeHtml, html, raw, safeHref } from '../public/core/html.js';
import { analyzable, botAccess, headerDirectives, isIndexable, isNoindex, runChecks } from '../public/core/checks.js';
import { renderReport } from '../public/core/report.js';
import { parseRobots } from '../public/core/robots.js';

const finding = severity => ({ id:`X${severity}`,severity,scored:severity!=='INFO' });
const coverage = (status='complete', defects=false, reasons=[]) => ({status,defects,reasons});

test('K01 完整且無問題時為 100 分 green valid',()=>{
  assert.deepEqual(computeScore([],coverage()),{score:100,raw:100,grade:'green',capped:false,scoreStatus:'valid',counts:{P0:0,P1:0,P2:0,P3:0,INFO:0}});
});
test('K02 一個 P0 扣至 raw 70 並封頂 40',()=>{
  assert.deepEqual(computeScore([finding('P0')],coverage()),{score:40,raw:70,grade:'red',capped:true,scoreStatus:'valid',counts:{P0:1,P1:0,P2:0,P3:0,INFO:0}});
});
test('K03 兩個 P0 的 raw 與 score 都是 40',()=>{
  const r=computeScore([finding('P0'),finding('P0')],coverage());assert.equal(r.raw,40);assert.equal(r.score,40);assert.equal(r.capped,false);assert.equal(r.grade,'red');
});
test('K04 多個 P1 P2 P3 扣分至 raw 63 且為 yellow',()=>{
  const r=computeScore([finding('P1'),finding('P1'),finding('P1'),finding('P2'),finding('P3'),finding('P3'),finding('P3')],coverage());assert.equal(r.raw,63);assert.equal(r.score,63);assert.equal(r.grade,'yellow');
});
test('K05 一個 P1 封頂 79',()=>{
  const r=computeScore([finding('P1')],coverage());assert.equal(r.raw,90);assert.equal(r.score,79);assert.equal(r.capped,true);assert.equal(r.grade,'yellow');
});
test('K06 INFO 不扣分',()=>{
  const r=computeScore([finding('INFO')],coverage());assert.equal(r.score,100);assert.equal(r.grade,'green');assert.equal(r.counts.INFO,1);
});
test('K07 coverage failed 時無法評分',()=>{
  const r=computeScore([],coverage('failed',true,['home_unavailable']));assert.equal(r.score,null);assert.equal(r.grade,'gray');assert.equal(r.scoreStatus,'unavailable');
});
test('K08 只有取樣原因的 partial 可維持 green',()=>{
  const r=computeScore([],coverage('partial',false,['page_limit']));assert.equal(r.score,100);assert.equal(r.grade,'green');assert.equal(r.scoreStatus,'sample_only');
});
test('K09 有缺陷的 partial 至少為 yellow',()=>{
  const r=computeScore([],coverage('partial',true,['fetch_errors']));assert.equal(r.score,100);assert.equal(r.grade,'yellow');assert.equal(r.scoreStatus,'sample_only');
});

function page(overrides={}) {
  return {url:'https://a.com/',finalUrl:'https://a.com/',status:200,chain:[],stop:null,headers:{},error:null,accessBlocked:false,truncated:false,truncatedHeaders:false,isHtml:true,duplicateOf:null,depth:0,page:{title:'正常標題',titleCount:1,metaDescription:'正常摘要',metaRobots:[],metaBingbot:[],canonicals:['https://a.com/'],canonicalTagCount:1,h1:'標題',lang:'zh-Hant',hasViewport:true,og:{title:'正常標題',description:'正常摘要',image:'https://a.com/a.jpg',url:'https://a.com/'},jsonld:[{ok:true,types:['Organization'],error:null}],links:[],images:[],insecureResources:[],textLength:500,textHash:'x',scriptCount:0,scriptSrcCount:0,hasSpaRoot:false,spaRootTextLength:null,dataNosnippetCount:0,metaRefresh:null,limitsHit:[]},...overrides};
}
function snapshot(overrides={}) {
  const home=page();return {version:'1.4.0',startUrl:'https://a.com/',siteHost:'a.com',origin:'https://a.com',home:'https://a.com/',scannedAt:'2026-10-17T12:00:00+08:00',robots:{url:'https://a.com/robots.txt',origin:'https://a.com',status:200,policy:'parse',ourPolicy:{policy:'allow_all',rulesCount:0},error:null,accessBlocked:false,truncated:false,stop:null,chain:[],headers:{},skipped:null,text:'User-agent: *\nAllow: /',parsed:parseRobots('User-agent: *\nAllow: /')},robotsInitial:null,sitemaps:[],sitemapUrls:[],pages:[home],discovered:{'https://a.com/':{inlinks:[],fromSitemap:false,crawled:true}},probes:{soft404:{url:'https://a.com/random',status:404,location:null,error:null,accessBlocked:false},http:{url:'http://a.com/',status:301,location:'https://a.com/',error:null,accessBlocked:false}},homeAnalyzable:true,homeSkippedByRobots:false,stoppedOffsite:false,coverage:coverage(),limits:{maxPages:15,crawled:1,requests:1,skippedByRobots:0,notCrawled:0,timedOut:false},...overrides};
}

test('S12 報告將惡意動態值當文字且不產生可執行標記',()=>{
  const s=snapshot();s.pages[0].page.title='<img src=x onerror=alert(1)>';s.startUrl='https://a.com/\"><script>alert(1)</script>';s.pages[0].page.canonicals=[];s.pages[0].page.canonicalTagCount=1;
  const findings=runChecks(s);findings.push({id:'Z01',code:'x',section:'content',severity:'P2',evidence:'verified',title:'<img src=x onerror=alert(1)>',summary:'\"><script>alert(1)</script>',why:'',fix:'',urls:['javascript:alert(1)'],count:1,data:{},sources:[],scored:true});
  const score=computeScore(findings,s.coverage);const output=renderReport(s,findings,score,botAccess(s),{detail:true,contactUrl:'javascript:alert(1)'});const {document}=parseHTML(`<!doctype html><html><body>${output}</body></html>`);
  assert.equal(document.querySelectorAll('script,style').length,0);assert.equal(document.querySelectorAll('[onerror],[onclick],[onload],[style]').length,0);assert.equal([...document.querySelectorAll('[href]')].some(a=>/^javascript:/i.test(a.getAttribute('href'))),false);assert.match(document.body.textContent,/<img src=x onerror=alert\(1\)>/);assert.doesNotMatch(output,/<script/i);
});

test('C01 checks 僅對可分析且可收錄頁面回報缺 title',()=>{
  const s=snapshot();s.pages[0].page.title=null;const ids=runChecks(s).map(f=>f.id);assert.ok(ids.includes('C01'));
  s.pages[0].error='network';s.homeAnalyzable=false;s.coverage=coverage('failed',true,['home_not_analyzable']);assert.ok(!runChecks(s).some(f=>f.id==='C01'));
});
test('T04 checks 辨識 meta 與 X-Robots-Tag noindex',()=>{
  const p=page();p.headers['x-robots-tag']='otherbot: noindex, googlebot: noindex, nofollow';assert.deepEqual(headerDirectives(p.headers['x-robots-tag'],'googlebot'),['noindex','nofollow']);assert.equal(isNoindex(p),true);assert.equal(isIndexable(p),false);
  const s=snapshot({pages:[p]});assert.ok(runChecks(s).some(f=>f.id==='T04'));
});
test('T35 truncatedHeaders 僅由標頭得出時標示 inferred，meta 可獨立證明時仍為 verified',()=>{
  const p=page();p.headers['x-robots-tag']='googlebot: nofollow';p.truncatedHeaders=true;let s=snapshot({pages:[p]});assert.equal(runChecks(s).find(f=>f.id==='T35').evidence,'inferred');
  p.page.metaRobots=['nofollow'];s=snapshot({pages:[p]});assert.equal(runChecks(s).find(f=>f.id==='T35').evidence,'verified');
});
test('G05 G10 truncatedHeaders 僅由標頭得出時標示 inferred',()=>{
  const p=page();p.headers['x-robots-tag']='googlebot: nosnippet, bingbot: noarchive';p.truncatedHeaders=true;const findings=runChecks(snapshot({pages:[p]}));assert.equal(findings.find(f=>f.id==='G05').evidence,'inferred');assert.equal(findings.find(f=>f.id==='G10').evidence,'inferred');
});
test('G01 botAccess 依 robots.txt 宣告判斷 AI 搜尋爬蟲',()=>{
  const text='User-agent: OAI-SearchBot\nDisallow: /\nUser-agent: *\nAllow: /';const s=snapshot();s.robots.text=text;s.robots.parsed=parseRobots(text);const rows=botAccess(s);assert.equal(rows.find(r=>r.token==='OAI-SearchBot').status,'declared_disallowed');assert.ok(runChecks(s).some(f=>f.id==='G01'));
});
test('H01 html 工具跳脫插值、只允許安全網址',()=>{
  assert.equal(escapeHtml(`<>&"'`),'&lt;&gt;&amp;&quot;&#39;');assert.equal(html`<p>${'<b>x</b>'}</p>`,'<p>&lt;b&gt;x&lt;/b&gt;</p>');assert.equal(html`<p>${raw('<b>x</b>')}</p>`,'<p><b>x</b></p>');assert.equal(safeHref('javascript:alert(1)'),null);assert.equal(safeHref('https://u:p@a.com/'),null);assert.equal(safeHref('https://a.com/x'),'https://a.com/x');
});
