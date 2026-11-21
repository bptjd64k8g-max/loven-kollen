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
const SWE = "https://stats.swehockey.se";

/* ---------- hjälpfunktioner ---------- */
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const cache = new Map();
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function fetchOnce(url, ms = 25000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(url, { headers: { "user-agent": UA, "accept-language": "sv-SE,sv;q=0.9,en;q=0.5" }, signal: ctrl.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status} från ${url}`);
    return await r.text();
  } finally { clearTimeout(t); }
}
async function get(url) {
  if (cache.has(url)) return cache.get(url);
  let last;
  for (let i = 0; i < 3; i++) {
    try { const t = await fetchOnce(url); cache.set(url, t); return t; }
    catch (e) { last = e; if (!/HTTP (429|5\d\d)|abort|fetch failed/i.test(e.message)) break; await sleep(4000 * (i + 1)); }
  }
  throw last;
}
const page = async url => cheerio.load(await get(url));
const clean = s => String(s ?? "").replace(/ /g, " ").replace(/\s+/g, " ").trim();
const num = s => { const m = clean(s).replace(/[−–]/g, "-").match(/^[+-]?\d+(?:[.,]\d+)?/); return m ? Number(m[0].replace(",", ".")) : NaN; };
const fold = s => clean(s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const sv = (x, d = 2) => Number(x).toFixed(d).replace(".", ",");
// Svensk lokal tid -> tidsstämpel (sommartid sista söndagen i mars till sista söndagen i oktober)
function stockholm(date, time) {
  const [y, m, d] = date.split("-").map(Number), [hh, mm] = time.split(":").map(Number);
  const lastSun = mo => { const x = new Date(Date.UTC(y, mo, 0)); return x.getUTCDate() - x.getUTCDay(); };
  const summer = (m > 3 && m < 10) || (m === 3 && d >= lastSun(3)) || (m === 10 && d < lastSun(10));
  return Date.UTC(y, m - 1, d, hh - (summer ? 2 : 1), mm);
}

// Raderna i en tabell (bara dess egna rader, inte inbäddade tabellers)
const rowsOf = ($, t) => $(t).children("thead,tbody,tfoot").children("tr").add($(t).children("tr")).toArray()
  .map(tr => $(tr).children("td,th").toArray().map(c => clean($(c).text())));

// Hitta rubrikraden (t.ex. ["Rk","Team","GP",...]) och returnera {h: kolumnindex, rows: raderna under}
function headed(rows, must) {
  const i = rows.findIndex(r => must.every(m => r.includes(m)));
  if (i < 0) return null;
  const h = Object.fromEntries(rows[i].map((c, k) => [c, k]));
  return { h, rows: rows.slice(i + 1).filter(r => r.length >= rows[i].length - 1) };
}

// Lagnamn som sidan använder: [nyckel, namn i tabellen, namn som motståndare]
const TEAMS = [
  ["farjestad", "Färjestad BK", "Färjestad BK"], ["frolunda", "Frölunda HC", "Frölunda HC"],
  ["skelleftea", "Skellefteå AIK", "Skellefteå AIK"], ["orebro", "Örebro HK", "Örebro HK"],
  ["malmo", "IF Malmö Redhawks", "IF Malmö Redhawks"], ["brynas", "Brynäs IF", "Brynäs IF"],
  ["vaxjo", "Växjö Lakers HC", "Växjö Lakers"], ["rogle", "Rögle BK", "Rögle BK"],
  ["lulea", "Luleå HF", "Luleå HF"], ["timra", "Timrå IK", "Timrå IK"],
  ["djurgard", "Djurgårdens IF", "Djurgårdens IF"], ["linkoping", "Linköping HC", "Linköping HC"],
  ["bjorkloven", "IF Björklöven", "IF Björklöven"], ["hv", "HV 71", "HV 71"]
];
function team(name, kind = "table") {
  const f = fold(name);
  const t = TEAMS.find(([k]) => k === "hv" ? /\bhv\b|hv71/.test(f) : f.includes(k));
  return t ? (kind === "table" ? t[1] : t[2]) : null;
}
const isUs = n => fold(n).includes("bjorkloven") || clean(n) === "IFB";

async function source(name, fn) {
  try { await fn(); status[name] = "ok"; log(`✓ ${name}`); }
  catch (e) { status[name] = `fel: ${e.message}`.slice(0, 200); log(`✗ ${name}: ${e.message}`); }
}

// SHL:s id på swehockey för innevarande säsong
let LEAGUE = CONFIG.swehockeyLeagueId;
async function league() {
  if (LEAGUE) return LEAGUE;
  const $ = await page(`${SWE}/`);
  const ids = [];
  $("a[href]").each((_, a) => {
    const m = ($(a).attr("href") || "").match(/ScheduleAndResults\/\w+\/(\d+)/);
    if (m && /^SHL$/i.test(clean($(a).text()))) ids.push(Number(m[1]));
  });
  if (!ids.length) throw new Error("hittade inte SHL på stats.swehockey.se – sätt swehockeyLeagueId i config.json");
  LEAGUE = Math.max(...ids);
  log(`   SHL på swehockey: ${LEAGUE}`);
  return LEAGUE;
}

/* ---------- 1. Tabellen ---------- */
await source("tabell", async () => {
  const valid = t => t.length === 14 && t.every(r => r[0] && r.slice(1).every(Number.isFinite)) && new Set(t.map(r => r[0])).size === 14;
  try {
    const $ = await page("https://www.hockeytabeller.se/shl");
    for (const t of $("table").toArray()) {
      const x = headed(rowsOf($, t), ["Lag", "S", "V", "F", "P"]);
      if (!x) continue;
      const { h } = x, d = h["+/−"] ?? h["+/-"];
      const tab = x.rows.map(r => [team(r[h.Lag]), num(r[h.S]), num(r[h.V]), num(r[h["ÖTV"]]), num(r[h["ÖTF"]]), num(r[h.F]), num(r[d]), num(r[h.P])]);
      if (valid(tab)) { D.table = tab; return; }
    }
    throw new Error("ingen tabell på hockeytabeller.se");
  } catch (e) {
    log("   ", e.message, "– provar sportstatistik.nu");
    const $ = await page("https://sportstatistik.nu/hockey/shl/tabell");
    for (const t of $("table").toArray()) {
      const x = headed(rowsOf($, t), ["Lag", "GP", "W", "L", "P"]);
      if (!x) continue;
      const { h } = x;
      const tab = x.rows.map(r => [team(r[h.Lag]), num(r[h.GP]), num(r[h.W]), num(r[h.OTW]), num(r[h.OTL]), num(r[h.L]), num(r[h["+/-"]]), num(r[h.P])]);
      if (valid(tab)) { D.table = tab; return; }
    }
    throw new Error("ingen tabell hittades");
  }
});

/* ---------- 2. Spelschema och resultat ---------- */
await source("schema", async () => {
  const $ = await page(`${SWE}/ScheduleAndResults/Schedule/${await league()}`);
  const games = [], crowds = {}; // crowds: hemmalag -> lista med publiksiffror
  for (const t of $("table").toArray()) {
    let date = null;
    for (const r of rowsOf($, t)) {
      if (/^\d{4}-\d{2}-\d{2}$/.test(r[0])) date = r[0];
      if (!date || r.length < 6) continue;
      const game = r[3] || "", m = game.split(/\s+-\s+/);
      const spect = /^\d+$/.test(r[6] || "") ? +r[6] : null;
      if (m.length === 2 && spect && /\d+\s*-\s*\d+/.test(r[4] || "")) { const ht = team(m[0]); if (ht) (crowds[ht] ||= []).push(spect); }
      if (m.length !== 2 || !(isUs(m[0]) || isUs(m[1]))) continue;
      const home = isUs(m[0]), opp = team(home ? m[1] : m[0], "opp");
      if (!opp) continue;
      const time = (r[2] || "").match(/^\d{1,2}:\d{2}$/) ? r[2].padStart(5, "0") : null;
      const s = (r[4] || "").match(/(\d+)\s*-\s*(\d+)/);
      const periods = ((r[5] || "").match(/\d+-\d+/g) || []).length;
      const venue = r[r.length - 1];
      // Ett resultat räknas som slutligt först när matchen rimligen är slut – annars är det en pågående ställning
      const start = stockholm(date, time || "19:00"), mins = (Date.now() - start) / 6e4;
      const final = !!s && ((periods >= 3 && mins > 150) || mins > 240);
      const us = s ? +(home ? s[1] : s[2]) : null, them = s ? +(home ? s[2] : s[1]) : null;
      games.push({ date, time, ha: home ? "H" : "B", opp, us: final ? us : null, them: final ? them : null, live: s && !final ? { us, them, period: Math.max(periods, 1) } : null, ot: periods > 3, venue, spect: final ? spect : null });
    }
    if (games.length) break;
  }
  if (games.length < 40) throw new Error(`för få matcher (${games.length})`);
  const seen = new Set();
  const uniq = games.filter(g => { const k = g.date + g.opp; if (seen.has(k)) return false; seen.add(k); return true; })
    .sort((a, b) => a.date.localeCompare(b.date));
  const oldUp = Object.fromEntries(old.upcoming.map(u => [u[0], u]));
  D.results = uniq.filter(g => g.us !== null).map(g => [g.date, g.ha, g.opp, g.us, g.them, g.ot, g.spect, g.time]);
  // Publiksnitt hemma och placering bland lagen
  const avg = Object.entries(crowds).map(([t, l]) => [t, Math.round(l.reduce((a, b) => a + b, 0) / l.length), l.length]);
  const me = avg.find(a => a[0] === "IF Björklöven");
  if (me) D.attendance = { avg: me[1], games: me[2], rank: avg.filter(a => a[1] > me[1]).length + 1, of: avg.length,
    max: Math.max(...crowds["IF Björklöven"]), league: Math.round(avg.reduce((s, a) => s + a[1], 0) / avg.length) };
  D.upcoming = uniq.filter(g => g.us === null).map(g => {
    const u = [g.date, g.time, g.ha, g.opp, oldUp[g.date]?.[4] || ""];
    if (oldUp[g.date]?.[5] || g.live) u.push(oldUp[g.date]?.[5] || null); // kanal, sändningsstart, biljetter
    if (g.live) u.push(g.live); // pågående ställning
    return u;
  });
  for (const g of uniq) if (g.ha === "B" && g.venue && !/^\d/.test(g.venue)) D.arenas[g.opp] = g.venue;
});

/* ---------- 3. Spelare och målvakter ---------- */
const nameOf = s => s.includes(",") ? s.split(",").map(clean).reverse().join(" ") : clean(s);
// Använd truppens stavning när namnet är samma person (Kovacs → Kovács, Christopher → Chris)
function rosterName(n) {
  const all = Object.values(D.roster).flat().map(x => x[1]);
  const [f, ...rest] = fold(n).split(" "), l = rest.join(" ").replace(/ /g, "");
  const hit = all.find(r => fold(r) === fold(n)) ||
    all.find(r => { const [rf, ...rr] = fold(r).split(" "); return rr.join(" ").replace(/ /g, "") === l && rf[0] === f[0]; });
  return hit || n;
}
const POS = { CE: "C", LD: "B", RD: "B", D: "B", LW: "LW", RW: "RW", F: "F", G: "MV" };

await source("spelare", async () => {
  const $ = await page(`${SWE}/Teams/Info/PlayersByTeam/${await league()}`);
  let current = null; const players = [], goalies = [], numbers = {};
  for (const t of $("table").toArray()) {
    const rows = rowsOf($, t);
    if (!rows.length || rows[0].join(" ").length > 300) continue;
    const head = rows[0].filter(Boolean);
    if (head.length >= 2 && head.slice(0, -1).every(c => c === head[0]) && team(head[0])) current = team(head[0]);
    if (current !== "IF Björklöven") continue;
    const p = headed(rows, ["Name", "Pos", "GP", "G", "A", "TP"]);
    if (p) for (const r of p.rows) {
      if (!r[p.h.Name]) continue;
      const pos = POS[r[p.h.Pos]] || r[p.h.Pos];
      if (pos === "MV" || r[p.h.Pos] === "GK") { numbers[rosterName(nameOf(r[p.h.Name]))] = [r[p.h.No], "Målvakter"]; continue; }
      const name = rosterName(nameOf(r[p.h.Name]));
      numbers[name] = [r[p.h.No], pos === "B" ? "Backar" : pos === "C" ? "Centrar" : "Forwards"];
      players.push([name, pos, num(r[p.h.GP]), num(r[p.h.G]), num(r[p.h.A]), num(r[p.h.PIM]), num(r[p.h["+/-"]]), num(r[p.h.SOG])]);
    }
    const g = headed(rows, ["Name", "GPI", "SVS%", "GAA"]);
    if (g) for (const r of g.rows) {
      if (!r[g.h.Name] || !num(r[g.h.GPI])) continue;
      goalies.push([rosterName(nameOf(r[g.h.Name])), num(r[g.h.GPI]), sv(num(r[g.h["SVS%"]])), sv(num(r[g.h.GAA]))]);
    }
  }
  if (players.length < 10) throw new Error(`för få spelare (${players.length})`);
  D.players = players.filter(p => p[2] > 0);
  // Nya spelare som har spelat men saknas i truppen läggs till automatiskt
  const inRoster = new Set(Object.values(D.roster).flat().map(x => x[1]));
  for (const [name, [no, group]] of Object.entries(numbers)) {
    const played = players.find(p => p[0] === name)?.[2] > 0 || goalies.some(g => g[0] === name);
    if (!inRoster.has(name) && played && D.roster[group]) {
      D.roster[group].push([Number(no) || 0, name]);
      D.roster[group].sort((a, b) => a[0] - b[0]);
      log(`   ny i truppen: ${name} (${group})`);
    }
  }
  if (goalies.length) D.goalies = goalies;
  log(`   ${D.players.length} spelare, ${goalies.length} målvakter`);
});

/* ---------- 3b. Spelarfakta: födelsedatum, längd, vikt, fattning, nation ---------- */
const NATION = { SWE: "Sverige", FIN: "Finland", CAN: "Kanada", USA: "USA", CZE: "Tjeckien", SVK: "Slovakien", LAT: "Lettland", NOR: "Norge", DEN: "Danmark", GER: "Tyskland", SUI: "Schweiz", AUT: "Österrike", RUS: "Ryssland", FRA: "Frankrike", SLO: "Slovenien", BLR: "Belarus", KAZ: "Kazakstan", GBR: "Storbritannien", ITA: "Italien", HUN: "Ungern", POL: "Polen", EST: "Estland", LTU: "Litauen", UKR: "Ukraina" };
await source("spelarfakta", async () => {
  const $ = await page(`${SWE}/Teams/Info/TeamRoster/${await league()}`);
  let current = null, n = 0;
  for (const t of $("table").toArray()) {
    const rows = rowsOf($, t);
    if (!rows.length || rows[0].join(" ").length > 300) continue;
    const head = rows[0].filter(Boolean);
    if (head.length >= 2 && team(head[0])) current = team(head[0]);
    if (current !== "IF Björklöven") continue;
    const x = headed(rows, ["Name", "Birthdate", "Height", "Weight"]);
    if (!x) continue;
    for (const r of x.rows) {
      if (!r[x.h.Name] || !/^\d{4}-\d{2}-\d{2}$/.test(r[x.h.Birthdate])) continue;
      const name = rosterName(nameOf(r[x.h.Name]));
      const nat = (r[x.h["Nationality / Club"]] || "").slice(0, 3);
      const prev = D.bio[name] || [];
      D.bio[name] = [r[x.h.Birthdate], NATION[nat] || nat || prev[1] || "", num(r[x.h.Height]) || prev[2] || null, num(r[x.h.Weight]) || prev[3] || null,
        (r[x.h["L/R"]] || prev[4] || "").replace("L", "V").replace("R", "H"), prev[5] || ""];
      n++;
    }
  }
  if (n < 10) throw new Error(`för få spelare i truppregistret (${n})`);
  log(`   fakta för ${n} spelare`);
});

/* ---------- 4. Lagets nyckeltal ---------- */
await source("nyckeltal", async () => {
  const id = await league();
  const found = {};
  // [värde, etikett, placering]; placering räknas bland lagen, bättre = 1
  const rank = (list, key, higherBetter) => {
    const me = list.find(x => isUs(x.team)); if (!me) return null;
    return list.filter(x => higherBetter ? x[key] > me[key] : x[key] < me[key]).length + 1;
  };
  const teamTable = ($, must) => {
    for (const t of $("table").toArray()) { const x = headed(rowsOf($, t), must); if (x && x.rows.length >= 14) return x; }
    return null;
  };
  {
    const $ = await page(`${SWE}/Teams/Statistics/ScoringAndGoalkeeping/${id}`);
    const sc = teamTable($, ["Team", "GP", "GF", "SOG"]);
    if (sc) {
      const list = sc.rows.map(r => ({ team: r[sc.h.Team], gf: num(r[sc.h.GF]) / num(r[sc.h.GP]), sog: num(r[sc.h.SOG]) / num(r[sc.h.GP]), sg: num(r[sc.h["SG%"]]) }));
      const me = list.find(x => isUs(x.team));
      if (me) {
        found.gf = [sv(me.gf), "mål per match", rank(list, "gf", true)];
        found.sog = [sv(me.sog, 1), "skott på mål per match", rank(list, "sog", true)];
        found.sg = [sv(me.sg, 1) + " %", "skotteffektivitet", rank(list, "sg", true)];
      }
    }
    const gk = teamTable($, ["Team", "GP", "GA", "SVS%"]);
    if (gk) {
      const list = gk.rows.map(r => ({ team: r[gk.h.Team], ga: num(r[gk.h.GA]) / num(r[gk.h.GP]), sa: num(r[gk.h.SOG]) / num(r[gk.h.GP]), svp: num(r[gk.h["SVS%"]]) }));
      const me = list.find(x => isUs(x.team));
      if (me) {
        found.ga = [sv(me.ga), "insläppta per match", rank(list, "ga", false)];
        found.sa = [sv(me.sa, 1), "skott emot per match", rank(list, "sa", false)];
        found.svp = [sv(me.svp, 1) + " %", "räddningsprocent", rank(list, "svp", true)];
      }
    }
  }
  try {
    const $ = await page(`${SWE}/Teams/Statistics/PowerplayAndPenaltyKilling/${id}`);
    const pp = teamTable($, ["Team", "PP%"]);
    if (pp) { const list = pp.rows.map(r => ({ team: r[pp.h.Team], v: num(r[pp.h["PP%"]]) })); const me = list.find(x => isUs(x.team)); if (me) found.pp = [sv(me.v, 1) + " %", "powerplay", rank(list, "v", true)]; }
    const pk = teamTable($, ["Team", "PK%"]);
    if (pk) { const list = pk.rows.map(r => ({ team: r[pk.h.Team], v: num(r[pk.h["PK%"]]) })); const me = list.find(x => isUs(x.team)); if (me) found.pk = [sv(me.v, 1) + " %", "boxplay", rank(list, "v", true)]; }
  } catch (e) { log("   specialteams:", e.message); }
  try {
    const $ = await page(`${SWE}/Teams/Statistics/Faceoffs/${id}`);
    const fo = teamTable($, ["Team", "FO%"]);
    if (fo) { const list = fo.rows.map(r => ({ team: r[fo.h.Team], v: num(r[fo.h["FO%"]]) })); const me = list.find(x => isUs(x.team)); if (me) found.fo = [sv(me.v, 1) + " %", "vunna tekningar", rank(list, "v", true)]; }
  } catch (e) { log("   tekningar:", e.message); }
  const nums = ["gf", "ga", "pp", "pk", "svp", "sog", "sa", "sg", "fo"].filter(k => found[k]).map(k => found[k]);
  if (nums.length < 5) throw new Error(`bara ${nums.length} nyckeltal hittades`);
  D.nums = nums;
});

/* ---------- 5. Nyheter och silly via Google News ---------- */
await source("nyheter", async () => {
  const xml = await get("https://news.google.com/rss/search?q=Bj%C3%B6rkl%C3%B6ven+hockey&hl=sv&gl=SE&ceid=SE:sv");
  const $ = cheerio.load(xml, { xmlMode: true });
  const rules = [
    ["rykte", /uppgifter|rykte|aktuell för|jagar (en |ny )?(back|forward|center|målvakt|förstärkning|spelare)|intresserad|kan lämna|nära (en |att )|på väg (till|från)|vill värva/i],
    ["klart", /klar för|klart:|officiellt|värvar|förlänger|skriver på|presenterar|återvänder|lämnar|bryter kontraktet/i],
    ["skada", /skad|missar|borta (i|minst|resten)|opererad|sjukskriv|tillbaka i spel|comeback/i],
    ["besked", /kenttä|bogren|sportchef|tränaren|kaptenen|krismöte/i]
  ];
  const items = [], all = [];
  $("item").each((_, it) => {
    const full = clean($(it).find("title").text());
    const srcFull = clean($(it).find("source").text()) || "Nyhet";
    const src = srcFull.split(/ [–-] /)[0];
    const title = full.endsWith(" - " + srcFull) ? full.slice(0, -(srcFull.length + 3)) : full.endsWith(" - " + src) ? full.slice(0, -(src.length + 3)) : full;
    const link = clean($(it).find("link").text());
    const d = new Date($(it).find("pubDate").text());
    if (!link || isNaN(d)) return;
    all.push([d.toISOString(), title, src, link]);
    if (/^inför match/i.test(title)) return;
    const rule = rules.find(([, re]) => re.test(title));
    if (rule) items.push([d.toISOString().slice(0, 10), rule[0], title, "", src, link]);
  });
  const seen = new Set();
  D.feed = [...items, ...old.feed]
    .filter(f => { const k = fold(f[2]).slice(0, 60); if (seen.has(k)) return false; seen.add(k); return true; })
    .sort((a, b) => b[0].localeCompare(a[0]))
    .slice(0, 40);
  log(`   ${items.length} relevanta rubriker`);
  // Ingresser: Bing News RSS har en kort text för varje artikel och direktlänk till tidningen
  const blurbs = [];
  try {
    for (const q of ["Bj%C3%B6rkl%C3%B6ven+hockey", "IF+Bj%C3%B6rkl%C3%B6ven", "Bj%C3%B6rkl%C3%B6ven+SHL", "Bj%C3%B6rkl%C3%B6ven+Ume%C3%A5"]) {
    let b$; try { b$ = cheerio.load(await get(`https://www.bing.com/news/search?q=${q}&format=rss&setlang=sv-SE&cc=SE`), { xmlMode: true }); } catch (e) { log("   bing:", e.message); continue; }
    b$("item").each((_, it) => {
      const title = clean(b$(it).find("title").text());
      let link = clean(b$(it).find("link").text());
      const u = link.match(/[?&]url=([^&]+)/); if (u) link = decodeURIComponent(u[1]);
      const text = clean(cheerio.load(b$(it).find("description").text() || "").text());
      const d = new Date(b$(it).find("pubDate").text());
      const src = clean(b$(it).find("News\\:Source, Source").first().text()) || (link.match(/https?:\/\/(?:www\.)?([^/]+)/) || [])[1] || "Nyhet";
      if (title && link && !isNaN(d) && !blurbs.some(x => x.link === link)) blurbs.push({ title, link, text, d, src });
    });
    }
    log(`   bing: ${blurbs.length} artiklar med ingress`);
  } catch (e) { log("   bing:", e.message); }
  const words = s => new Set(fold(s).split(" ").filter(w => w.length > 3));
  const match = t => { const a = words(t); let best = null, score = 0;
    for (const b of blurbs) { const w = words(b.title); const s = [...a].filter(x => w.has(x)).length / Math.max(1, Math.min(a.size, w.size)); if (s > score) { score = s; best = b; } }
    return score >= 0.6 ? best : null; };
  // [tid, rubrik, källa, länk, ingress]
  for (const n of all) { const b = match(n[1]); if (b) { n[4] = b.text; n[3] = b.link; } }
  for (const b of blurbs) if (!all.some(n => match(n[1]) === b) && /bj(ö|o)rkl(ö|o)ven|l(ö|o)ven/i.test(b.title + " " + b.text))
    all.push([b.d.toISOString(), b.title, b.src, b.link, b.text]);
  for (const f of D.feed) { if (!f[3]) { const b = match(f[2]); if (b) f[3] = b.text; } }
  // Alla nyheter till nyhetsfliken, nyast först, max 60 dagar och 30 st
  const cutoff = Date.now() - 60 * 864e5, seenN = new Set();
  const news = [...all, ...(old.news || [])]
    .filter(n => Date.parse(n[0]) > cutoff)
    .filter(n => { const k = fold(n[1]).slice(0, 60); if (seenN.has(k)) return false; seenN.add(k); return true; })
    .sort((a, b) => b[0].localeCompare(a[0])).slice(0, 30);
  // Betalvägg: "(+)"/"Premium" i rubriken, annars artikelns egen öppna märkning (schema.org isAccessibleForFree / content_tier).
  // n[5] = true (låst), false (fri) eller saknas (okänt). Redan kontrollerade länkar kontrolleras inte igen.
  const known = new Map((old.news || []).filter(n => typeof n[5] === "boolean").map(n => [n[3], n[5]]));
  let checks = 0;
  for (const n of news) {
    if (/^\(\+\)|\bpremium\b/i.test(n[1])) { n[4] = n[4] || ""; n[5] = true; continue; }
    if (known.has(n[3])) { n[4] = n[4] || ""; n[5] = known.get(n[3]); continue; }
    if (typeof n[5] === "boolean" || /news\.google\.com/.test(n[3]) || checks >= 12) continue;
    checks++;
    try {
      const h = await fetchOnce(n[3], 8000);
      const locked = /"isAccessibleForFree"\s*:\s*"?false/i.test(h)
        || /<meta[^>]+(?:property|name)=["'](?:article:)?content_tier["'][^>]+content=["']locked/i.test(h)
        || /<meta[^>]+content=["']locked["'][^>]+(?:property|name)=["'](?:article:)?content_tier/i.test(h);
      n[4] = n[4] || ""; n[5] = locked;
    } catch (e) { log(`   betalvägg ${n[2]}: ${e.message}`.slice(0, 160)); }
  }
  log(`   betalvägg: ${checks} artiklar kontrollerade, ${news.filter(n => n[5] === true).length} låsta`);
  if (news.length) D.news = news;
});

