# Löven-kollen

Allt om IF Björklöven på ett ställe: nästa match, resultat, SHL-tabellen, statistik, silly och truppen.

Sidan uppdaterar sig själv. Var 30:e minut hämtar GitHub Actions ny data (`scripts/update.mjs`), sparar den i `data.json` och publicerar sidan på nytt om något ändrats.

## Källor
- Tabell: hockeytabeller.se (reserv: sportstatistik.nu)
- Spelschema, resultat och matchtider: stats.swehockey.se
- Spelar- och målvaktsstatistik: stats.swehockey.se
- Lagets nyckeltal: stats.swehockey.se
- Nyheter och silly: Google News och Bing News
- TV-kanal och sändningsstart: Hurbras matchguider
- Under matcher: matchläge (`.github/workflows/match.yml`) uppdaterar var 3:e minut

Misslyckas en källa behålls förra värdet. Se `sources` i `data.json` och loggen under fliken Actions.

## Ändra för hand
Truppen, skador, spelarfakta och notiser om matcher ligger i `data.json` (`roster`, `bio`, `upcoming`) och kan redigeras direkt på GitHub. Skriptet skriver inte över dem.

Hittar skriptet inte SHL på swehockey, sätt `swehockeyLeagueId` i `config.json` till siffran i adressen till SHL:s sida på stats.swehockey.se.
