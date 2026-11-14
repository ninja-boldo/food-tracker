const http=require('http'),fs=require('fs'),path=require('path'),crypto=require('crypto');
const DIR=process.env.DATA_DIR||'./data',F=path.join(DIR,'db.json');
fs.mkdirSync(DIR,{recursive:true});
let db={entries:[],settings:{}};
try{db=JSON.parse(fs.readFileSync(F,'utf8'))}catch{}
db.entries??=[];if(db.weights&&!db.weighIns)db.weighIns=db.weights.map(w=>({id:crypto.randomUUID(),t:w.date+'T12:00:00',kg:w.kg,src:'manual',ok:true}));delete db.weights;db.weighIns??=[];db.workouts??=[];db.activity??={};db.inbox??=[];db.chats??=[];db.health??={};if(db.health.state==='processing')db.health={state:'error',error:'Import was interrupted'};db.jobs??=[];for(const j of db.jobs)if(j.status==='running')j.status='queued';db.settings??={};
db.settings.goals??={kcal:2200,protein:140,carbs:250,fat:70};
const localIso=d=>{d=d||new Date();const p=n=>String(n).padStart(2,'0');return d.getFullYear()+'-'+p(d.getMonth()+1)+'-'+p(d.getDate())+'T'+p(d.getHours())+':'+p(d.getMinutes())+':00'};
const save=()=>{fs.writeFileSync(F+'.tmp',JSON.stringify(db));fs.renameSync(F+'.tmp',F)};
const cfg=()=>({base:db.settings.baseUrl||process.env.OPENAI_BASE_URL||'https://opencode.ai/inference/go/openai/v1',key:db.settings.apiKey||process.env.OPENAI_API_KEY||'',model:db.settings.model||process.env.MODEL||'deepseek-v4.1-flash'});
const hdrs=c=>{const h={'Content-Type':'application/json',Authorization:'Bearer '+c.key};
  if(/opencode\.ai/i.test(c.base)){if(!db.settings.sessionId){db.settings.sessionId=crypto.randomUUID();save()}h['x-opencode-session']=db.settings.sessionId}
  return h};
const pub=()=>{const c=cfg();return{goals:db.settings.goals,profile:db.settings.profile||{},nudge:NS(),eatback:db.settings.eatback??50,baseUrl:c.base,model:c.model,hasKey:!!c.key}};
const PROMPT='You are a nutrition analyst. Identify every food and drink in the photo or description, estimate portion weight and nutrition for the visible amount. Reply with ONLY JSON, no markdown: {"name":"short meal name","items":[{"name":"food","grams":number,"kcal":number,"protein":number,"carbs":number,"fat":number,"fiber":number,"tags":[]}]}. Macros and fiber are in grams. Tags may only use: vegetables, fruit, whole_grain, legumes, fish, nuts, processed, sugary, fried. If the user adds a note, treat it as ground truth.';
async function analyze(image,note,prev){
  const c=cfg();
  const r=await fetch(c.base.replace(/\/+$/,'')+'/chat/completions',{method:'POST',signal:AbortSignal.timeout(240000),headers:hdrs(c),
    body:JSON.stringify({model:c.model,temperature:0.2,messages:[{role:'system',content:PROMPT},{role:'user',content:[{type:'text',text:prev?('Previous estimate: '+JSON.stringify(prev)+'. The user commented: "'+note+'". Update only what the comment warrants and return the same JSON shape.'):(note||'Analyze this meal.')},...(image?[{type:'image_url',image_url:{url:image}}]:[])]}]})});
  const j=await r.json().catch(()=>({}));
  if(!r.ok)throw new Error(j.error?.message||'Model request failed ('+r.status+')');
  const t=(j.choices?.[0]?.message?.content||'').replace(/```json|```/g,'').trim();
  const o=JSON.parse(t.slice(t.indexOf('{'),t.lastIndexOf('}')+1));
  o.items=(o.items||[]).map(i=>({name:String(i.name||'Food'),grams:+i.grams||0,kcal:+i.kcal||0,protein:+i.protein||0,carbs:+i.carbs||0,fat:+i.fat||0,fiber:+i.fiber||0,tags:Array.isArray(i.tags)?i.tags.map(String):[]}));
  return o;
}