/* ---------- 6. TV-kanal och sändningsstart från Hurbras matchguider ---------- */
const SLUG = { "Färjestad BK": "farjestad", "Frölunda HC": "frolunda", "Skellefteå AIK": "skelleftea", "Örebro HK": "orebro", "IF Malmö Redhawks": "malmo",
  "Brynäs IF": "brynas", "Växjö Lakers": "vaxjo", "Rögle BK": "rogle", "Luleå HF": "lulea", "Timrå IK": "timra", "Djurgårdens IF": "djurgarden", "Linköping HC": "linkoping", "HV 71": "hv71" };
const MONTHS = ["januari", "februari", "mars", "april", "maj", "juni", "juli", "augusti", "september", "oktober", "november", "december"];
async function tvFor(date, ha, opp) {
  const [y, m, d] = date.split("-").map(Number), o = SLUG[opp];
  if (!o) return null;
  const pair = ha === "H" ? `bjorkloven-${o}` : `${o}-bjorkloven`;
  const urls = [`https://hurbra.se/${pair}-tv-${d}-${MONTHS[m - 1]}-${y}/`, `https://hurbra.se/${pair}-tv-${d}-${MONTHS[m - 1]}/`];
  for (const url of urls) {
    let $; try { $ = await page(url); } catch { continue; }
    const cells = {};
    $("tr").each((_, tr) => { const c = $(tr).children("td,th").toArray().map(x => clean($(x).text())); if (c.length >= 2) cells[c[0].toLowerCase()] = c[1]; });
    const find = (...keys) => { for (const [k, v] of Object.entries(cells)) if (keys.some(x => k.includes(x))) return v; return null; };
    let kanal = find("tv-kanal", "vilken tv-kanal", "kanal");
    const stream = find("streaming", "stream", "var kan matchen streamas");
    const startTxt = find("sändningsstart", "när börjar sändningen", "sändningen börjar");
    if (kanal && stream && !kanal.toLowerCase().includes(stream.toLowerCase())) kanal = `${kanal} och ${stream}`;
    const st = (startTxt || "").match(/(\d{1,2})[.:](\d{2})/);
    if (kanal || st) return { kanal: kanal || undefined, start: st ? `${st[1].padStart(2, "0")}:${st[2]}` : undefined, kalla: url };
  }
  return null;
}
await source("tv", async () => {
  const soon = D.upcoming.filter(u => { const t = stockholm(u[0], u[1] || "19:00"); return t > Date.now() - 3 * 36e5 && t < Date.now() + 2 * 864e5; });
  let n = 0;
  for (const u of soon) {
    const tv = await tvFor(u[0], u[2], u[3]);
    if (!tv) { log(`   ingen TV-guide än för ${u[0]} ${u[3]}`); continue; }
    while (u.length < 6) u.push(u.length === 4 ? "" : null);
    u[5] = { ...(u[5] || {}), ...(tv.kanal ? { kanal: tv.kanal } : {}), ...(tv.start ? { start: tv.start } : {}) };
    log(`   ${u[0]} ${u[3]}: ${tv.kanal || "?"} ${tv.start || ""}`); n++;
  }
});

