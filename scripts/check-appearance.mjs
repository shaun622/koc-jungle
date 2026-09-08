// Fresh browser context; only localhost is allowed. Never connects to a live backend.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
const base='http://127.0.0.1:4181';
const browser=await chromium.launch({channel:'msedge',headless:true});
await mkdir('screenshots/appearance',{recursive:true});
const errors=[];const results=[];
try{
 const context=await browser.newContext({serviceWorkers:'block'});
 await context.route('**/*',route=>{
   const url=new URL(route.request().url());
   if(url.origin!==base)return route.abort();
   if(url.pathname.startsWith('/rest/')||url.pathname.startsWith('/auth/'))return route.fulfill({json:[]});
   return route.continue();
 });
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
 for(const [device,width,height]of [['desktop',1440,1000],['ipad',1180,820],['portrait-ipad',820,1180],['phone',390,844],['small-phone',320,740],['tv',1920,1080]]){
  await page.setViewportSize({width,height});
  for(const screen of ['home','setup','display','between','complete','leaderboard','qualifier','seeding','help']){
   for(const theme of ['light','dark']){
    await page.goto(`${base}/scripts/design-check.html?page=${screen}&theme=${theme}`);
    await page.locator('#root > *').first().waitFor();
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    await page.evaluate(()=>document.getAnimations().forEach(animation=>{if(Number.isFinite(animation.effect?.getComputedTiming().endTime))animation.finish();}));
    const result=await page.evaluate(()=>{
     const visible=e=>e.getBoundingClientRect().width>0&&e.getBoundingClientRect().height>0;
     const small=[...document.querySelectorAll('body *')].filter(e=>visible(e)&&!e.closest('.display-canvas,.avatar,.avatar-pair')&&[...e.childNodes].some(n=>n.nodeType===3&&n.textContent.trim())&&parseFloat(getComputedStyle(e).fontSize)<15.9).map(e=>({selector:e.className,text:e.textContent.slice(0,35),px:getComputedStyle(e).fontSize}));
     return {overflow:document.documentElement.scrollWidth>innerWidth+1,small};
    });
    results.push({device,screen,theme,...result});
    if(device==='portrait-ipad'&&screen==='display')assert.equal(await page.locator('.mobile-court').count(),3,'Portrait tablets use readable court cards');
    if(screen==='complete'&&width>=1180)assert(await page.locator('.display-canvas .tv-complete').evaluate(canvas=>[...canvas.querySelectorAll('.tv-podium-block,.nightly-stat')].every(card=>card.getBoundingClientRect().bottom<=canvas.getBoundingClientRect().bottom+1)),'Podium and awards must fit above the toolbar');
    await page.screenshot({path:`screenshots/appearance/${device}-${screen}-${theme}.png`,fullPage:true});
   }
  }
 }
 for(const width of [1180,1920]){
  await page.setViewportSize({width,height:1080});
  await page.goto(`${base}/scripts/design-check.html?page=display&teams=16&theme=dark`);
  await page.locator('.tv-standings').waitFor();
  const courts=await page.evaluate(()=>[...document.querySelectorAll('.tv-court')].map(card=>{
   const bounds=card.getBoundingClientRect();
   return {clipped:[...card.querySelectorAll('.tv-court-row')].some(row=>row.getBoundingClientRect().bottom>bounds.bottom+1)};
  }));
  assert(!courts.some(c=>c.clipped),'Court score rows must not be clipped inside cards');
  if(width===1920)assert(await page.locator('.tv-courts-col').evaluateAll(cols=>cols.every(col=>col.scrollHeight<=col.clientHeight+1)),'Eight courts should fit on a full-HD TV');
  const found=new Set();
  for(let i=0;i<16;i++){
   (await page.locator('.tv-standings .tv-lb-name-col>span:first-child').allTextContents()).forEach(name=>found.add(name));
   const next=page.getByRole('button',{name:'Next standings page'});
   if(await next.count())await next.click();else break;
  }
  assert.equal(found.size,16,'Every team must be reachable');
  await page.screenshot({path:`screenshots/appearance/large-${width}.png`,fullPage:true});
 }
 await page.setViewportSize({width:1180,height:820});
 await page.goto(`${base}/scripts/design-check.html?page=display&theme=light`);
 await page.locator('.tv-centre-score').first().waitFor();
 const before=await page.evaluate(async()=>JSON.stringify((await import('/src/store/eventStore.ts')).useEventStore.getState().event));
 await page.getByRole('button',{name:'Dark',exact:true}).click();
 const after=await page.evaluate(async()=>JSON.stringify((await import('/src/store/eventStore.ts')).useEventStore.getState().event));
 assert.equal(after,before,'Theme changes must not change event data');
 const score=page.locator('.tv-centre-score').first();const original=Number(await score.textContent());
 await page.locator('.tv-centre-score-group').first().getByRole('button').last().click();
 assert.equal(Number(await score.textContent()),original+1,'Existing score controls remain functional');
 await page.getByRole('button',{name:/resume/i,exact:false}).last().click();
 await page.getByRole('button',{name:/pause/i,exact:false}).last().waitFor();
 await page.goto(`${base}/scripts/design-check.html?page=help`);
 assert.equal(await page.locator('html').getAttribute('data-theme'),'dark','Theme persists across screens');
 const smallText=[...new Map(results.flatMap(r=>r.small).map(s=>[s.selector+':'+s.px,s])).values()];
 console.log(JSON.stringify({errors,overflow:results.filter(r=>r.overflow),smallText,screensChecked:results.length},null,2));
 assert.deepEqual(errors,[]);
 assert(!results.some(r=>r.overflow),'Horizontal overflow');
 assert.deepEqual(smallText,[],'Labels must be at least 16px');
}finally{await browser.close();}