async function llm(sys,user){const c=cfg();const r=await fetch(c.base.replace(/\/+$/,'')+'/chat/completions',{method:'POST',signal:AbortSignal.timeout(240000),headers:hdrs(c),body:JSON.stringify({model:c.model,temperature:0.5,messages:[{role:'system',content:sys},{role:'user',content:user}]})});const j=await r.json().catch(()=>({}));if(!r.ok)throw new Error(j.error?.message||'Model request failed ('+r.status+')');const t=(j.choices?.[0]?.message?.content||'').replace(/```json|```/g,'').trim();return JSON.parse(t.slice(t.indexOf('{'),t.lastIndexOf('}')+1))}
const SH={recipes:'{"meals":[{"name":"","why":"one sentence","kcal":0,"protein":0,"carbs":0,"fat":0,"minutes":0,"ingredients":["amount + item"],"steps":["short step"]}]}',plan:'{"days":[{"day":"Day 1","meals":[{"slot":"Breakfast","name":"","kcal":0,"protein":0,"carbs":0,"fat":0,"ingredients":["amount + item"]}]}],"shopping":["item"]}',advice:'{"tips":["specific tip referencing the data"]}',nutrients:'{"wins":["short"],"gaps":[{"nutrient":"","why":"","foods":["food"]}]}'};
function digest(){const by={};db.entries.forEach(e=>{const k=localIso(new Date(e.ts)).slice(0,10);const o=by[k]??={kcal:0,protein:0,carbs:0,fat:0,fiber:0,foods:[]};e.items.forEach(i=>{o.kcal+=i.kcal;o.protein+=i.protein;o.carbs+=i.carbs;o.fat+=i.fat;o.fiber+=i.fiber||0;o.foods.push(i.name)})});return{days:Object.keys(by).sort().slice(-14).map(k=>({date:k,kcal:Math.round(by[k].kcal),protein:Math.round(by[k].protein),carbs:Math.round(by[k].carbs),fat:Math.round(by[k].fat),fiber:Math.round(by[k].fiber),foods:[...new Set(by[k].foods)].slice(0,12)})),weights:daily().slice(-10).map(d=>({date:d.date,kg:d.kg,trend:d.trend})),kitchen:{fridge:kit().fridge,avoidNow:kitchenNow().avoid.map(x=>x.item)},workouts:db.workouts.slice(-12),activity:Object.entries(db.activity).sort().slice(-7)}}
async function coach(b){const p=db.settings.profile;if(!p||!p.weight)throw new Error('Save your profile first');
 const n={recipes:'Suggest 3 different, realistic recipes that fit the remaining macros for today.',plan:'Create a 7-day meal plan (3 meals and 1 snack per day) that hits the daily targets within about 5 percent. Reuse ingredients across days and add a shopping list.',advice:'Review the recent intake and training against the targets and give 4 to 5 concrete, specific tips. Be honest about gaps.',nutrients:'Look at the foods of the last 14 days. Name likely gaps in fiber, vitamins and minerals (for example vitamin D, C, B12, iron, calcium, magnesium, omega-3, potassium) with practical food fixes that still fit the weight-loss calories. Keep it brief.'}[b.mode];
 if(!n)throw new Error('Unknown mode');
 return llm('You are a practical, evidence-based nutrition coach. Losing weight is the priority; healthier eating (fiber, vitamins, minerals) is a secondary side quest. Consider recent workouts and activity. Respect diet and dislikes strictly, never suggest anything in recent.kitchen.avoidNow and prefer recent.kitchen.fridge ingredients. Use normal supermarket ingredients and realistic portions. Respond in '+(p.lang||'English')+'. Reply with ONLY JSON in exactly this shape: '+SH[b.mode],JSON.stringify({task:n,profile:p,dailyTargets:db.settings.goals,eatBackPercentOfWorkoutCalories:db.settings.eatback??50,remainingToday:b.remaining,recent:digest()}))}
let active=0;
async function run(j){try{if(j.kind==='reeval'){const e=db.entries.find(x=>x.id===j.entryId);if(!e)throw new Error('Meal not found');const o=await analyze(e.thumb||'',j.comment,{name:e.name,items:e.items});e.name=o.name||e.name;e.items=o.items;e.comment=j.comment;e.est=true;db.jobs=db.jobs.filter(x=>x!==j);save();return}const o=await analyze(j.image,j.note);db.entries.push({id:crypto.randomUUID(),ts:j.ts,name:o.name||'Meal',items:o.items,thumb:j.thumb,est:true});db.jobs=db.jobs.filter(x=>x!==j)}catch(e){j.status='failed';j.error=e.message}save()}
function pump(){while(active<3){const j=db.jobs.find(x=>x.status==='queued');if(!j)return;j.status='running';active++;save();run(j).finally(()=>{active--;pump()})}}

