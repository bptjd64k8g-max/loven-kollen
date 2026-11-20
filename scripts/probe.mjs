import { chromium } from "playwright";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const s = await (await fetch("https://www.shl.se/api/site/settings", { headers: { "user-agent": UA } })).text();
console.log("SETTINGS stat:", [...new Set(s.match(/[a-zA-Z0-9_\-/.:]*stat[a-zA-Z0-9_\-/.:?=&]*/gi) || [])].slice(0, 40).join("  "));
console.log("SETTINGS uuids:", [...new Set(s.match(/"(?:ssgtUuid|seasonUuid|currentSeason|seriesUuid)"\s*:\s*"[^"]+"/g) || [])].slice(0, 10));
const b = await chromium.launch(); const p = await b.newPage({ userAgent: UA });
const hits = [];
p.on("response", async r => { const u = r.url(); if (!/shl\.se\/api/.test(u) || /settings|sponsor|layouts/.test(u)) return; try { const t = await r.text(); hits.push([u, t.length, /toi|timeOnIce/i.test(t), t.slice(0, 400)]); } catch {} });
for (const u of ["https://www.shl.se/statistik/spelare", "https://www.shl.se/lag/if-bjorkloven/statistik", "https://www.shl.se/lag/if-bjorkloven/trupp"]) {
  await p.goto(u, { waitUntil: "domcontentloaded", timeout: 60000 }).catch(e => console.log("goto", e.message));
  await p.waitForTimeout(12000);
  const txt = await p.evaluate(() => document.body.innerText);
  const i = txt.search(/TOI/); console.log("== ", u, txt.length, "TOI at", i, txt.slice(Math.max(0, i - 300), i + 500).replace(/\n/g, " | "));
}
for (const h of hits) console.log("API", h[0].slice(0, 300), h[1], h[2] ? "TOI!" : "", h[3].replace(/\s+/g, " ").slice(0, 300));
await b.close();
