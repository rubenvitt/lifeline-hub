// LFH-813: jedes Druckstück über den echten Druckpfad des Browsers als PDF.
// Firefox: Puppeteer über WebDriver BiDi (`browsingContext.print`), Chromium: CDP `printToPDF`.
// Aufruf: node drucken.mjs <firefox|chrome> <baseURL> <ids.json> <ausgabeverzeichnis>
import puppeteer from 'puppeteer-core';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const [browserName, BASIS, idsDatei, AUS] = process.argv.slice(2);
const ids = JSON.parse(readFileSync(idsDatei, 'utf8'));
// Admin-Zugang des Prüf-Backends (`--admin-password`) aus der Umgebung, nicht aus dem Skript.
const PW = process.env.E2E_ADMIN_PW;
if (!PW) throw new Error('E2E_ADMIN_PW fehlt: das Admin-Passwort des Prüf-Backends setzen.');
mkdirSync(AUS, { recursive: true });

const browser = await puppeteer.launch(
  browserName === 'firefox'
    ? { browser: 'firefox', executablePath: process.env.FF_BIN, headless: true }
    : { browser: 'chrome', executablePath: process.env.CR_BIN, headless: true, args: ['--no-sandbox'] },
);
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 900 });
page.setDefaultTimeout(60_000);

// Anmelden über die API im Seitenkontext: das Sitzungs-Cookie landet im Browser.
await page.goto(`${BASIS}/login`);
const anmeldung = await page.evaluate(async (passwort) => {
  const r = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ benutzername: 'admin', passwort }),
  });
  return r.status;
}, PW);
if (anmeldung !== 200) throw new Error(`Anmeldung: ${anmeldung}`);

const protokoll = [];

async function warteAuf(pruefung, arg) {
  await page.waitForFunction(pruefung, { timeout: 60_000, polling: 250 }, arg);
}

async function drucke(name, url, vorbereiten, { thema = 'dark' } = {}) {
  await page.evaluate((t) => localStorage.setItem('lifeline-hub.theme', t), thema);
  await page.goto(`${BASIS}${url}`);
  await vorbereiten();
  // Mitschreiben, ob der Browser beim Drucken `beforeprint`/`afterprint` feuert.
  await page.evaluate(() => {
    window.__druck = { vorher: 0, nachher: 0 };
    addEventListener('beforeprint', () => window.__druck.vorher++);
    addEventListener('afterprint', () => window.__druck.nachher++);
  });
  const pdf = await page.pdf({ format: 'A4' });
  const ereignisse = await page.evaluate(() => window.__druck);
  writeFileSync(`${AUS}/${name}.pdf`, pdf);
  protokoll.push({ name, ereignisse, bytes: pdf.length });
  console.log(name, JSON.stringify(ereignisse));
}

const { eid } = ids;
const textDa = (t) => warteAuf((t) => document.body.innerText.includes(t), t);
const knopfFrei = () =>
  warteAuf(() =>
    [...document.querySelectorAll('button')].some(
      (b) => b.textContent.includes('Drucken / als PDF') && !b.disabled,
    ),
  );

await drucke('lagebericht-lesend', `/einsaetze/${eid}/lageberichte/${ids.lbFrei}`, async () => {
  await textDa('ENDE-LAGEBERICHT');
  await knopfFrei();
});
await drucke(
  'lagebericht-lesend-hell',
  `/einsaetze/${eid}/lageberichte/${ids.lbFrei}`,
  async () => {
    await textDa('ENDE-LAGEBERICHT');
    await knopfFrei();
  },
  { thema: 'light' },
);
await drucke('lagebericht-entwurf-vorgabe', `/einsaetze/${eid}/lageberichte/${ids.lbEntwurf}`, async () => {
  await warteAuf(() => document.querySelectorAll('.markdown-editor__druck').length === 8);
  await knopfFrei();
});
await drucke('lagebericht-entwurf-split', `/einsaetze/${eid}/lageberichte/${ids.lbEntwurf}`, async () => {
  await warteAuf(() => document.querySelectorAll('.markdown-editor__druck').length === 8);
  await page.evaluate(() => {
    const l = [...document.querySelectorAll('label')].find((x) => x.textContent.includes('Vorschau neben dem Text'));
    l.click();
  });
  await warteAuf(() => document.querySelector('.markdown-editor--split') != null);
  await knopfFrei();
});
await drucke('befehl-lesend', `/einsaetze/${eid}/auftraege/befehle/${ids.befFrei}`, async () => {
  await textDa('ENDE-BEFEHL');
  await knopfFrei();
});
await drucke('befehl-entwurf', `/einsaetze/${eid}/auftraege/befehle/${ids.befEntwurf}`, async () => {
  await warteAuf(() =>
    [...document.querySelectorAll('.markdown p')].some((p) => p.textContent.includes('ENDE-BEFEHL')),
  );
  await knopfFrei();
});

// Meldebild: „Mit Mitteln“ wählen, damit alle 40 Kräfte unter „Ohne Einheit“ stehen.
async function meldebildVorbereiten() {
  await textDa('Ohne Einheit');
  await page.locator('::-p-text(Mit Mitteln)').click();
  await warteAuf(() => document.querySelectorAll('tr.ant-table-row').length >= 41);
  await knopfFrei();
}
await drucke('meldebild', `/einsaetze/${eid}/kraefteuebersicht`, meldebildVorbereiten);
// Zweiter Lauf wie der Browser beim echten Drucken: `beforeprint` zuerst, dann das Blatt.
await drucke('meldebild-beforeprint', `/einsaetze/${eid}/kraefteuebersicht`, async () => {
  await meldebildVorbereiten();
  await page.evaluate(() => dispatchEvent(new Event('beforeprint')));
  await warteAuf(() => document.querySelector('[data-lfh="druckwurzel"] .ant-table-sticky-holder') == null);
});

await drucke('etb', `/einsaetze/${eid}/etb/druck`, async () => {
  await textDa('Berichtigung: Deich Süd, nicht Nord');
  await knopfFrei();
});
await drucke('etb-gefiltert', `/einsaetze/${eid}/etb/druck?typ=meldung`, async () => {
  await textDa('Typ: Meldung');
  await knopfFrei();
});

writeFileSync(`${AUS}/protokoll.json`, JSON.stringify({ browser: await browser.version(), protokoll }, null, 2));
console.log('Browser:', await browser.version());
await browser.close();
