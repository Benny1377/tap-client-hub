// LOCAL ONLY. Browser checks of the paired A/R approval on synthetic reports: matched pair, mismatch, Admin uploader, Owner uploader,
// and a correction blocking its corrector. Needs the local harness (reset, test users) and a dev server on :3000. Never prints credentials.
// Env: PUPPETEER_CORE, CHROME_PATH. Run: node tools/billing-preview/verify-ar-paired-approval-local.mjs
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
const env = Object.fromEntries(readFileSync(".env.local","utf8").split(/\r?\n/).filter(l=>/^[A-Z_0-9]+=/.test(l)).map(l=>[l.slice(0,l.indexOf("=")),l.slice(l.indexOf("=")+1).replace(/^"|"$/g,"")]));
const B="http://localhost:3000",A=env.NEXT_PUBLIC_SUPABASE_URL;if(!/127\.0\.0\.1|localhost/.test(A))throw new Error("local only");
const H={apikey:env.SUPABASE_SERVICE_ROLE_KEY,Authorization:`Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,"Accept-Profile":"tap_hub_project"};
const rest=async p=>(await fetch(`${A}/rest/v1/${p}`,{headers:H})).json();
const wait=ms=>new Promise(r=>setTimeout(r,ms));const tag=Date.now().toString(36).toUpperCase();
const results=[];const rec=(id,n,ok,ev="")=>{results.push(ok);console.log(`${ok?"PASS":"FAIL"} ${id} ${n} :: ${String(ev).slice(0,220)}`)};
function pdf(lines){const esc=t=>t.replace(/[\\()]/g,c=>`\\${c}`);const stream=`BT /F1 8 Tf\n${lines.flatMap(({y,cells})=>cells.map(([x,t])=>`1 0 0 1 ${x} ${y} Tm (${esc(t)}) Tj`)).join("\n")}\nET`;const o=["<< /Type /Catalog /Pages 2 0 R >>","<< /Type /Pages /Kids [3 0 R] /Count 1 >>","<< /Type /Page /Parent 2 0 R /MediaBox [0 0 792 612] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"];let out="%PDF-1.4\n";const off=[];o.forEach((x,i)=>{off.push(Buffer.byteLength(out));out+=`${i+1} 0 obj\n${x}\nendobj\n`});const xr=Buffer.byteLength(out);out+=`xref\n0 ${o.length+1}\n0000000000 65535 f \n${off.map(v=>`${String(v).padStart(10,"0")} 00000 n \n`).join("")}trailer\n<< /Size ${o.length+1} /Root 1 0 R >>\nstartxref\n${xr}\n%%EOF\n`;return Buffer.from(out)}
const X={type:30,date:90,num:150,po:215,name:260,terms:480,due:530,aging:600,bal:660};
const C=["Sample Harbor Inc","Synthetic Orchard LLC"];
function detailPdf(day,amounts,label){const rows=[{y:580,cells:[[250,"TAP Associates, LLC"]]},{y:568,cells:[[250,"A/R Aging QuickZoom"]]},{y:556,cells:[[250,`As of March ${day}, 2026`]]},{y:544,cells:[[250,`Page 1 ${tag}`]]},{y:530,cells:[[X.type,"Type"],[X.date,"Date"],[X.num,"Num"],[X.po,"P. O. #"],[X.name,"Name"],[X.terms,"Terms"],[X.due,"Due Date"],[X.aging,"Aging"],[X.bal,"Open Balance"]]}];let y=515;
 C.forEach((c,i)=>{rows.push({y,cells:[[30,c]]});y-=13;rows.push({y,cells:[[X.type,"Invoice"],[X.date,"02/01/2026"],[X.num,`SYN-${tag}-${day}-${i}`],[X.name,c],[X.terms,"Net 15"],[X.due,"02/16/2026"],[X.aging,"30"],[X.bal,amounts[i].toFixed(2)]]});y-=13;rows.push({y,cells:[[30,`Total ${c}`],[X.bal,amounts[i].toFixed(2)]]});y-=16});
 rows.push({y,cells:[[30,"TOTAL"],[X.bal,amounts.reduce((a,b)=>a+b,0).toFixed(2)]]});return pdf(rows)}
function summaryPdf(day,amounts,label){const S=[30,220,300,380,460,540,640];const rows=[{y:580,cells:[[250,"TAP Associates, LLC"]]},{y:568,cells:[[250,"A/R Aging Summary"]]},{y:556,cells:[[250,`As of March ${day}, 2026`]]},{y:544,cells:[[250,`Page 1 ${tag}`]]},{y:530,cells:["Customer","Current","1 - 30","31 - 60","61 - 90","Over 90","Total"].map((t,i)=>[S[i],t])}];let y=515;
 C.forEach((c,i)=>{const a=amounts[i].toFixed(2);rows.push({y,cells:[c,"0.00",a,"0.00","0.00","0.00",a].map((t,k)=>[S[k],t])});y-=14});
 const tot=amounts.reduce((a,b)=>a+b,0).toFixed(2);rows.push({y,cells:["TOTAL","0.00",tot,"0.00","0.00","0.00",tot].map((t,k)=>[S[k],t])});return pdf(rows)}
class Ses{jar=new Map();async call(m,p,b,form){const r=await fetch(B+p,{method:m,redirect:"manual",headers:{...(b!==undefined?{"Content-Type":"application/json"}:{}),...(this.jar.size?{Cookie:[...this.jar].map(([k,v])=>`${k}=${v}`).join("; ")}:{})},body:form||(b!==undefined?JSON.stringify(b):undefined)});for(const c of r.headers.getSetCookie?.()||[]){const[x]=c.split(";");this.jar.set(x.slice(0,x.indexOf("=")),x.slice(x.indexOf("=")+1))}const t=await r.text();let j=null;try{j=JSON.parse(t)}catch{}return{status:r.status,json:j}}async in(n){const r=await this.call("POST","/api/auth/sign-in",{identifier:env[`TEST_${n}_EMAIL`],password:env[`TEST_${n}_PASSWORD`]});if(r.status!==200)throw new Error("signin "+n);return this}}
const coll=await new Ses().in("STAFF_COLLECTIONS"),admin=await new Ses().in("ADMIN"),owner=await new Ses().in("OWNER");
async function upload(s,buf,name){const f=new FormData();f.set("file",new File([buf],`SYNTHETIC-${name}-${tag}.pdf`,{type:"application/pdf"}));const u=await s.call("POST","/api/collections/imports",undefined,f);const id=u.json?.batch?.id;if(!id)throw new Error("upload "+u.status);const p=await s.call("POST",`/api/collections/imports/${id}/parse`);if(p.status!==200)throw new Error("parse "+p.status+" "+p.json?.code);return id}
async function pair(uploader,day,detailAmounts,summaryAmounts,label){const s=await upload(uploader,summaryPdf(day,summaryAmounts,label),`summary-${day}`);const d=await upload(uploader,detailPdf(day,detailAmounts,label),`detail-${day}`);// The local reset lacks the auto-match function, so Collections staff confirm each invoice through the normal review route.
 const clients=await rest("clients?select=id,name");let matched=0;
 for(const r of (await rows(d)).filter(x=>x.review_disposition==="unreviewed"&&x.parsed_fields?.auto_suggestion?.disposition==="invoice")){const f=r.parsed_fields.auto_suggestion.fields;const c=clients.find(x=>x.name===f.customer_name);const v=await coll.call("POST",`/api/collections/imports/${d}`,{source_row_id:r.id,client_id:c.id,customer_name:f.customer_name,invoice_number:f.invoice_number,transaction_type:f.transaction_type,transaction_date:f.transaction_date,due_date:f.due_date,terms:f.terms,reported_aging:f.reported_aging,open_balance:Number(f.open_balance),confirmed:true,row_data:{cells:r.parsed_fields.cells}});if(v.status===201)matched++;else console.log("confirm",v.status,v.json?.code)}
 // An unreadable summary line stays in review until a person classifies it; here the report title, marked as a heading by Collections staff.
 let unread=0;for(const r of (await rows(s)).filter(x=>x.review_disposition==="unreviewed")){unread++;await coll.call("PATCH",`/api/collections/imports/${s}`,{row_id:r.id,disposition:"header"})}
 return{s,d,matched,unread}}
const batch=async id=>(await rest(`collection_import_batches?select=status,report_type,source_as_of&id=eq.${id}`))[0];
const rows=async id=>rest(`collection_import_rows?select=id,review_disposition,parsed_fields&batch_id=eq.${id}`);
const { default: puppeteer } = await import(pathToFileURL(process.env.PUPPETEER_CORE).href);
const browser=await puppeteer.launch({executablePath:process.env.CHROME_PATH,headless:true});
const errors=[];
async function page(n){const ctx=await browser.createBrowserContext();const p=await ctx.newPage();await p.setViewport({width:1400,height:1100});p.on("pageerror",e=>errors.push(String(e.message).slice(0,120)));await p.goto(B+"/login",{waitUntil:"domcontentloaded"});await p.evaluate(async(i,w)=>fetch("/api/auth/sign-in",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({identifier:i,password:w})}),env[`TEST_${n}_EMAIL`],env[`TEST_${n}_PASSWORD`]);return p}
async function openBatch(p,id){await p.goto(B+"/collections",{waitUntil:"networkidle2",timeout:90000});await p.evaluate(()=>[...document.querySelectorAll("[role=tab]")].find(t=>/A\/R reports/.test(t.textContent)).click());await p.waitForSelector(`[data-import-batch="${id}"]`,{timeout:30000});await p.evaluate(i=>document.querySelector(`[data-import-batch="${i}"] button`).click(),id);await p.waitForSelector(`[data-import-review="${id}"]`,{timeout:30000});await wait(2500)}
const approveClick=async p=>{await p.evaluate(()=>[...document.querySelectorAll("[data-approval-box] button")].find(b=>/Approve both/.test(b.textContent)).click());await wait(4000)};
try{
 // 1. matched pair, uploaded by Collections staff, approved by Admin
 const P1=await pair(coll,1,[100,250],[100,250],"Pair match");
 const sv=await rows(P1.s);const custRows=sv.filter(r=>r.parsed_fields?.auto_suggestion?.fields?.kind==="customer");
 rec("U1","summary uploaded first, detail second; customer rows are summary evidence, not ignored",custRows.length===2&&custRows.every(r=>r.review_disposition==="summary"),`customer rows=${custRows.length} ${custRows.map(r=>r.review_disposition).join(",")} matched=${P1.matched} unreadable summary lines kept in review=${P1.unread}`);
 const a=await page("ADMIN");await openBatch(a,P1.s);
 const sum=await a.evaluate(()=>({rows:[...document.querySelectorAll("[data-summary-row]")].map(r=>r.getAttribute("data-summary-status")),ignored:/Ignored/.test(document.querySelector("[data-summary-rows]")?.innerText||"")}));
 rec("U2","the summary shows customer rows as pending, with the printed total, never Ignored",sum.rows.filter(s=>s==="pending").length===2&&sum.rows.includes("total")&&!sum.ignored,JSON.stringify(sum));
 rec("U3","the detail is not in Collections before approval",(await batch(P1.d)).status==="needs_review"&&(await rest(`collection_import_invoices?select=review_status&batch_id=eq.${P1.d}`)).every(i=>i.review_status!=="approved"));
 await openBatch(a,P1.d);const box=await a.evaluate(()=>({state:document.querySelector("[data-approval-box]")?.getAttribute("data-approval-box"),paired:!!document.querySelector("[data-paired-summary]"),failing:[...document.querySelectorAll('[data-approval-check][data-ok="false"]')].map(e=>e.textContent.trim().slice(0,70))}));
 rec("M1","the detail's Approve is paired with its same-date summary and ready",box.state==="ready"&&box.paired,JSON.stringify(box));
 await approveClick(a);
 const both=[await batch(P1.d),await batch(P1.s)];const shown=await a.evaluate(()=>({notice:/Both reports are approved/.test(document.body.innerText),status:document.querySelector("[data-import-review]")?.getAttribute("data-batch-status")}));
 rec("M2","Approve approves both reports together and the page shows it",both.every(b=>b.status==="approved")&&shown.notice&&shown.status==="approved",JSON.stringify({db:both.map(b=>b.status),...shown}));
 await openBatch(a,P1.s);rec("M3","the refreshed summary shows approved with matched rows",await a.evaluate(()=>document.querySelector("[data-import-review]")?.getAttribute("data-batch-status")==="approved"&&[...document.querySelectorAll("[data-summary-row]")].filter(r=>r.getAttribute("data-summary-status")==="matched").length===2));
 const w=await coll.call("GET","/api/collections/receivables?limit=200");rec("M4","the approved invoices are on the Collections call list",JSON.stringify(w.json).includes(`SYN-${tag}-1-0`)&&JSON.stringify(w.json).includes(`SYN-${tag}-1-1`));
 // 2. mismatch
 const P2=await pair(coll,2,[100,250],[100,275],"Pair mismatch");
 await openBatch(a,P2.d);await approveClick(a);
 const mm=await a.evaluate(()=>({err:document.querySelector('[data-approval-error="IMPORT_RECONCILIATION_MISMATCH"]')?true:false,table:document.querySelectorAll("[data-reconciliation-customers] tbody tr").length,conflicts:document.querySelectorAll('[data-customer-status="conflict"]').length,printed:document.querySelector("[data-printed-total]")?.getAttribute("data-printed-total"),diff:document.querySelector("[data-reconciliation-difference]")?.innerText}));
 rec("X1","a mismatch shows per-customer math, bucket check and printed total",mm.err&&mm.table===2&&mm.conflicts===1&&!!mm.printed&&mm.diff==="$25.00",JSON.stringify(mm));
 rec("X2","both reports stay in review after a mismatch",(await batch(P2.d)).status==="needs_review"&&(await batch(P2.s)).status==="needs_review");
 await openBatch(a,P2.s);rec("X3","the summary marks the conflicting customer",await a.evaluate(()=>[...document.querySelectorAll("[data-summary-row]")].map(r=>r.getAttribute("data-summary-status")).filter(s=>s==="conflict").length===1));
 // 3. Admin uploader may approve their own pair; Owner uploader may not
 const P3=await pair(admin,3,[100,250],[100,250],"Pair admin upload");
 await openBatch(a,P3.d);await approveClick(a);rec("A1","an Admin may approve a pair they uploaded",(await batch(P3.d)).status==="approved"&&(await batch(P3.s)).status==="approved");
 const P4=await pair(owner,4,[100,250],[100,250],"Pair owner upload");
 const o=await page("OWNER");await openBatch(o,P4.d);
 const ob=await o.evaluate(()=>({state:document.querySelector("[data-approval-box]")?.getAttribute("data-approval-box"),uploader:document.querySelector('[data-approval-check="uploader"]')?.getAttribute("data-ok")}));
 const direct=await owner.call("POST",`/api/collections/imports/${P4.d}/approve`,{summary_batch_id:P4.s});
 rec("A2","an Owner who uploaded can't approve: blocked on screen and refused by the server",ob.state==="blocked"&&ob.uploader==="false"&&direct.json?.code==="IMPORT_SEPARATION_OF_DUTIES"&&(await batch(P4.d)).status==="needs_review",JSON.stringify({...ob,server:direct.status,code:direct.json?.code}));
 // 4. a correction blocks the corrector, even an Admin
 const P5=await pair(coll,5,[100,250],[100,250],"Pair correction");
 await openBatch(a,P5.s);
 await a.evaluate(()=>document.querySelector("[data-summary-row] button")?.click());await a.waitForSelector("[data-summary-correction]",{timeout:10000});
 await a.evaluate(()=>{const f=document.querySelector("[data-summary-correction]");const set=(n,v)=>{const el=f.querySelector(`[data-field="${n}"]`);Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(el,v);el.dispatchEvent(new Event("input",{bubbles:true}))};set("customer_name","Sample Harbor Inc");const c=f.querySelector('[data-field="confirmed"]');c.click();});
 await wait(300);await a.evaluate(()=>document.querySelector("[data-summary-correction] button[type=submit]").click());await wait(2500);
 const audit=await rest(`collection_import_audit?select=action&batch_id=eq.${P5.s}&action=eq.pdf_summary_row_corrected`);
 rec("C1","an Admin corrects a summary row through the form",audit.length===1&&!(await a.$("[data-summary-correction]")),`audit=${audit.length}`);
 await openBatch(a,P5.d);await approveClick(a);
 const ce=await a.evaluate(()=>document.querySelector("[data-approval-error]")?.getAttribute("data-approval-error")||"");
 rec("C2","the Admin who corrected the summary can't approve the pair",(await batch(P5.d)).status==="needs_review"&&(await batch(P5.s)).status==="needs_review"&&/FORBIDDEN|SEPARATION/i.test(ce),ce);
 const o2=await page("OWNER");await openBatch(o2,P5.d);await approveClick(o2);
 rec("C3","a different eligible Owner can still approve that pair",(await batch(P5.d)).status==="approved"&&(await batch(P5.s)).status==="approved");
 const del=await rest("collection_delivery_attempts?select=id");rec("D1","delivery stayed off: no attempts",Array.isArray(del)&&del.length===0);
 rec("E1","no page errors",errors.length===0,errors.join("; "));
}finally{await browser.close()}
const failed=results.filter(x=>!x).length;console.log(`\n${results.length-failed}/${results.length} passed`);process.exit(failed?1:0);
