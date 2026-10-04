# LFH-813 · Belege der Druckprüfung in Firefox (Chromium als Vergleich)

Lauf vom 03.10.2026. Die Verdikte stehen in
`docs/superpowers/specs/2026-09-25-lfh-22-pruefliste.md` (Abschnitt „Browser-Verdikt“).

## Wie gedruckt wurde

- **Firefox 157.0** (Mozilla-Build, Linux): der **echte Druckpfad** des Browsers, angesteuert über
  WebDriver BiDi `browsingContext.print` (Puppeteer `page.pdf({ format: 'A4' })`). Das PDF nennt
  „Mozilla Firefox 157.0“ als Erzeuger. Es ist derselbe Seitenumbruch wie „Drucken → Als PDF
  speichern“. Firefox feuert dabei `beforeprint` und `afterprint` selbst (`firefox/protokoll.json`),
  das Meldebild läuft also über `useDruckModus` wie beim Druck aus dem Dialog.
- **Chromium 141** (Playwright-Build): `page.pdf()` über CDP, nur als Vergleich. Die
  Chromium-PDFs liegen nicht im Repo (3,5 MB), ihre Kennzahlen stehen in `auswertung.json`.
- Nicht über den Dialog gedruckt: Druckränder, Kopf- und Fußzeilen des Browsers stammen aus
  der Vorgabe (A4, `@page`-Rand der App), nicht aus Einstellungen von Hand.
- **Safari ist nicht geprüft.** In der Linux-Umgebung gibt es kein Safari, und Playwrights
  WebKit teilt nur die Engine, nicht den Druckpfad. Nachzug: LFH-1010.

## Daten

`werkzeug/saeen.mjs` gegen ein frisches Backend (Seeding wie in den e2e-Specs `druck-fluss`,
`etb-druck`, `meldebild-tabelle`):

- Organisation „DRK KV Musterstadt“ mit PNG-Logo 160 × 64 (rotes Kreuz, zwei Balken)
- Einsatz „Hochwasser Musterstadt (Druckprobe LFH-813)“, E-2026-0001
- Lagebericht 1 freigegeben, Lagebericht 2 als Entwurf, je acht Abschnitte à sechs Absätze,
  am Ende „ENDE-LAGEBERICHT“
- Befehl LAD freigegeben und als Entwurf, drei Abschnitte à zwölf Absätze, am Ende „ENDE-BEFEHL“
- 40 Ad-hoc-Kräfte im Meldebild, gedruckt mit „Mit Mitteln“
- 555 ETB-Einträge: Lage- und Befehlseinträge aus den Freigaben, Personalmeldungen, 510
  Saatmeldungen, ein Nachtrag (Ereigniszeit zwei Stunden zurück, Nr. 554) und eine Berichtigung
  (Nr. 555 berichtigt Nr. 43)

Gedruckt wurde im Nachtbetrieb (Vorgabe der App). `lagebericht-lesend-hell.pdf` ist derselbe
Bericht im Tagbetrieb, zum Vergleich der Papierfarbe.

## Dateien

| Datei | Inhalt |
| --- | --- |
| `firefox/*.pdf` | je Druckstück das PDF aus Firefox 157 |
| `firefox/protokoll.json` | Browserversion, `beforeprint`/`afterprint` je Druck |
| `auswertung.json` | Kennzahlen je Druckstück und Browser (Seiten, Kopf auf Seite 1, Rahmenreste, Endmarke, Titel je einmal, Titel allein am Seitenende, Tabellenkopf je Seite, ETB-Nummern, Bilder je Seite, Dunkelanteil Seite 1) |
| `lagebericht-vergleich.png` | Lagebericht lesend, Seiten 1–4: oben Firefox, unten Chromium |
| `meldebild-vergleich.png` | Meldebild, Seiten 1–5: oben Firefox, unten Chromium (LFH-1007) |
| `etb-vergleich.png` | ETB-Druck, Seiten 1–6: oben Firefox, unten Chromium (LFH-1009) |
| `etb-titel-allein-firefox.png` | Firefox, ETB-Seite 6 („Eigene Lage“ allein am Seitenende, LFH-1008) und die Seiten 40/41 (Tabellenkopf je Seite, keine Zeile zerrissen) |
| `werkzeug/` | Seeding, Druck, Auswertung, Minimalprobe zu `break-after: avoid` |

## Nachvollziehen

```sh
# Backend (Debug-Build) und Vite wie in playwright.config.ts, mit frischer Datenbank.
# E2E_ADMIN_PW ist ein frei gewähltes Wegwerf-Passwort nur für dieses Prüf-Backend;
# saeen.mjs und drucken.mjs lesen es aus der Umgebung.
export E2E_ADMIN_PW=<wegwerf-passwort>
target/debug/lifeline-hub --db-path /tmp/druck/lifeline.db --bind 127.0.0.1:18080 \
  --admin-password "$E2E_ADMIN_PW" --kritis-extrakt false
LIFELINE_BACKEND_URL=http://127.0.0.1:18080 node frontend/node_modules/vite/bin/vite.js \
  --host 127.0.0.1 --port 15173 --strictPort   # im Ordner frontend/

# Werkzeug außerhalb des Repos einrichten (puppeteer-core, Firefox stable):
npm i puppeteer-core @puppeteer/browsers
npx @puppeteer/browsers install firefox@stable

node saeen.mjs http://127.0.0.1:15173 > ids.json
FF_BIN=<pfad>/firefox node drucken.mjs firefox http://127.0.0.1:15173 ids.json pdf/firefox
CR_BIN=<pfad>/chrome  node drucken.mjs chrome  http://127.0.0.1:15173 ids.json pdf/chromium
python3 auswerten.py pdf          # erwartet pdf/firefox und pdf/chromium, braucht poppler und Pillow
FF_BIN=<pfad>/firefox node minimalprobe.mjs firefox
```

Für die Safari-Prüfung (LFH-1010) genügen Backend, Vite und `saeen.mjs`. Gedruckt wird dann von
Hand aus Safari.

## Minimalprobe `break-after: avoid`

Ergebnis von `werkzeug/minimalprobe.mjs`: Ein `h2` mit `break-after: avoid` steht 840–1000 px
tief auf Seite 1, danach folgen Absätze mit `break-inside: avoid`.

| Lage des Titels | Firefox 157 | Chromium 141 |
| --- | --- | --- |
| 840–960 px (7 Lagen), Blockfluss | Titel **allein** am Ende von Seite 1 | Titel mit Text auf Seite 2 |
| 840–960 px (7 Lagen), Tabellenzelle | Titel **allein** am Ende von Seite 1 | Titel mit Text auf Seite 2 |
| 980–1000 px | Titel auf Seite 2 (passt nicht mehr) | Titel mit Text auf Seite 2 |