function todayState(){const today=localIso().slice(0,10),t0=new Date(today+'T00:00:00').getTime(),es=db.entries.filter(e=>e.ts>=t0),tt={kcal:0,protein:0,carbs:0,fat:0};es.forEach(e=>e.items.forEach(i=>{for(const k in tt)tt[k]+=i[k]||0}));const wo=db.workouts.filter(w=>w.t.slice(0,10)===today),bo=Math.round(wo.reduce((a,w)=>a+(w.kcal||0),0)*((db.settings.eatback??50)/100)),g=db.settings.goals;
 return{time:new Date().toTimeString().slice(0,5),mealsToday:es.map(e=>e.name),eaten:Object.fromEntries(Object.entries(tt).map(([k,v])=>[k,Math.round(v)])),dailyTarget:{...g,kcal:g.kcal+bo},trainingBonusKcal:bo,workoutsToday:wo.map(w=>({type:w.type,min:w.min,kcal:w.kcal}))}}
async function chatText(messages){const c=cfg(),r=await fetch(c.base.replace(/\/+$/,'')+'/chat/completions',{method:'POST',signal:AbortSignal.timeout(240000),headers:hdrs(c),body:JSON.stringify({model:c.model,temperature:0.6,messages})}),j=await r.json().catch(()=>({}));if(!r.ok)throw new Error(j.error?.message||'Model request failed ('+r.status+')');return String(j.choices?.[0]?.message?.content||'').trim()}
const kit=()=>db.settings.kitchen??={fridge:'',fridgeAt:0,avoid:[]};
function addAvoid(item,days){item=String(item||'').trim().toLowerCase().slice(0,60);if(!item)return;const K=kit();K.avoid=K.avoid.filter(x=>x.item!==item);K.avoid.push({item,until:+days>0?new Date(Date.now()+days*864e5).toISOString().slice(0,10):null})}
function kitchenNow(){const K=kit(),t=new Date().toISOString().slice(0,10);K.avoid=K.avoid.filter(x=>!x.until||x.until>=t);return{fridge:K.fridge,fridgeAt:K.fridgeAt,avoid:K.avoid}}
function applyMemo(full){const i=full.indexOf('@@memo');if(i<0)return '';let o;try{const t=full.slice(i+6);o=JSON.parse(t.slice(t.indexOf('{'),t.lastIndexOf('}')+1))}catch{return ''}const K=kit(),n=[];
 for(const a of o.avoid||[])if(a&&a.item){addAvoid(a.item,a.days);n.push('no '+a.item+(+a.days>0?' for '+a.days+' day'+(a.days>1?'s':''):''))}
 if(typeof o.fridge==='string'&&o.fridge.trim()){K.fridge=o.fridge.slice(0,2000);K.fridgeAt=Date.now();n.push('fridge updated')}
 if(n.length)save();return n.join(', ')}
async function streamChat(messages,out){const c=cfg(),r=await fetch(c.base.replace(/\/+$/,'')+'/chat/completions',{method:'POST',signal:AbortSignal.timeout(240000),headers:hdrs(c),body:JSON.stringify({model:c.model,temperature:0.6,stream:true,messages})});
 if(!r.ok){const j=await r.json().catch(()=>({}));throw new Error(j.error?.message||'Model request failed ('+r.status+')')}
 let full='',sent=0;const push=()=>{const i=full.indexOf('@@'),v=i>=0?full.slice(0,i):full.replace(/@$/,'');if(v.length>sent){out({d:v.slice(sent)});sent=v.length}};
 if(!(r.headers.get('content-type')||'').includes('event-stream')){const j=await r.json();full=String(j.choices?.[0]?.message?.content||'');push();return full}
 const rd=r.body.getReader(),td=new TextDecoder();let buf='';
 for(;;){const{done,value}=await rd.read();if(done)break;buf+=td.decode(value,{stream:true});const lines=buf.split('\n');buf=lines.pop();for(const l of lines){if(!l.startsWith('data:'))continue;const t=l.slice(5).trim();if(t==='[DONE]')continue;try{const d=JSON.parse(t).choices?.[0]?.delta?.content;if(d){full+=d;push()}}catch{}}}
 push();return full.trim()}
