import * as cheerio from "cheerio";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const clean = s => String(s ?? "").replace(/ /g, " ").replace(/\s+/g, " ").trim();
const r = await fetch("https://stats.swehockey.se/Game/Reports/1110059", { headers: { "user-agent": UA } });
const html = await r.text(); const $ = cheerio.load(html);
console.log("REPORTS", html.length, clean($("body").text()).slice(0, 800));
$("a[href],iframe[src]").each((_, a) => { const h = $(a).attr("href") || $(a).attr("src"); if (!/ScheduleAndResults|Players\/|Teams\/|javascript:void/.test(h)) console.log("  L", h, "::", clean($(a).text()).slice(0, 40)); });
for (const m of html.matchAll(/https?:\/\/[^"' )]+\.pdf/gi)) console.log("  PDF", m[0]);
