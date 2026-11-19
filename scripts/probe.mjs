// Tillfälligt: visar hur swehockeys lagstatistik ser ut
import * as cheerio from "cheerio";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const clean = s => String(s ?? "").replace(/ /g, " ").replace(/\s+/g, " ").trim();
for (const u of ["https://stats.swehockey.se/Teams/Statistics/ScoringAndGoalkeeping/20961", "https://stats.swehockey.se/Players/Statistics/LeadingGoaliesSVS/20961"]) {
  const html = await (await fetch(u, { headers: { "user-agent": UA } })).text();
  const $ = cheerio.load(html);
  console.log("== ", u, html.length);
  $("select").each((_, s) => console.log(" select", $(s).attr("name"), $(s).find("option").toArray().slice(0, 20).map(o => `${$(o).attr("value")}=${clean($(o).text())}`).join(" | ")));
  const hrefs = new Set(); $("a[href]").each((_, a) => { const x = $(a).attr("href"); if (/Team|Player/i.test(x) && /\d/.test(x)) hrefs.add(x + " :: " + clean($(a).text()).slice(0, 30)); });
  console.log(" links", [...hrefs].filter(x => /Björklöven|IFB|Team/i.test(x)).slice(0, 30).join("\n   "));
  $("table").each((i, t) => {
    const rows = $(t).children("thead,tbody").children("tr").add($(t).children("tr")).toArray().map(tr => $(tr).children("td,th").toArray().map(c => clean($(c).text())));
    if (rows.length > 3) console.log(` table ${i}: ${rows.length} rows`, JSON.stringify(rows.slice(0, 4)).slice(0, 600));
  });
  const txt = clean($("body").text()); const k = txt.indexOf("Björklöven"); console.log(" near:", txt.slice(Math.max(0,k-200), k+300));
}