/* ---------- Laguppställning inför dagens match ---------- */
// Swehockey lägger ut uppställningen strax före nedsläpp. Den visas överst på sidan till 20 min efter nedsläpp.
await source("uppställning", async () => {
  const today = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Stockholm" }).format(new Date());
  if (D.lineup && D.lineup.date < today) delete D.lineup;
  const n = D.upcoming.find(u => u[0] === today && u[1]);
  if (!n) return;
  const start = stockholm(n[0], n[1]);
  if (Date.now() < start - 4 * 36e5 || Date.now() > start + 20 * 6e4) return;
  const $l = await page(`${SWE}/ScheduleAndResults/Live/${await league()}`);
  let id = null;
  $l("a[href*='openonlinewindow']").each((_, a) => {
    const m = ($l(a).attr("href") || "").match(/\/Game\/\w+\/(\d+)/);
    if (m && !id && fold($l(a).closest(".d-sm-flex").text()).includes("bjorkloven")) id = m[1];
  });
  if (!id) throw new Error("hittade inte dagens match på swehockey");
  const $ = cheerio.load(await fetchOnce(`${SWE}/Game/LineUps/${id}`));
  const h = $("h3").filter((_, x) => fold($(x).text()).includes("bjorkloven")).first();
  if (!h.length) { log("   ingen uppställning än"); return; }
  const LABEL = { "Goalies": "Målvakter", "1st Line": "Femma 1", "2nd Line": "Femma 2", "3rd Line": "Femma 3", "4th Line": "Femma 4", "Extra Players": "Reserver" };
  const groups = []; let cur = null;
  for (const r of h.closest("tr").nextAll("tr").toArray()) {
    if ($(r).find("h3").length) break;
    const lab = clean($(r).children("th,td").first().children("strong").text());
    if (/coach/i.test(lab)) break;
    if (lab) { cur = { label: LABEL[lab] || lab, p: [] }; groups.push(cur); }
    if (!cur) continue;
    // I femmorna står backarna på raden med etiketten och forwards på raden under.
    const pos = /^Femma/.test(cur.label) ? (lab ? "B" : "F") : "";
    $(r).find(".lineUpPlayer").each((_, p) => {
      const m = clean($(p).text()).match(/^(\d+)\.\s*(.+?)(?:\s*\(\w+\))?$/);
      if (m) cur.p.push([+m[1], rosterName(nameOf(m[2])), $(p).hasClass("red") ? 1 : 0, pos]);
    });
  }
  const ORDER = ["Målvakter", "Femma 1", "Femma 2", "Femma 3", "Femma 4", "Reserver"], ix = l => (ORDER.indexOf(l) + 99) % 99;
  const g = groups.filter(x => x.p.length).sort((a, b) => ix(a.label) - ix(b.label));
  if (!g.some(x => x.label === "Målvakter") || g.filter(x => /^Femma/.test(x.label)).length < 2) { log("   uppställningen är inte komplett än"); return; }
  D.lineup = { date: n[0], opp: n[3], groups: g };
  log(`   uppställning: ${g.map(x => `${x.label} ${x.p.length}`).join(", ")}`);
});

