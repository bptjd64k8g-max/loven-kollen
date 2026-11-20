const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
for (const u of ["https://www.shl.se/statistik/spelare", "https://www.shl.se/lag/if-bjorkloven", "https://www.shl.se/"]) {
  try {
    const r = await fetch(u, { headers: { "user-agent": UA } }); const t = await r.text();
    console.log("== ", u, r.status, t.length, "TOI:", (t.match(/TOI[^"<]{0,20}/g) || []).slice(0, 5));
    console.log(" api:", [...new Set(t.match(/https?:\/\/[a-z0-9.-]*(api|sportality|playmaker|statnet)[a-z0-9./_-]*/gi) || [])].slice(0, 15));
    console.log(" paths:", [...new Set(t.match(/\/api\/[a-z0-9_\/-]+/gi) || [])].slice(0, 25));
    const nd = t.match(/__NEXT_DATA__[^>]*>(.{0,600})/s); if (nd) console.log(" next:", nd[1]);
    const ids = t.match(/"(?:uuid|teamId|seasonUuid|ssgtUuid)":"[^"]+"/g); if (ids) console.log(" ids:", [...new Set(ids)].slice(0, 15));
  } catch (e) { console.log(u, e.message); }
}