const NS=()=>({on:true,max:10,gap:60,awake:'07:30-22:30',risk:'21:30-23:59',ntfy:'',...(db.settings.nudge||{})});
function mealBefore(t){const ms=new Date(t).getTime(),d=t.slice(0,10),es=db.entries.filter(e=>localIso(new Date(e.ts)).slice(0,10)===d&&e.ts<=ms);return es.length?(ms-Math.max(...es.map(e=>e.ts)))/36e5:null}
function daily(){const by={};for(const w of db.weighIns)(by[w.t.slice(0,10)]??=[]).push(w);const out=[];let tr=null,prev=null;
 for(const d of Object.keys(by).sort()){const rs=by[d].sort((a,b)=>a.t<b.t?-1:1),ref=tr??rs[0].kg,gap=prev?Math.min(14,(new Date(d)-new Date(prev))/864e5):1;
  const pick=rs.find(r=>r.ok)||rs.reduce((a,b)=>Math.abs(b.kg-ref)<Math.abs(a.kg-ref)?b:a);
  const flag=!pick.ok&&tr!=null&&Math.abs(pick.kg-ref)>Math.max(1,ref*.012)+.25*gap;let note='';
  if(flag){const df=pick.kg-ref,h=mealBefore(pick.t);note=`${Math.abs(df).toFixed(1)} kg ${df>0?'above':'below'} your trend of ${ref.toFixed(1)} kg. A real change that fast is unlikely.`+(h!=null&&h<4?` You logged a meal ${h.toFixed(1)} h before this reading, which adds weight.`:'')+' Is this correct?'}
  if(!flag)tr=tr==null?pick.kg:tr+(pick.kg-tr)*.3;
  out.push({date:d,kg:pick.kg,id:pick.id,flag,note,trend:+(tr??pick.kg).toFixed(2),n:rs.length,raw:rs.map(r=>({id:r.id,t:r.t,kg:r.kg,src:r.src||'manual',pick:r.id===pick.id}))});prev=d}
 return out}
