import * as cheerio from "cheerio";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const clean = s => String(s ?? "").replace(/ /g, " ").replace(/\s+/g, " ").trim();
const get = async u => cheerio.load(await (await fetch(u, { headers: { "user-agent": UA } })).text());
const rowsOf = ($, t) => $(t).children("thead,tbody").children("tr").add($(t).children("tr")).toArray().map(tr => $(tr).children("td,th").toArray().map(c => clean($(c).text())));
// 1. Roster
let $ = await get("https://stats.swehockey.se/Teams/Info/TeamRoster/20961");
$("table").each((i, t) => { const r = rowsOf($, t); if (r.length > 3 && r[0].join("").length < 300 && JSON.stringify(r).includes("Björklöven")) console.log("ROSTER", i, JSON.stringify(r.slice(0, 6)).slice(0, 1200)); });
// 2. Game links for a Björklöven game
$ = await get("https://stats.swehockey.se/ScheduleAndResults/Schedule/20961");
const links = [];
$("tr").each((_, tr) => { const t = clean($(tr).text()); if (/Växjö Lakers HC - IF Björklöven/.test(t)) $(tr).find("a[href]").each((_, a) => links.push($(a).attr("href"))); $(tr).find("[onclick]").each((_, a) => links.push("onclick:" + $(a).attr("onclick"))); });
console.log("GAMELINKS", links.filter(l => !/^onclick:/.test(l) || /Game/.test(l)).slice(-12));
const m = links.join(" ").match(/Game\/\w+\/(\d+)/g); console.log("ids", m && [...new Set(m)].slice(-6));
const gid = m && m[m.length - 1].match(/(\d+)$/)[1];
if (gid) for (const kind of ["Events", "LineUps", "Actions"]) {
  try { const g = await get(`https://stats.swehockey.se/Game/${kind}/${gid}`);
    const txt = clean(g("body").text()); console.log(kind, gid, txt.length, /TOI|Istid|Time on Ice/i.test(txt) ? "HAS TOI" : "no toi", txt.slice(txt.indexOf("Björklöven"), txt.indexOf("Björklöven") + 500));
    g("a[href]").each((_, a) => { const h = g(a).attr("href"); if (/Game|pdf|Report/i.test(h)) console.log("  link", h); });
  } catch (e) { console.log(kind, e.message); }
}