/* ---------- Text under statistiken ---------- */
{
  const gp = D.table.find(t => t[0] === "IF Björklöven")?.[1];
  const pick = l => D.nums.find(n => n[1] === l);
  const m = pick("mål per match"), i = pick("insläppta per match"), r = pick("räddningsprocent");
  const top = [...D.players].sort((a, b) => (b[3] + b[4]) - (a[3] + a[4]))[0];
  if (gp && m && i) D.statnote = `Efter ${gp} omgångar. Björklöven är ${m[2]}:a i SHL på gjorda mål per match och ${i[2]}:a på insläppta${r ? `, med ${r[0]} i räddningsprocent` : ""}.` +
    (top ? ` Poängbäst i laget är ${top[0]} med ${top[3]}+${top[4]}.` : "");
}

/* ---------- Spara om något ändrats ---------- */
const body = o => { const { updated, updatedText, sources, ...rest } = o; return JSON.stringify(rest); };
const hash = o => createHash("sha1").update(body(o)).digest("hex");
log("\nKällor:", status);
if (hash(D) === hash(old)) { log("Inga ändringar."); process.exit(0); }
const now = new Date();
const p = Object.fromEntries(new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Stockholm", day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" }).formatToParts(now).map(x => [x.type, x.value]));
D.updated = now.toISOString();
D.updatedText = `${p.day} ${p.month} ${p.year}, kl. ${p.hour}.${p.minute}`;
D.sources = status;
writeFileSync(DATA, JSON.stringify(D, null, 1) + "\n");
log("data.json uppdaterad.");
