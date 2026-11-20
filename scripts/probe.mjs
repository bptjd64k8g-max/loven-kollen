import { chromium } from "playwright";
const b = await chromium.launch(); const p = await b.newPage();
const hits = [];
p.on("response", async r => {
  const u = r.url(); const ct = r.headers()["content-type"] || "";
  if (!/json/.test(ct)) return;
  try { const t = await r.text(); const toi = /toi|timeOnIce|TOI/i.test(t); hits.push([u, t.length, toi, toi ? t.slice(Math.max(0, t.search(/toi|timeOnIce/i) - 300), t.search(/toi|timeOnIce/i) + 300) : ""]); } catch {}
});
for (const u of ["https://www.shl.se/statistik/spelare", "https://www.shl.se/lag/if-bjorkloven"]) {
  await p.goto(u, { waitUntil: "networkidle", timeout: 60000 }).catch(e => console.log("goto", e.message));
  await p.waitForTimeout(4000);
  const txt = await p.evaluate(() => document.body.innerText);
  console.log("== ", u, "TOI in page:", /TOI/.test(txt), txt.slice(txt.indexOf("TOI") - 200, txt.indexOf("TOI") + 400).replace(/\n/g, " | "));
  const links = await p.evaluate(() => [...document.querySelectorAll("a")].map(a => a.href).filter(h => /statistik|spelare|bjorkloven/i.test(h)).slice(0, 25));
  console.log(" links:", links.join("  "));
}
for (const h of hits) console.log("JSON", h[0].slice(0, 220), h[1], h[2] ? "TOI!" : "", h[3].replace(/\s+/g, " ").slice(0, 600));
await b.close();
