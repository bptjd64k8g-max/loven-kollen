import * as cheerio from "cheerio";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const clean = s => String(s ?? "").replace(/ /g, " ").replace(/\s+/g, " ").trim();
for (const u of ["https://stats.swehockey.se/ScheduleAndResults/Schedule/20961", "https://stats.swehockey.se/Teams/Statistics/Faceoffs/20961"]) {
  const html = await (await fetch(u, { headers: { "user-agent": UA } })).text();
  const $ = cheerio.load(html);
  console.log("== ", u, html.length);
  $("table").each((i, t) => {
    const rows = $(t).children("thead,tbody").children("tr").add($(t).children("tr")).toArray().map(tr => $(tr).children("td,th").toArray().map(c => clean($(c).text())));
    if (rows.length < 3 || rows[0].join("").length > 400) return;
    console.log(` table ${i}: ${rows.length} rows`, JSON.stringify(rows.slice(0, 4)).slice(0, 700));
    const hits = rows.map((r, k) => [k, r]).filter(([, r]) => r.some(c => /Björklöven|^IFB$/.test(c)));
    hits.slice(0, 3).concat(hits.slice(-3)).forEach(([k, r]) => console.log(`   rad ${k}:`, JSON.stringify(r).slice(0, 300)));
  });
}
