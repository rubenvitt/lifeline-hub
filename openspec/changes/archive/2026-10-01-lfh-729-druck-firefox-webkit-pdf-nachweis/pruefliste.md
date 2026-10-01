# LFH-729 · Prüfliste: Druck in drei Engines, Logo und Seitenzählung im PDF

Belege zu den Anforderungen der Delta-Spec `druck-dokumente` und zu den Aufgaben 2.2, 3.3,
3.4, 4.1, 4.2 und 5.2. Das Kurzverdikt je Druckstück steht im Browser-Verdikt der LFH-22-Prüfliste
(`docs/superpowers/specs/2026-09-25-lfh-22-pruefliste.md`).

## Umgebung der Messung

Cloud-Container mit 4 Kernen, Last vor dem Lauf 1,9 (`uptime`). Playwright 1.62.0 mit Chromium
1234, Firefox 1538 (Firefox 153.0) und WebKit 2336 (WebKit 26.5). Die Browser liegen in einem
eigenen `PLAYWRIGHT_BROWSERS_PATH`, weil das vorinstallierte Chromium (1194) nicht zur gepinnten
Playwright-Version passt. Node 26.7.0 und pnpm 11.10.0 kommen aus `mise.toml`.

## Verdikt je Druckstück und Engine

„Mechanik“ heißt: unter `emulateMedia({ media: 'print' })` steht die Druckwurzel im Fluss und
oben, Kopfleiste, Rail, Modulpanel und offene Meldung sind `display: none`, die Endmarke liegt
jenseits der A4-Höhe, kein Textfeld ist sichtbar, und der Abschnittstitel trägt
`break-after: avoid`. „PDF“ heißt: Seitenzahl plausibel, „Seite n von m“ auf jeder Seite, und
die Endmarke steht auf einer Seite nach Seite 1, danach nur noch die Zählung.

| Druckstück | Chromium | Firefox | WebKit |
| --- | --- | --- | --- |
| Lagebericht lesend | Mechanik + PDF ✓ | Mechanik ✓ | Mechanik ✓ |
| Lagebericht Entwurf (Vorgabe, Split) | Mechanik + PDF ✓ | Mechanik ✓ | Mechanik ✓ |
| Lagebericht-Entwurf, Lesefassung (LFH-498, drei Fälle) | ✓ | ✓ | ✓ |
| Pressemitteilung lesend und Entwurf | Mechanik + PDF ✓ | Mechanik ✓ | Mechanik ✓ |
| Befehl lesend und Entwurf | Mechanik + PDF ✓ | Mechanik ✓ | Mechanik ✓ |
| ETB-Druck (512 Einträge) | Druckbild + PDF ✓ (Zählung je Seite, letzter Eintrag auf der letzten Seite) | Druckbild ✓ | Druckbild ✓ |
| Logo im Druckkopf | DOM + PDF ✓ (97 × 41 auf Seite 1, Folgeseiten ohne Bild) | DOM ✓ | DOM ✓ |
| Selbsttests (Seitenzähler, PDF-Auszug) | ✓ | übersprungen (kein PDF) | übersprungen (kein PDF) |

Lauf: `playwright test e2e/druck-fluss.spec.ts e2e/etb-druck.spec.ts` ergab zweimal hintereinander
38 bestanden und 4 übersprungen, in 3,3 bzw. 3,2 min. Jeder übersprungene PDF-Schritt steht im
Bericht als Annotation `nur-chromium`.

**Nicht belegt:** der echte Seitenumbruch in Firefox und Safari (siehe design.md, Non-Goals).
Das bleibt Handprüfung nach der Anleitung der LFH-22-Prüfliste. Meldebild und Funkplan gehören
nicht zu den Druck-Specs dieser Projekte → LFH-915.

## Messwerte (Wurzelhöhe / Endmarke in px bei 680 px Breite, Seiten im PDF)

| Fall | Chromium | Firefox | WebKit |
| --- | --- | --- | --- |
| Lagebericht lesend | 7428 / 7378, 9 Seiten (Endmarke S. 9) | 7434 / 7383 | 7448 / 7397 |
| Lagebericht Entwurf (Vorgabe) | 7759 / 7706, 9 Seiten | 7764 / 7712 | 7779 / 7726 |
| Lagebericht Entwurf (Split) | 7871 / 7809, 9 Seiten | 7876 / 7815 | 7891 / 7829 |
| Pressemitteilung lesend | 4790 / 4739, 6 Seiten | 4793 / 4743 | 4809 / 4759 |
| Pressemitteilung Entwurf | 4987 / 4934, 6 Seiten | 4990 / 4938 | 5007 / 4954 |
| Befehl lesend | 5542 / 5492, 6 Seiten | 5565 / 5515 | 5561 / 5511 |
| Befehl Entwurf | 5644 / 5583, 6 Seiten | 5648 / 5587 | 5664 / 5603 |
| ETB-Druck | 28 Seiten | — | — |

