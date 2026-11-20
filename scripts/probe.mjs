import { writeFileSync } from "node:fs"; import { execSync } from "node:child_process";
const UA = "Mozilla/5.0";
for (const k of ["MediaGameSummary", "OfficialGameReport"]) {
  const r = await fetch(`https://stats.swehockey.se/Game/Reports/${k}/1110059`, { headers: { "user-agent": UA } });
  writeFileSync(`/tmp/${k}.pdf`, Buffer.from(await r.arrayBuffer()));
  try { const t = execSync(`pdftotext -layout /tmp/${k}.pdf - | head -c 20000`).toString(); console.log("== ", k, t.length); const i = t.search(/TOI|Time On Ice|Istid/i); console.log(t.slice(0, 1500)); console.log("--- toi at", i, t.slice(Math.max(0,i-300), i+2500)); }
  catch (e) { console.log(k, "pdftotext:", e.message.slice(0, 200)); }
}
