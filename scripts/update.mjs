// Hämtar färsk data om IF Björklöven och skriver data.json.
// Varje källa körs för sig: misslyckas en behålls förra värdet, och resten uppdateras ändå.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import * as cheerio from "cheerio";

const DATA = "data.json";
const CONFIG = existsSync("config.json") ? JSON.parse(readFileSync("config.json", "utf8")) : {};
const old = JSON.parse(readFileSync(DATA, "utf8"));
const D = structuredClone(old);
const status = {};
const log = (...a) => console.log(...a);

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const cache = new Map();
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function get(url) {
  if (cache.has(url)) return cache.get(url);
  let last;
  for (let i = 0; i < 3; i++) {
    try { const t = await fetchOnce(url); cache.set(url, t); return t; }
    catch (e) { last = e; if (!/HTTP (429|5\d\d)|abort|fetch failed/i.test(e.message)) break; await sleep(4000 * (i + 1)); }
  }
  throw last;
}
async function fetchOnce(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 25000);
  try {
    const r = await fetch(url, { headers: { "user-agent": UA, "accept-language": "sv-SE,sv;q=0.9,en;q=0.5" }, signal: ctrl.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status} från ${url}`);
    return await r.text();
  } finally { clearTimeout(t); }
}
const clean = s => String(s ?? "").replace(/ /g, " ").replace(/\s+/g, " ").trim();
const num = s => { const m = clean(s).replace("−", "-").replace("–", "-").match(/^[+-]?\d+(?:[.,]\d+)?/); return m ? Number(m[0].replace(",", ".")) : NaN; };
const fold = s => clean(s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

// Alla tabeller på en sida som {headers, rows}. Tabeller i tabeller (som på swehockey) läses var för sig,
// och en rad som ser ut som rubriker (t.ex. "Rk, No, Name, Team, GP") startar en ny tabell.
const HEADER_WORDS = new Set(["Lag", "Name", "Namn", "Team", "GP", "S", "P", "TP", "GAA", "Rk"]);
function tables($) {
  const out = [];
  $("table").each((_, t) => {
    const trs = $(t).children("thead,tbody,tfoot").children("tr").add($(t).children("tr")).toArray();
    const rows = trs.map(tr => $(tr).children("td,th").toArray().map(c => clean($(c).text()))).filter(r => r.length > 1);
    if (!rows.length) return;
    out.push({ headers: rows[0], rows: rows.slice(1) });
    rows.forEach((r, i) => {
      if (i > 0 && r.length >= 4 && r.filter(c => HEADER_WORDS.has(c)).length >= 2) {
        const next = rows.slice(i + 1);
        const end = next.findIndex(x => x.length >= 4 && x.filter(c => HEADER_WORDS.has(c)).length >= 2);
        out.push({ headers: r, rows: end < 0 ? next : next.slice(0, end) });
      }
    });
  });
  return out;
}
const col = (headers, ...names) => headers.findIndex(h => names.some(n => h.replace("−", "-") === n));

// Lagnamn så som sidan visar dem
const TEAMS = [
  ["farjestad", "Färjestad BK", "Färjestad BK"], ["frolunda", "Frölunda HC", "Frölunda HC"],
  ["skelleftea", "Skellefteå AIK", "Skellefteå AIK"], ["orebro", "Örebro HK", "Örebro HK"],
  ["malmo", "IF Malmö Redhawks", "IF Malmö Redhawks"], ["brynas", "Brynäs IF", "Brynäs IF"],
  ["vaxjo", "Växjö Lakers HC", "Växjö Lakers"], ["rogle", "Rögle BK", "Rögle BK"],
  ["lulea", "Luleå HF", "Luleå HF"], ["timra", "Timrå IK", "Timrå IK"],
  ["djurgarden", "Djurgårdens IF", "Djurgårdens IF"], ["linkoping", "Linköping HC", "Linköping HC"],
  ["bjorkloven", "IF Björklöven", "IF Björklöven"], ["hv", "HV 71", "HV 71"]
];
function team(name, kind = "table") {
  const f = fold(name);
  const t = TEAMS.find(([k]) => k === "hv" ? /\bhv\b|hv71/.test(f) : f.includes(k) || (k === "djurgarden" && f.includes("djurgard")));
  return t ? (kind === "table" ? t[1] : t[2]) : null;
}
const isUs = n => fold(n).includes("bjorkloven");

async function source(name, fn) {
  try { await fn(); status[name] = "ok"; log(`✓ ${name}`); }
  catch (e) { status[name] = `fel: ${e.message}`.slice(0, 200); log(`✗ ${name}: ${e.message}`); }
}

/* 1. Tabellen */
await source("tabell", async () => {
  const tries = [
    async () => {
      const $ = cheerio.load(await get("https://www.hockeytabeller.se/shl"));
      for (const { headers, rows } of tables($)) {
        const iT = col(headers, "Lag"), iS = col(headers, "S"), iV = col(headers, "V"), iF = col(headers, "F"),
          iOV = col(headers, "ÖTV"), iOF = col(headers, "ÖTF"), iD = col(headers, "+/-"), iP = col(headers, "P");
        if ([iT, iS, iV, iF, iOV, iOF, iD, iP].some(i => i < 0)) continue;
        const t = rows.map(r => [team(r[iT]), num(r[iS]), num(r[iV]), num(r[iOV]), num(r[iOF]), num(r[iF]), num(r[iD]), num(r[iP])]);
        if (t.length === 14 && t.every(r => r[0] && r.slice(1).every(Number.isFinite))) return t;
      }
      throw new Error("hittade ingen tabell på hockeytabeller.se");
    },
    async () => {
      const $ = cheerio.load(await get("https://sportstatistik.nu/hockey/shl/tabell"));
      for (const { headers, rows } of tables($)) {
        const iT = col(headers, "Lag"), iGP = col(headers, "GP"), iW = col(headers, "W"), iL = col(headers, "L"),
          iOW = col(headers, "OTW"), iOL = col(headers, "OTL"), iD = col(headers, "+/-"), iP = col(headers, "P");
        if ([iT, iGP, iW, iL, iOW, iOL, iD, iP].some(i => i < 0)) continue;
        const t = rows.map(r => [team(r[iT]), num(r[iGP]), num(r[iW]), num(r[iOW]), num(r[iOL]), num(r[iL]), num(r[iD]), num(r[iP])]);
        if (t.length === 14 && t.every(r => r[0] && r.slice(1).every(Number.isFinite))) return t;
      }
      throw new Error("hittade ingen tabell på sportstatistik.nu");
    }
  ];
  let lastErr;
  for (const tr of tries) { try { D.table = await tr(); return; } catch (e) { lastErr = e; log("  ", e.message); } }
  throw lastErr;
});

/* 2. Spelschema och resultat */
let times = {}; // datum -> "HH:MM"
await source("tider", async () => {
  const MON = { jan: 1, feb: 2, mar: 3, mars: 3, apr: 4, april: 4, maj: 5, jun: 6, juni: 6, jul: 7, juli: 7, aug: 8, sep: 9, okt: 10, nov: 11, dec: 12 };
  const ymd = (d, m) => { const mo = MON[m]; const y = mo >= 7 ? 2026 : 2027; return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`; };
  try {
    const text = clean(cheerio.load(await get("https://www.hockeytabeller.se/shl/lag/if-bjorkloven"))("body").text());
    const re = /(?:mån|tis|ons|tors|fre|lör|sön)\s+(\d{1,2})\s+(jan|feb|mars?|apr(?:il)?|maj|juni?|juli?|aug|sep|okt|nov|dec)\.?\s+[HB]\s*.{2,30}?\s+(\d{1,2}):(\d{2})/g;
    for (const m of text.matchAll(re)) times[ymd(+m[1], m[2])] = `${m[3].padStart(2, "0")}:${m[4]}`;
  } catch (e) { log("   hockeytabeller:", e.message); }
  try {
    const $ = cheerio.load(await get("https://www.betbuilders.ai/hockey/shl/lag/if-bjorkloven"));
    $("a[href*='/hockey/shl/']").each((_, a) => {
      const href = $(a).attr("href") || "";
      const m = href.match(/(\d{4}-\d{2}-\d{2})\/?$/);
      const t = clean($(a).text()).match(/\b(\d{1,2}):(\d{2})\b/);
      if (m && t && href.includes("bjorkloven")) times[m[1]] = `${t[1].padStart(2, "0")}:${t[2]}`;
    });
  } catch (e) { log("   betbuilders:", e.message); }
  log("   tider:", JSON.stringify(times));
  if (!Object.keys(times).length) throw new Error("inga matchtider hittades");
});