const attr=l=>{const o={};for(const m of l.matchAll(/(\w+)="([^"]*)"/g))o[m[1]]=m[2];return o},hiso=s=>s.slice(0,10)+'T'+s.slice(11,19);
async function importHealth(file,isZip){const H=db.health={state:'processing',started:Date.now(),records:0};save();
 try{const cut=new Date(Date.now()-120*864e5).toISOString().slice(0,10),{spawn}=require('child_process'),rl=require('readline');let cp,input;
  if(isZip){cp=spawn('unzip',['-p',file,'*xport.xml']);input=cp.stdout;cp.on('error',e=>input.destroy(e))}else input=fs.createReadStream(file);
  const act={},stp={},wk=[],ws=[];
  for await(const line of rl.createInterface({input,crlfDelay:Infinity})){const l=line.trimStart();
   if(l.startsWith('<Record ')){const t=(l.match(/type="([^"]+)"/)||[])[1];if(!/BodyMass$|ActiveEnergyBurned$|StepCount$/.test(t||''))continue;const a=attr(l),d=a.startDate.slice(0,10);if(d<cut)continue;H.records++;
    if(t.endsWith('BodyMass')){let kg=+a.value;if(a.unit==='lb')kg*=.45359237;ws.push({t:hiso(a.startDate),kg:+kg.toFixed(2)})}
    else{const m=t.endsWith('StepCount')?stp:act,k=d+'|'+a.sourceName;m[k]=(m[k]||0)+(+a.value||0)}}
   else if(l.startsWith('<Workout ')){const a=attr(l);if(a.startDate.slice(0,10)<cut)continue;wk.push({t:hiso(a.startDate),type:(a.workoutActivityType||'').replace('HKWorkoutActivityType',''),min:Math.round(+a.duration||0),kcal:Math.round(+a.totalEnergyBurned||0),km:+((+a.totalDistance||0)*(a.totalDistanceUnit==='mi'?1.609:1)).toFixed(1)})}}
  if(cp)await new Promise(r=>cp.on('close',r));
  if(!ws.length&&!wk.length&&!H.records)throw new Error('No health data found. Upload export.zip or export.xml from the Health app.');
  for(const w of ws)if(!db.weighIns.some(x=>x.t===w.t&&Math.abs(x.kg-w.kg)<.01))db.weighIns.push({id:crypto.randomUUID(),t:w.t,kg:w.kg,src:'health'});
  const put=(m,f)=>{const best={};for(const k in m){const d=k.split('|')[0];best[d]=Math.max(best[d]||0,m[k])}for(const d in best)db.activity[d]={...(db.activity[d]||{}),[f]:Math.round(best[d])}};put(act,'active');put(stp,'steps');
  db.workouts=[...db.workouts.filter(w=>w.src==='manual'||w.t.slice(0,10)<cut),...wk].sort((a,b)=>a.t<b.t?-1:1);
  db.health={state:'done',at:Date.now(),weights:ws.length,workouts:wk.length}}
 catch(e){console.error(e);db.health={state:'error',error:e.message}}
 fs.unlink(file,()=>{});save()}
const mins=x=>{const[h,m]=x.split(':');return +h*60+ +m},inWin=(w,n)=>{const[a,b]=w.split('-').map(mins);return a<=b?n>=a&&n<b:n>=a||n<b};
async function deliver(m){db.inbox.push(m);db.inbox=db.inbox.slice(-100);save();const N=NS();if(N.ntfy)try{const u=new URL(N.ntfy);await fetch(u.origin,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({topic:u.pathname.replace(/^\//,''),title:m.title,message:m.body,tags:['fork_and_knife']}),signal:AbortSignal.timeout(10000)})}catch{}}
const FALL={risk:{title:'Pause before you snack',body:'This is your risky time. Drink a glass of water or tea and wait ten minutes. Late snacking slows your progress, and over years excess weight raises the risk of type 2 diabetes and heart disease. You are doing well, keep going.'},hungry:{title:'Time to eat something',body:'It has been a while since your last meal. Long gaps often lead to overeating later. Open the Coach tab for quick ideas.'}};
let nbusy=false;
async function nudgeTick(){const N=NS(),p=db.settings.profile;if(nbusy||!N.on||!p||!p.weight||!cfg().key)return;nbusy=true;
 try{const now=new Date(),nm=now.getHours()*60+now.getMinutes(),today=localIso(now).slice(0,10),t0=new Date(today+'T00:00:00').getTime(),auto=db.inbox.filter(x=>x.auto),last=auto[auto.length-1];
  if(auto.filter(x=>x.ts>=t0).length>=N.max||(last&&Date.now()-last.ts<N.gap*6e4))return;
  const es=db.entries.filter(e=>e.ts>=t0).sort((a,b)=>a.ts-b.ts),W=N.risk.split(',').map(x=>x.trim()).filter(Boolean),risk=W.some(w=>inWin(w,nm));let kind=null,since=0;
  if(risk)kind='risk';else if(inWin(N.awake,nm)){const wake=t0+mins(N.awake.split('-')[0])*6e4;since=(Date.now()-(es.length?es[es.length-1].ts:wake))/36e5;if(since>=5)kind='hungry'}
  if(!kind)return;
  const bo=Math.round(db.workouts.filter(w=>w.t.slice(0,10)===today).reduce((a,w)=>a+(w.kcal||0),0)*((db.settings.eatback??50)/100)),G0=db.settings.goals,G={...G0,kcal:G0.kcal+bo,carbs:G0.carbs+Math.round(bo/4)},tt=es.reduce((a,e)=>{e.items.forEach(i=>{a.kcal+=i.kcal;a.protein+=i.protein;a.carbs+=i.carbs;a.fat+=i.fat});return a},{kcal:0,protein:0,carbs:0,fat:0}),rem={kcal:Math.round(G.kcal-tt.kcal),protein:Math.round(G.protein-tt.protein),carbs:Math.round(G.carbs-tt.carbs),fat:Math.round(G.fat-tt.fat)};
  if(kind==='hungry'&&rem.kcal<250)return;
  const late=db.entries.filter(e=>e.ts>Date.now()-14*864e5&&W.some(w=>{const d=new Date(e.ts);return inWin(w,d.getHours()*60+d.getMinutes())})).length;
  const sys='You are a warm, honest nutrition coach sending a short proactive message. Weight loss is the priority. Never shame, never recommend fasting or going below the daily calorie target, never use fear tactics; factual health context is fine. Never suggest anything in recent.kitchen.avoidNow and prefer recent.kitchen.fridge ingredients. Respond in '+(p.lang||'English')+'. Reply with ONLY JSON: {"title":"max 5 words","body":"max 35 words, 2 short sentences","recipes":[{"name":"","kcal":0,"protein":0,"carbs":0,"fat":0,"minutes":0,"ingredients":[""],"steps":[""]}]}';
  const task=kind==='risk'?'The user is in their personal risky time for unhealthy eating, such as late snacking. Convince them kindly not to snack mindlessly: tie it to their goal and progress, mention one or two factual long-term risks of obesity such as type 2 diabetes or heart disease, and offer one concrete alternative that fits the remaining calories. recipes may be empty or one tiny snack.':'The user has not eaten for a long time. Encourage them to eat, because long gaps often lead to overeating later, and give 2 quick recipes (max 15 minutes) that fit the remaining macros.';
  let o;try{o=await llm(sys,JSON.stringify({task,profile:p,targets:G,remainingToday:rem,hoursSinceLastMeal:+since.toFixed(1),time:now.toTimeString().slice(0,5),riskySnacksLast14Days:late,recent:digest()}))}catch{o=FALL[kind]}
  await deliver({id:crypto.randomUUID(),ts:Date.now(),auto:true,kind,title:String(o.title||FALL[kind].title),body:String(o.body||FALL[kind].body),recipes:Array.isArray(o.recipes)?o.recipes.slice(0,2):[],read:false})}
 finally{nbusy=false}}
setInterval(()=>nudgeTick().catch(()=>{}),5*6e4);setTimeout(()=>nudgeTick().catch(()=>{}),3e4);
process.on('unhandledRejection',e=>console.error(e));process.on('uncaughtException',e=>console.error(e));
const srv=http.createServer(async(q,s)=>{
  const send=(c,o,t='application/json',h={})=>{s.writeHead(c,{'Content-Type':t,...h});s.end(t==='application/json'?JSON.stringify(o):o)};
  try{
    const u=q.url.split('?')[0],m=q.method;
    if(m==='GET'&&u==='/')return send(200,fs.readFileSync(path.join(__dirname,'index.html')),'text/html; charset=utf-8');
    if(m==='GET'&&u==='/root.crt'){try{return send(200,fs.readFileSync('/pki/caddy/pki/authorities/local/root.crt'),'application/x-x509-ca-cert',{'Content-Disposition':'attachment; filename="plate-root.crt"'})}catch{return send(404,{error:'Certificate not created yet. Wait a moment and reload.'})}}
    if(m==='GET'&&u==='/manifest.json')return send(200,{name:'Plate',short_name:'Plate',start_url:'/',display:'standalone',background_color:'#1a1422',theme_color:'#1a1422'});
    if(u==='/api/health-import'&&m==='POST'){const nm=String(q.headers['x-filename']||'export.xml'),f=path.join(DIR,'upload.tmp');await new Promise((r,j)=>{const w=fs.createWriteStream(f);q.pipe(w);w.on('finish',r);w.on('error',j)});importHealth(f,/\.zip$/i.test(nm));return send(200,{ok:1})}
    if(u==='/api/transcribe'&&m==='POST'){const ch=[];for await(const c of q)ch.push(c);const base=process.env.STT_BASE_URL;if(!base)return send(400,{error:'Speech-to-text is not set up. Start the stt service or set STT_BASE_URL.'});
      const fd=new FormData();fd.append('file',new Blob([Buffer.concat(ch)],{type:'audio/wav'}),'audio.wav');fd.append('model',process.env.STT_MODEL||'whisper-1');fd.append('response_format','json');
      const r=await fetch(base.replace(/\/+$/,'')+'/audio/transcriptions',{method:'POST',body:fd,headers:process.env.STT_API_KEY?{Authorization:'Bearer '+process.env.STT_API_KEY}:{},signal:AbortSignal.timeout(120000)}).catch(e=>({ok:false,status:0,json:async()=>({error:'Cannot reach the speech service: '+e.message})}));
      const j=await r.json().catch(()=>({}));if(!r.ok)return send(502,{error:(j.error&&j.error.message)||j.error||j.detail||'Transcription failed ('+r.status+')'});return send(200,{text:String(j.text||'').trim()})}
    let b={};
    if(m!=='GET'){const ch=[];for await(const c of q)ch.push(c);const t=Buffer.concat(ch).toString();if(t)b=JSON.parse(t)}
    if(u==='/api/data')return send(200,{entries:db.entries,wseries:daily(),workouts:db.workouts.slice(-150),chats:db.chats,kitchen:kitchenNow(),activity:Object.fromEntries(Object.entries(db.activity).sort().slice(-30)),inbox:db.inbox.slice(-30).reverse(),health:db.health,jobs:db.jobs.map(({image,...j})=>j),settings:pub()});
    if(u==='/api/analyze'&&m==='POST')return send(200,await analyze(b.image,b.note));
    if(u==='/api/entries'&&m==='POST'){const e={id:crypto.randomUUID(),ts:b.ts||Date.now(),name:b.name||'Meal',items:b.items||[],thumb:b.thumb||''};db.entries.push(e);save();return send(200,e)}
    const id=u.match(/^\/api\/entries\/(.+)$/)?.[1];
    if(id&&m==='PUT'){const e=db.entries.find(x=>x.id===id);if(!e)return send(404,{error:'Entry not found'});Object.assign(e,{name:b.name,items:b.items,ts:b.ts||e.ts,est:false,comment:b.comment??e.comment});save();return send(200,e)}
    if(id&&m==='DELETE'){db.entries=db.entries.filter(x=>x.id!==id);save();return send(200,{ok:1})}
    if(u==='/api/settings'&&m==='PUT'){
      const S=db.settings;
      if(b.goals)S.goals={kcal:+b.goals.kcal||0,protein:+b.goals.protein||0,carbs:+b.goals.carbs||0,fat:+b.goals.fat||0};
      for(const k of['baseUrl','model'])if(typeof b[k]==='string')S[k]=b[k].trim();
      if(b.apiKey)S.apiKey=b.apiKey.trim();
      if(b.profile)S.profile=b.profile;
      if(b.nudge)S.nudge={...NS(),...b.nudge};
      if(b.eatback!=null)S.eatback=Math.max(0,Math.min(100,+b.eatback||0));
      save();return send(200,pub());
    }
    if(u==='/api/export')return send(200,JSON.stringify({app:'foodtracker',version:1,exportedAt:new Date().toISOString(),goals:db.settings.goals,profile:db.settings.profile||{},weighIns:db.weighIns,chats:db.chats,workouts:db.workouts,activity:db.activity,entries:db.entries},null,2),'application/json',{'Content-Disposition':'attachment; filename="foodtracker-export.json"'});
    if(u==='/api/import'&&m==='POST'){
      if(!Array.isArray(b.entries))return send(400,{error:'File has no entries array'});
      const map=new Map(db.entries.map(e=>[e.id,e]));
      for(const e of b.entries)if(e&&e.id&&Array.isArray(e.items))map.set(e.id,e);
      db.entries=[...map.values()];if(b.goals)db.settings.goals=b.goals;if(b.profile)db.settings.profile=b.profile;
      const wi=[...(Array.isArray(b.weighIns)?b.weighIns:[]),...(Array.isArray(b.weights)?b.weights.map(w=>({id:crypto.randomUUID(),t:w.date+'T12:00:00',kg:w.kg,src:'manual',ok:true})):[])];const wm=new Map(db.weighIns.map(w=>[w.id,w]));wi.forEach(w=>w&&w.id&&w.t&&w.kg&&wm.set(w.id,w));db.weighIns=[...wm.values()];if(Array.isArray(b.workouts))db.workouts=b.workouts;if(Array.isArray(b.chats)){const cm=new Map(db.chats.map(c=>[c.id,c]));b.chats.forEach(c=>c&&c.id&&cm.set(c.id,c));db.chats=[...cm.values()]}if(b.activity&&typeof b.activity==='object')db.activity={...db.activity,...b.activity};
      save();return send(200,{entries:db.entries.length});
    }
    if(u==='/api/jobs'&&m==='POST'){if(!b.image&&!b.note)return send(400,{error:'No image or text'});const j={id:crypto.randomUUID(),ts:b.ts||Date.now(),image:b.image||'',thumb:b.thumb||'',note:b.note||'',status:'queued'};db.jobs.push(j);save();pump();return send(200,{id:j.id})}
    const jr=u.match(/^\/api\/jobs\/(.+)\/retry$/);if(jr&&m==='POST'){const j=db.jobs.find(x=>x.id===jr[1]);if(j){j.status='queued';delete j.error;save();pump()}return send(200,{ok:1})}
    const jd=u.match(/^\/api\/jobs\/(.+)$/);if(jd&&m==='DELETE'){db.jobs=db.jobs.filter(x=>x.id!==jd[1]);save();return send(200,{ok:1})}
    if(u==='/api/chat'&&m==='POST'){const p=db.settings.profile||{},msgs=(b.messages||[]).slice(-16).map(x=>({role:x.role==='user'?'user':'assistant',content:String(x.content||'').slice(0,2000)}));if(!msgs.length)return send(400,{error:'No message'});
      const sys='You are the user\'s personal nutrition and training coach in a chat on their phone. Losing weight is the priority; healthier eating is a side quest. Answer in at most 60 words, 2 to 4 short sentences, plain text without headings or markdown; use short dashes only for real lists; go longer only if asked. Never shame, never suggest fasting or going below the daily target, suggest a doctor for medical issues. Never suggest anything in recent.kitchen.avoidNow and prefer recent.kitchen.fridge. If the user says what they cannot or do not want to eat, or what is in their fridge, finish with a new last line: @@memo {"avoid":[{"item":"fish","days":7}],"fridge":null} (days 0 means until removed, fridge is the complete updated list or null); never mention this line. Respond in '+(p.lang||'English')+'. Context: '+JSON.stringify({profile:p,today:todayState(),recent:digest()});
      s.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache','X-Accel-Buffering':'no'});const out=d=>s.write('data: '+JSON.stringify(d)+'\n\n');
      try{const full=await streamChat([{role:'system',content:sys},...msgs],out),n=applyMemo(full);if(n)out({note:n});out({done:1})}catch(e){out({error:e.message})}
      return s.end()}
    if(u==='/api/kitchen'&&m==='PUT'){const K=kit();if(typeof b.fridge==='string'){K.fridge=b.fridge.slice(0,2000);K.fridgeAt=Date.now()}for(const a of b.avoidAdd||[])addAvoid(a.item,a.days);if(b.avoidRemove)K.avoid=K.avoid.filter(x=>x.item!==b.avoidRemove);save();return send(200,kitchenNow())}
    if(u==='/api/chats'&&m==='POST'){const ms=(b.messages||[]).filter(x=>x&&x.content).map(x=>({role:x.role,content:String(x.content)}));if(!ms.length)return send(400,{error:'Nothing to save'});let c=b.id&&db.chats.find(x=>x.id===b.id);if(!c){c={id:crypto.randomUUID(),ts:Date.now()};db.chats.push(c)}c.messages=ms;c.title=(ms.find(x=>x.role==='user')||ms[0]).content.slice(0,45);c.upd=Date.now();save();return send(200,{id:c.id})}
    const cd=u.match(/^\/api\/chats\/(.+)$/);if(cd&&m==='DELETE'){db.chats=db.chats.filter(x=>x.id!==cd[1]);save();return send(200,{ok:1})}
    if(u==='/api/workouts'&&m==='POST'){db.workouts.push({id:crypto.randomUUID(),t:b.t||localIso(),type:String(b.type||'Workout').slice(0,40),min:+b.min||0,kcal:Math.round(+b.kcal||0),km:0,src:'manual'});save();return send(200,{ok:1})}
    const wd=u.match(/^\/api\/workouts\/(.+)$/);if(wd&&m==='DELETE'){db.workouts=db.workouts.filter(x=>x.id!==wd[1]);save();return send(200,{ok:1})}
    if(u==='/api/coach'&&m==='POST')return send(200,await coach(b));
        if(u==='/api/weights'&&m==='POST'){const kg=+b.kg;if(!(kg>20&&kg<400))return send(400,{error:'Enter a weight in kg'});db.weighIns.push({id:crypto.randomUUID(),t:b.t||localIso(),kg,src:'manual'});save();return send(200,{ok:1})}
    const wm=u.match(/^\/api\/weighins\/(.+)$/);if(wm){const w=db.weighIns.find(x=>x.id===wm[1]);if(!w)return send(404,{error:'Not found'});if(m==='DELETE')db.weighIns=db.weighIns.filter(x=>x!==w);else if(b.kg){w.kg=+b.kg;w.ok=true}else w.ok=true;save();return send(200,{ok:1})}
    const rv=u.match(/^\/api\/entries\/(.+)\/reeval$/);if(rv&&m==='POST'){const e=db.entries.find(x=>x.id===rv[1]);if(!e)return send(404,{error:'Meal not found'});db.jobs.push({id:crypto.randomUUID(),kind:'reeval',entryId:e.id,ts:e.ts,thumb:e.thumb,comment:String(b.comment||''),status:'queued'});save();pump();return send(200,{ok:1})}
    if(u==='/api/inbox/read'&&m==='POST'){db.inbox.forEach(x=>x.read=true);save();return send(200,{ok:1})}
    send(404,{error:'Not found'});
  }catch(e){send(500,{error:e.message})}
});srv.requestTimeout=0;srv.listen(process.env.PORT||8080,()=>{console.log('Food tracker running');pump()});
module.exports={daily,db,applyMemo,kitchenNow,streamChat};
