import * as cheerio from "cheerio";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const clean = s => String(s ?? "").replace(/ /g, " ").replace(/\s+/g, " ").trim();
for (const k of ["MediaGameSummary", "OfficialGameReport"]) {
  const r = await fetch(`https://stats.swehockey.se/Game/Reports/${k}/1110059`, { headers: { "user-agent": UA } });
  const ct = r.headers.get("content-type"); const buf = Buffer.from(await r.arrayBuffer());
  console.log("== ", k, r.status, ct, buf.length);
  const txt = clean(cheerio.load(buf.toString("utf8"))("body").text());
  const i = txt.search(/TOI|Time on ice|Istid/i); console.log(" toi-index", i, txt.slice(Math.max(0, i - 200), i + 600));
  const f = txt.indexOf("Forsberg"); console.log(" forsberg", txt.slice(Math.max(0, f - 150), f + 250));
}