Die Engines liegen höchstens 0,4 % auseinander. Die Schwelle (Endmarke > 1122 px) trägt in
allen dreien mit großem Abstand. Eine Toleranz je Engine war nicht nötig.

## Mutationsproben

Jede Probe wurde testweise eingebaut, gefahren und danach zurückgesetzt (`git diff` leer).

| # | Mutation | Erwartung | Ergebnis |
| --- | --- | --- | --- |
| 2.2 | `pdfAuszug` gibt die Seiten in umgekehrter Folge zurück | Selbsttest rot | rot (Chromium) |
| 3.4 | Ausblende-Regel in `druck/druck.css`: `visibility: hidden` statt `display: none` | rot in allen Engines | rot in Chromium, Firefox und WebKit (Lagebericht und Befehl lesend): „Druckwurzel beginnt oben auf der Seite“ |
| 4.1 | `@bottom-right` (Seitenzählung) aus `druck/druck.css` entfernt | rot mit Seitennummer | rot: „Seite 1 trägt die Seitenzählung“ in Lagebericht, Logo-Fall und ETB-Druck |
| 4.2a | Logo im Druckkopf unter `@media print` ausgeblendet | rot in allen Engines | rot in allen drei: „Logo im Druckkopf: geladen, in den Maßen des Logos, mit Fläche“ |
| 4.2b | `img` aus `Druckkopf.tsx` entfernt | rot in allen Engines | rot in allen drei: „genau ein Bild im Druckkopf“ |
| 5.1 | `PLAYWRIGHT_BROWSERS_PATH` auf ein leeres Verzeichnis, `PW_PROJEKTE=chromium,webkit` | Schritt 7 bricht vorab ab | rot mit „Playwright-Browser fehlen: chromium webkit“ samt Installationsbefehl. `PW_PROJEKTE=safari` bricht mit „Unbekanntes Playwright-Projekt“ ab |

## Abhängigkeit

`pdfjs-dist` 6.3.289 (devDependency, exakt gepinnt). `scripts/check-deps.sh` meldet für das
Frontend „No known vulnerabilities found“. `cargo-audit` war in der Cloud-Umgebung nicht
installiert; das prüft der Job „Schnellprüfungen“ der CI. Nach `pnpm run build` enthält
`frontend/dist` keinen Treffer für `pdfjs-dist`.

## Volllauf des Gates (lokal)

- `./scripts/check-all.sh --nur e2e` mit allen drei Projekten: 553 Fälle, 538 bestanden,
  5 übersprungen, 10 rot, in 54,4 min. Alle zehn roten Fälle laufen in Chromium, keiner davon ist
  ein Druckfall. Sieben sind 30-s-Timeouts, das Lastbild aus LFH-398 (Last bis 11 auf 4 Kernen).
  Einzeln wiederholt bleiben fünf rot: `etb-anhang.spec.ts:39` und `schaden-anhaenge.spec.ts:81`
  (Download-Dateiname `download` statt des Namens mit Umlaut), `gate3-trefflaeche.spec.ts:312`
  (Führungsfunktionen ohne Zeilen), `chat-neue-nachrichten.spec.ts:122` und
  `etb-chronologie.spec.ts:112` (kompakt). **Dieselben fünf sind auf `origin/alpha` in dieser
  Umgebung ebenfalls rot** (Gegenprobe im eigenen Worktree, gleiches Binary und gleiche Browser).
  In der CI von PR #297 sind sie grün. Sie hängen also an diesem Container, nicht an LFH-729.
- `./scripts/check-all.sh --nur schnell`: grün. `cargo-audit` fehlt lokal und läuft in der CI.
- Vitest über die zehn Dateien, die Druck-CSS einlesen (`druck.test.ts`, `*Print.test.ts` u. a.):
  183 bestanden.
- Rust-Suite und volle Vitest-Suite: nicht lokal gefahren, weil LFH-729 weder Rust noch
  Anwendungscode ändert (nur e2e, Config, Gate, CI und Kommentare). Beide belegt die CI des PRs.

## CI-Laufzeit der Pflicht-Shards (D1)

Vorher (PR #297, nur Chromium): e2e 1/4 11:25 min, 2/4 22:46 min, 3/4 10:24 min,
4/4 10:04 min. Nachher: wird nach dem Lauf des PRs eingetragen.