await source("schema", async () => {
  const $ = cheerio.load(await get("https://sportstatistik.nu/hockey/shl/spelschema/if-bjorkloven"));
  const games = [];
  for (const { headers, rows } of tables($)) {
    for (const r of [headers, ...rows]) {
      if (r.length < 4 || !/^\d{4}-\d{2}-\d{2}$/.test(r[0])) continue;
      const [date, home, score, away] = r;
      const homeUs = isUs(home);
      if (!homeUs && !isUs(away)) continue;
      const opp = team(homeUs ? away : home, "opp");
      if (!opp) continue;
      const s = score.replace(/[–—−]/g, "-").match(/(\d+)\s*-\s*(\d+)/);
      games.push({ date, ha: homeUs ? "H" : "B", opp, us: s ? Number(homeUs ? s[1] : s[2]) : null, them: s ? Number(homeUs ? s[2] : s[1]) : null });
    }
  }
  if (games.length < 40) throw new Error(`för få matcher (${games.length})`);
  const oldRes = Object.fromEntries(old.results.map(r => [r[0], r]));
  const oldUp = Object.fromEntries(old.upcoming.map(u => [u[0], u]));
  games.sort((a, b) => a.date.localeCompare(b.date));
  D.results = games.filter(g => g.us !== null).map(g => [g.date, g.ha, g.opp, g.us, g.them, oldRes[g.date]?.[5] ?? false]);
  D.upcoming = games.filter(g => g.us === null).map(g => [g.date, times[g.date] || oldUp[g.date]?.[1] || null, g.ha, g.opp, oldUp[g.date]?.[4] || ""]);
});

