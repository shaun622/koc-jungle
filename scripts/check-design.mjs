// Run against the local Vite server in design-test mode. All non-local traffic
// is blocked; RPC fixtures are fulfilled here and never reach a database.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';

const base='http://127.0.0.1:4180';
const browser=await chromium.launch({channel:'msedge',headless:true});
const teams=Array.from({length:12},(_,i)=>({id:`pair-${i}`,signupEventId:'fixture-signup',teamName:`Team ${i+1}`,playerOne:`Player ${i*2+1}`,playerTwo:`Player ${i*2+2}`,status:'confirmed',position:i+1,createdAt:'2026-09-01T00:00:00Z'}));
const event={id:'fixture-signup',publicSlug:'event',accountSlug:'test',eventSlug:'event',title:'Silver King of the Court',venue:'Jungle Padel Sanur',startsAt:'2099-09-14T10:00:00Z',endsAt:'2099-09-14T12:00:00Z',timeZone:'Asia/Makassar',organizerName:'Test organiser',capacityTeams:16,details:'Bring your partner or find one here. Fixed pairs compete for Centre Court.',prizes:'Court time, balls and refreshments.',isOpen:true};
await mkdir('screenshots/design',{recursive:true});
const errors=[];const results=[];
try {
 const context=await browser.newContext({serviceWorkers:'block'});
 await context.route('**/*',async route=>{
   const url=new URL(route.request().url());
   if(url.pathname==='/rest/v1/rpc/get_public_signup_v2')return route.fulfill({json:{event,registrations:teams}});
   if(url.pathname.startsWith('/rest/')||url.pathname.startsWith('/auth/'))return route.fulfill({json:[]});
   if(url.origin!==base)return route.abort();
   return route.continue();
 });
 const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
 for(const [name,width,height]of [['desktop',1440,1000],['ipad',820,1180],['phone',390,844],['small-phone',320,740]]){
   await page.setViewportSize({width,height});
   for(const view of ['home','signup']){
     await page.goto(`${base}/scripts/design-check.html?page=${view}`);
     await page.getByRole('heading',{name:view==='home'?'Events':'Silver King of the Court',exact:true}).waitFor();
     const checks=await page.evaluate(()=>{
       const root=document.querySelector('.event-design');
       const small=[...root.querySelectorAll('*')].filter(e=>e.getBoundingClientRect().width&&[...e.childNodes].some(n=>n.nodeType===3&&n.textContent.trim())&&parseFloat(getComputedStyle(e).fontSize)<16).map(e=>({text:e.textContent.slice(0,40),size:getComputedStyle(e).fontSize}));
       return {overflow:root.scrollWidth>root.clientWidth+1,small};
     });
     results.push({name,view,...checks});
     await page.screenshot({path:`screenshots/design/${view}-${name}.png`,fullPage:true});
     if(view==='signup'){
       await page.getByRole('button',{name:'Show all 12 teams'}).click();
       assert.equal(await page.locator('.ed-roster-card .signup-public-team').count(),12);
       await page.getByRole('button',{name:'Sign up solo',exact:true}).click();
       assert.equal(await page.getByRole('textbox',{name:'Player two',exact:true}).count(),0);
       await page.getByRole('button',{name:'Register me',exact:true}).click();
       assert.equal(await page.locator('input[aria-invalid=true]').count(),2);
     }else{
       await page.getByRole('tab',{name:/Drafts/}).click();
       await page.getByRole('heading',{name:'Sunday Club Session'}).waitFor();
       await page.getByRole('button',{name:'Create event',exact:true}).click();
       await page.getByRole('dialog',{name:'Create an event'}).waitFor();
       await page.screenshot({path:`screenshots/design/dialog-${name}.png`});
       await page.keyboard.press('Escape');
       assert.equal(await page.getByRole('dialog').count(),0);
     }
   }
 }
 console.log(JSON.stringify({results,errors},null,2));
 assert.deepEqual(errors,[]);
 assert.ok(results.every(r=>!r.overflow&&r.small.length===0),'Layout overflow or text below 16px');
} finally {await browser.close();}
