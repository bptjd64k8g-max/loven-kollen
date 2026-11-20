// Skriver ut när matchläget ska sluta (unix-sekunder), eller 0 om ingen match är nära.
import { readFileSync } from "node:fs";
const D = JSON.parse(readFileSync("data.json", "utf8"));
function stockholm(date, time) {
  const [y, m, d] = date.split("-").map(Number), [hh, mm] = time.split(":").map(Number);
  const lastSun = mo => { const x = new Date(Date.UTC(y, mo, 0)); return x.getUTCDate() - x.getUTCDay(); };
  const summer = (m > 3 && m < 10) || (m === 3 && d >= lastSun(3)) || (m === 10 && d < lastSun(10));
  return Date.UTC(y, m - 1, d, hh - (summer ? 2 : 1), mm);
}
const now = Date.now();
for (const u of D.upcoming) {
  if (!u[1]) continue;
  const start = stockholm(u[0], u[1]);
  // Matchläge från 20 min före nedsläpp till 3 h 30 min efter
  if (start - 150 * 6e4 < now && now < start + 210 * 6e4) {
    console.log(Math.round((start + 210 * 6e4) / 1000));
    process.exit(0);
  }
}
console.log(0);
