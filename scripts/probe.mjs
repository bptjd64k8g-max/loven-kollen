import * as cheerio from "cheerio";
const SWE="https://stats.swehockey.se";
const get=async u=>(await fetch(u,{headers:{"user-agent":"Mozilla/5.0"}})).text();
const l=cheerio.load(await get(`${SWE}/ScheduleAndResults/Live/20961`));
l("a[href*='openonlinewindow']").each((_,a)=>console.log("LIVE",l(a).attr("href"),"|",l(a).closest(".d-sm-flex").text().replace(/\s+/g," ").slice(0,160)));
const ids=[...new Set(l("a[href*='openonlinewindow']").map((_,a)=>(l(a).attr("href").match(/\/Game\/\w+\/(\d+)/)||[])[1]).get())];
for(const id of ids){const h=await get(`${SWE}/Game/LineUps/${id}`);const $=cheerio.load(h);
 const t=$("h3").map((_,x)=>$(x).text().trim()).get();console.log("GAME",id,t.join(" / "));
 if(!t.some(x=>/bj.rkl/i.test(x)))continue;
 $("tr").each((_,r)=>{const s=$(r).children().map((_,c)=>$(c).text().replace(/\s+/g," ").trim()+($(c).find(".red").length?"[RED:"+$(c).find(".red").map((_,p)=>$(p).text().trim()).get().join(";")+"]":"")).get().join(" || ");if(s.trim())console.log("ROW",s.slice(0,400))});}