/* 3. Spelarstatistik från stats.swehockey.se */
await source("spelare", async () => {
  let id = CONFIG.swehockeyLeagueId;
  if (!id) {
    const $ = cheerio.load(await get("https://stats.swehockey.se/"));
    const cands = [];
    $("a[href]").each((_, a) => {
      const m = ($(a).attr("href") || "").match(/\/(\d{4,6})(?:$|[/?#])/);
      const txt = clean($(a).text());
      if (m && /\bSHL\b/i.test(txt)) log(`   swehockey-länk: "${txt}" ${$(a).attr("href")}`);
      if (m && /^SHL(\s*\(\d+\))?$/i.test(txt)) cands.push(Number(m[1]));
    });
    if (!cands.length) throw new Error("hittade inget SHL-id på stats.swehockey.se – sätt swehockeyLeagueId i config.json");
    id = Math.max(...cands);
    log(`   SHL-id på swehockey: ${id}`);
  }
  const html = await get(`https://stats.swehockey.se/Players/Statistics/ScoringLeaders/${id}`);
  const $ = cheerio.load(html);
  const bodyText = clean($("body").text());
  const code = (bodyText.match(/\b([A-ZÅÄÖ0-9]{2,5})\s*[-–]\s*(?:IF\s*)?Björklöven/) || [])[1];
  const near = bodyText.indexOf("Björklöven");
  if (near >= 0) log("   runt Björklöven:", bodyText.slice(Math.max(0, near - 60), near + 40));
  const codes = new Set([code, "IFB", "BJÖ", "BJO", "IF Björklöven", "Björklöven"].filter(Boolean));
  const players = [];
  for (const { headers, rows } of tables($)) {
    const iN = col(headers, "Name", "Namn"), iT = col(headers, "Team", "Lag"), iGP = col(headers, "GP"), iG = col(headers, "G"), iA = col(headers, "A");
    if ([iN, iT, iGP, iG, iA].some(i => i < 0)) continue;
    for (const r of rows) {
      if (!codes.has(r[iT])) continue;
      const nm = r[iN].includes(",") ? r[iN].split(",").map(clean).reverse().join(" ") : r[iN];
      players.push([nm, "", num(r[iGP]), num(r[iG]), num(r[iA])]);
    }
    if (players.length) break;
  }
  if (players.length < 8) {
    log(`   kod: ${code}; ${tables($).length} tabeller`);
    tables($).slice(0, 6).forEach(t => log("   rubriker:", JSON.stringify(t.headers).slice(0, 200), "rad:", JSON.stringify(t.rows[0] || []).slice(0, 200)));
    log("   text:", clean($("body").text()).slice(0, 600));
  }
  if (players.length < 8) throw new Error(`för få Björklöven-spelare (${players.length}) på ScoringLeaders/${id}`);
  D.players = players.map(fixName);

  // Målvakter: försök, men fäll inte allt om sidan saknas
  try {
    const g$ = cheerio.load(await get(`https://stats.swehockey.se/Players/Statistics/GoalkeeperLeaders/${id}`));
    const goalies = [];
    for (const { headers, rows } of tables(g$)) {
      const iN = col(headers, "Name", "Namn"), iT = col(headers, "Team", "Lag"), iGP = col(headers, "GPI", "GP"),
        iSV = headers.findIndex(h => /SVS%|SV%|Sv%/i.test(h)), iGAA = col(headers, "GAA");
      if ([iN, iT, iGP, iSV, iGAA].some(i => i < 0)) continue;
      for (const r of rows) if (codes.has(r[iT])) {
        const nm = r[iN].includes(",") ? r[iN].split(",").map(clean).reverse().join(" ") : r[iN];
        goalies.push([nm, num(r[iGP]), r[iSV].replace(".", ","), r[iGAA].replace(".", ",")]);
      }
      if (goalies.length) break;
    }
    if (goalies.length) D.goalies = goalies.map(g => [fixName([g[0]])[0], ...g.slice(1)]);
    else log("   inga målvaktssiffror hittades");
  } catch (e) { log("   målvakter:", e.message); }
});

// Byt till truppens stavning (Kovács i stället för Kovacs) och sätt position från truppen
function fixName(p) {
  const all = Object.entries(D.roster).flatMap(([pos, list]) => list.map(x => [x[1], pos]));
  const hit = all.find(([n]) => fold(n) === fold(p[0]) || fold(n).replace(/ /g, "") === fold(p[0]).replace(/ /g, ""));
  const short = { "Målvakter": "MV", "Backar": "B", "Centrar": "C", "Forwards": "F" };
  if (!hit) return p;
  const out = [...p]; out[0] = hit[0]; if (out.length > 4) out[1] = short[hit[1]] || out[1];
  return out;
}

/* 4. Lagets nyckeltal från BetBuilders */
await source("nyckeltal", async () => {
  const nums = [];
  const team$ = cheerio.load(await get("https://www.betbuilders.ai/hockey/shl/lag/if-bjorkloven"));
  const want = [
    ["Mål/match", "mål per match"], ["Insläppta/match", "insläppta per match"],
    ["Räddningsprocent", "räddningsprocent"], ["Skott på mål/match", "skott på mål per match"],
    ["Skott mot/match", "skott emot per match"], ["xG/match", "xG per match"], ["xGA/match", "xG emot per match"]
  ];
  const found = {};
  for (const { rows } of tables(team$)) for (const r of rows) {
    const w = want.find(([k]) => r[0].startsWith(k));
    const rank = (r.find(c => /^#\d+$/.test(c)) || "").slice(1);
    if (w && !found[w[1]]) found[w[1]] = [r[1], w[1], rank ? Number(rank) : null];
  }
  // PP, boxplay och tekningar från ligatabellen, med placering räknad bland 14 lag
  try {
    const l$ = cheerio.load(await get("https://www.betbuilders.ai/hockey/shl/statistik"));
    for (const { headers, rows } of tables(l$)) {
      const iL = col(headers, "Lag"), iPP = col(headers, "PP %"), iPK = col(headers, "PK %"), iTE = col(headers, "TEK %");
      if ([iL, iPP, iPK].some(i => i < 0) || rows.length < 14) continue;
      const rankOf = i => { const vals = rows.map(r => num(r[i])); const me = rows.find(r => isUs(r[iL])); if (!me) return null; return vals.filter(v => v > num(me[i])).length + 1; };
      const me = rows.find(r => isUs(r[iL]));
      if (!me) continue;
      found["powerplay"] = [me[iPP], "powerplay", rankOf(iPP)];
      found["boxplay"] = [me[iPK], "boxplay", rankOf(iPK)];
      if (iTE >= 0) found["vunna tekningar"] = [me[iTE], "vunna tekningar", rankOf(iTE)];
      break;
    }
  } catch (e) { log("   ligatabell:", e.message); }
  const order = ["mål per match", "insläppta per match", "powerplay", "boxplay", "räddningsprocent", "skott på mål per match", "skott emot per match", "vunna tekningar", "xG per match", "xG emot per match"];
  for (const k of order) if (found[k]) nums.push(found[k]);
  if (nums.length < 5) throw new Error(`bara ${nums.length} nyckeltal hittades`);
  D.nums = nums;
});

/* 5. Nyheter och silly via Google News */
await source("nyheter", async () => {
  const xml = await get("https://news.google.com/rss/search?q=Bj%C3%B6rkl%C3%B6ven+hockey&hl=sv&gl=SE&ceid=SE:sv");
  const $ = cheerio.load(xml, { xmlMode: true });
  const rules = [
    ["rykte", /uppgifter|rykte|aktuell för|jagar (en |ny )?(back|forward|center|målvakt|förstärkning|spelare)|intresserad|kan lämna|nära (en |att )|på väg (till|från)|vill värva/i],
    ["klart", /klar för|klart:|officiellt|värvar|förlänger|skriver på|presenterar|återvänder|lämnar|bryter kontraktet/i],
    ["skada", /skad|missar|borta (i|minst|resten)|opererad|sjukskriv|tillbaka i spel|comeback/i],
    ["besked", /kenttä|bogren|sportchef|tränaren|kaptenen|krismöte/i]
  ];
  const items = [];
  $("item").each((_, it) => {
    const full = clean($(it).find("title").text());
    const src = clean($(it).find("source").text()) || (full.match(/ - ([^-]+)$/) || [])[1] || "Nyhet";
    const title = full.endsWith(" - " + src) ? full.slice(0, -(src.length + 3)) : full.replace(/ - [^-]+$/, "");
    const link = clean($(it).find("link").text());
    const d = new Date($(it).find("pubDate").text());
    if (!link || isNaN(d)) return;
    if (/^inför match/i.test(title)) return;
    const rule = rules.find(([, re]) => re.test(title));
    if (!rule) return; // matchreferat och annat brus hoppas över
    items.push([d.toISOString().slice(0, 10), rule[0], title, "", src, link]);
  });
  const seen = new Set();
  const merged = [...items, ...old.feed]
    .filter(f => { const k = fold(f[2]).slice(0, 60); if (seen.has(k)) return false; seen.add(k); return true; })
    .sort((a, b) => b[0].localeCompare(a[0]))
    .slice(0, 40);
  D.feed = merged;
  log(`   ${items.length} nya relevanta rubriker`);
});

/* Text under statistiken */
{
  const gp = D.table.find(t => t[0] === "IF Björklöven")?.[1];
  const m = D.nums.find(n => n[1] === "mål per match"), i = D.nums.find(n => n[1] === "insläppta per match");
  if (gp && m && i) D.statnote = `Efter ${gp} omgångar. Björklöven är ${m[2] ?? "–"}:a i ligan på gjorda mål per match och ${i[2] ?? "–"}:a på insläppta.`;
}

/* Spara bara om något faktiskt ändrats */
const body = o => { const { updated, updatedText, sources, ...rest } = o; return JSON.stringify(rest); };
const hash = o => createHash("sha1").update(body(o)).digest("hex");
log("\nKällor:", status);
if (hash(D) === hash(old)) { log("Inga ändringar."); process.exit(0); }
const now = new Date();
D.updated = now.toISOString();
const p = Object.fromEntries(new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Stockholm", day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" }).formatToParts(now).map(x => [x.type, x.value]));
D.updatedText = `${p.day} ${p.month} ${p.year}, kl. ${p.hour}.${p.minute}`;
D.sources = status;
writeFileSync(DATA, JSON.stringify(D, null, 1) + "\n");
log("data.json uppdaterad.");
