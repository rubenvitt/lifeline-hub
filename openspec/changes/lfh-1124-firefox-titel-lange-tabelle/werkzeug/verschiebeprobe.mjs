// LFH-1124: Verschiebeprobe am echten Einsatzbericht. Schiebt einen Titel vor einer langen Tabelle
// in Schritten über das Seitenende, druckt über den echten Druckpfad des Browsers (Firefox: Puppeteer
// über WebDriver BiDi `browsingContext.print`, Chromium: CDP `printToPDF`) und wertet je Lage aus:
//   ok            Titel mit erster Zeile auf derselben Seite
//   NUR-KOPF      Titel und Spaltenkopf am Seitenende, erste Zeile erst auf der Folgeseite
//   TITEL-ALLEIN  Titel allein am Seitenende
//   /rest<n>px    Titel auf die Folgeseite gerückt; n = frei gebliebener Rest der Seite davor
//   /zaehl:…      eine Tabellenzeile fehlt im PDF oder steht doppelt
// Die Textebene je Lage landet in <aus>/<browser>-<fall>-<platz>.txt (Vergleich vorher/nachher).
//
// Aufruf (Vite-Dev-Server des Frontends läuft unter <basis>, `probe.tsx` + `probe.html` liegen
// in `frontend/` — `lauf.sh` erledigt beides):
//   PUPPETEER_DIR=… FF_BIN=… CR_BIN=… node verschiebeprobe.mjs <firefox|chrome> <basis> <etb|personal> <aus> [von bis schritt]
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

// puppeteer-core liegt nicht im Repo: Verzeichnis mit `node_modules/puppeteer-core` in PUPPETEER_DIR.
const require = createRequire(join(process.env.PUPPETEER_DIR ?? process.cwd(), 'x.js'));
const { default: puppeteer } = await import(pathToFileURL(require.resolve('puppeteer-core')).href);

const [b, BASIS, fall, AUS, von = '600', bis = '1100', schritt = '10'] = process.argv.slice(2);
mkdirSync(AUS, { recursive: true });
const pdf = join(AUS, `${b}-${fall}.pdf`);
const TITEL = fall === 'etb' ? 'Entscheidungen' : 'Personal';
const ZEILEN = fall === 'etb' ? 30 : 40;
// A4 in pt, Seitenrand 15 mm (`druck.css`): Inhalt endet bei 842 − 42,52 pt.
const UNTEN = 842 - 42.52;

const browser = await puppeteer.launch(
  b === 'firefox'
    ? { browser: 'firefox', executablePath: process.env.FF_BIN, headless: true }
    : { browser: 'chrome', executablePath: process.env.CR_BIN, headless: true, args: ['--no-sandbox'] },
);
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 900 });

function woerter(seite) {
  const xml = execFileSync('pdftotext', ['-f', String(seite), '-l', String(seite), '-bbox', pdf, '-']).toString();
  return [...xml.matchAll(/yMin="([\d.]+)" xMax="[\d.]+" yMax="([\d.]+)">([^<]*)</g)].map((m) => ({
    y0: +m[1],
    y1: +m[2],
    w: m[3],
  }));
}

const ergebnis = [];
const version = await browser.version();
for (let platz = +von; platz <= +bis; platz += +schritt) {
  await page.goto(`${BASIS}/probe.html?fall=${fall}&platz=${platz}`);
  await page.waitForFunction(() => window.__bereit === true, { timeout: 60_000 });
  writeFileSync(pdf, await page.pdf({ format: 'A4' }));
  const n = +/Pages:\s+(\d+)/.exec(execFileSync('pdfinfo', [pdf]).toString())[1];
  let befund = 'kein-titel';
  for (let s = 1; s <= n; s++) {
    const w = woerter(s);
    const titel = w.find((x) => x.w === TITEL);
    if (!titel) continue;
    const zeile1 = w.some((x) => x.w === 'Zeile001');
    const kopf = w.some((x) => x.w === (fall === 'etb' ? 'Hinweis' : 'Einsatzzeit') && x.y0 > titel.y0);
    befund = zeile1 ? 'ok' : kopf ? 'NUR-KOPF' : 'TITEL-ALLEIN';
    if (s > 1) {
      const vor = woerter(s - 1).filter((x) => x.w === 'ENDEPLATZ');
      if (vor.length) befund += `/rest${Math.round((UNTEN - vor[0].y1) / 0.75)}px`;
    }
    break;
  }
  const text = execFileSync('pdftotext', ['-layout', pdf, '-']).toString();
  writeFileSync(join(AUS, `${b}-${fall}-${platz}.txt`), text);
  const falsch = Array.from({ length: ZEILEN }, (_, i) => `Zeile${String(i + 1).padStart(3, '0')}`).filter(
    (k) => (text.match(new RegExp(`${k}\\b`, 'g')) ?? []).length !== 1,
  );
  if (falsch.length) befund += `/zaehl:${falsch.slice(0, 3).join(',')}`;
  ergebnis.push(`${platz}:${befund}`);
}
const schlecht = ergebnis.filter((e) => /NUR-KOPF|TITEL-ALLEIN|zaehl|kein-titel/.test(e));
const zeile = `${b} ${version} ${fall}: ${ergebnis.length - schlecht.length}/${ergebnis.length} ok`;
console.log(zeile);
console.log(ergebnis.join(' '));
writeFileSync(join(AUS, `${b}-${fall}.log`), `${zeile}\n${ergebnis.join('\n')}\n`);
await browser.close();
