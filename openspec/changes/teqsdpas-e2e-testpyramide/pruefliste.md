# Prüfliste — teqsdpas-e2e-testpyramide (LLH-1665)

## 1. Ausgangslage

Chromium-Summe der eingecheckten `frontend/e2e/laufzeiten.json` (Stand `alpha` 12.11.2026):
**20.124 s = 335,4 min** (264 Dateien). Die 20 längsten:

| # | Spec | min | kum. % |
|---|---|---|---|
| 1 | gate3-trefflaeche | 34,8 | 10 |
| 2 | gate1-ueberlauf | 21,9 | 17 |
| 3 | fokus-verdeckung | 13,6 | 21 |
| 4 | lagekarte-touch | 10,3 | 24 |
| 5 | trefflaeche-pruefflaechen | 9,9 | 27 |
| 6 | pegel-pruefliste | 7,0 | 29 |
| 7 | lagebild-cls-schmal | 6,0 | 31 |
| 8 | leisten-flaeche | 5,9 | 33 |
| 9 | dialoge-handy | 5,3 | 34 |
| 10 | kopfhoehe-tonpruefung | 5,2 | 36 |
| 11 | etb-chronologie | 4,4 | 37 |
| 12 | fernmeldeskizze | 4,4 | 38 |
| 13 | verwaltungstabellen-schmal | 3,8 | 40 |
| 14 | dokumente | 3,6 | 41 |
| 15 | lagekarte-smoke | 3,4 | 42 |
| 16 | funkplan | 3,3 | 43 |
| 17 | betreuung-pruefliste | 3,2 | 44 |
| 18 | palette-oeffnung | 3,2 | 45 |
| 19 | orientierung | 3,2 | 45 |
| 20 | command-palette | 3,2 | 46 |

**Lokale Läufe** (Cloud-Sitzung, 4 vCPU, Debug-Binary, Chromium, `PW_WORKERS=2`): Ein Vorher-Lauf
der 20 Specs schaffte rund 4 Fälle je Minute. Er wurde nach 168 von 532 Fällen abgebrochen, weil
er die Prüfläufe der Umbauten blockierte. Gemessen wird deshalb eine Auswahl von 10 Specs vorher
und nachher direkt hintereinander (Abschnitt 8).

Auf dem unveränderten Stand schlugen lokal schon fehl (Umgebung, nicht diese Change):
`etb-chronologie.spec.ts:117` (3 Stufen), `fokus-verdeckung.spec.ts:1712`, `funkplan.spec.ts:170`,
`gate1-ueberlauf.spec.ts:1191` (Beobachter) und `gate1-ueberlauf.spec.ts:35`.

## 3. Anmeldung über die API (D2)

- `e2e/anmelde-kern.ts` mit `anmeldenPerApi`; Nachweis `e2e/anmelde-kern.spec.ts` (3 Fälle, grün).
- **Mutationsprobe:** Zusicherung „Sitzung erwartet“ entfernt → `anmelde-kern.spec.ts:41`
  (Änderungszwang) rot; zurückgesetzt → grün.
- Umgestellt: geteilte Helfer (`trefflaeche-kern`, `rollen-kern`, `lageplan-kern`) und per Skript
  140 Formular-Anmeldungen in 140 Dateien; 237 Aufrufe mit `{ startseite: false }`, wo der Fall
  danach ohnehin per `goto` lädt und dazwischen nichts an der Seite tut (Skript prüft
  Seitenzugriffe und Helfer mit Seitenzugriff; `tsc` hat Aufrufe lokaler Hüllen ohne Optionen
  zurückgewiesen, die Optionen dort wieder entfernt).
- 91 Einsätze über `einsatzPerApi` (`e2e/einsatz-kern.ts`) statt über den Dialog, wo der Fall den
  Dialog nicht prüft und danach per `goto` lädt. Gleiche Werte: Einsatzart `realeinsatz` und
  Alarmzeit „jetzt“ sind die Server-Vorgaben wie die Vorbelegung des Dialogs
  (`EinsaetzePage.tsx`, `START_EINSATZART`, `serverJetzt()`).
- **Riegel:** `no-restricted-syntax` gegen `getByLabel('Benutzername').fill(…)` in `e2e/**`,
  Ausnahmeliste `E2E_ANMELDEFORMULAR_ERLAUBT` in `frontend/eslint.config.js`: `rollen-kern.ts`
  (`anmeldenImFormular`), `primaerknopf-kontrast`, `fokusring-kontrast`,
  `browserspeicher-gesperrt`, `einmalpasswort`, `sitzung-mehrere-tabs`, `kernfluss` (nach Review),
  `doku-bilder/**`. Der Riegel fängt die übliche Form `X.getByLabel('Benutzername').fill(…)`, nicht
  aber Regex-, Rollen- oder Platzhalter-Varianten und Locator in Variablen; er ist ein Riegel gegen
  das gewohnte Muster, kein Beweis.
- **Mutationsprobe Riegel:** Formular-Anmeldung in `gate1-ueberlauf.spec.ts` eingefügt → ESLint
  rot mit Hinweis auf `anmelde-kern.ts`; dieselbe Zeile in `fokusring-kontrast.spec.ts` grün.

## 4. Eine Ladung je Dichtestufe (D3)

- `ladeInDichte` in `e2e/trefflaeche-kern.ts`; Nachweis `e2e/dichte-laden.spec.ts` (zählt
  Dokumentanfragen: je Stufe genau eine; von `about:blank` aus der alte Weg).
- **Mutationsprobe:** Schreiben der Stufe entfernt → `dichte-laden.spec.ts:9` rot an der Wache
  `data-dichte`; zurückgesetzt → grün.
- Umgestellt per Skript: 116 Paare `goto` + `stelleDichte` in 20 Specs (gate3 69, fokus 8,
  pruefflaechen 5, einheit-ansicht 5, pegel 4, leisten 4, …), nur wo `stelleDichte` die
  gemeinsame ist oder eine gleichwertige lokale Kopie (Schlüssel setzen, neu laden, Wache).
  Übersprungen: `datensicht-schmal` (eigene `stelleDichte`). Überzählige lokale Kopien entfernt.

## 5. Saat einmal (D4, D6)

- **5.1 Gate 1 schreibt bei der Messung nicht:** `vorbereiten` der Routen (`:769`, `:837`, `:891`,
  `:913`, `:940`, `:962`) öffnen Palette, Reiter, Verläufe und blenden ein; `lesend` sichert
  Vorbedingungen. Kein POST/PATCH/DELETE in `gate1Messen`. Alle sechs Durchgänge sind lesend.
- **5.2** `gate1Vorbereiten(page, rolle, { vorlage })`: Saat einmal je Worker und Einsatzart
  (Map `GATE1_SAAT`), Beobachter einmal je Worker, Mitglied jedes gesäten Einsatzes. Einsatz über
  die API. Wetter-Stub je Test.

- **Mutationsprobe (`layout-gates-rollen`, „Mutationsprobe“):** `RechteHinweis` mit
  `minWidth: 420` → `Gate 1 · mobil (390 px) · Beobachter · Lage und ETB` rot (Überblick, ETB,
  Ablösung je 42 px über), `Gate 1 · mobil (390 px) · Lage und ETB` (Admin) grün — mit der Saat je
  Worker. Zurückgesetzt.

## 6. Duplikate (D7)

| e2e-Fall | Entscheidung | Beleg |
|---|---|---|
| `lagekarte-smoke` „der alte Body eines veralteten Clients wird abgelehnt“ | gestrichen: reiner API-Fall | `tests/freies_zeichen.rs::altes_format_ist_400`; Probe: `&self.grundzeichen` aus `ablehnen` (`src/routes/freies_zeichen.rs`) genommen → `cargo test --test freies_zeichen altes_format_ist_400` rot |
| `funkplan` „die Kennung einer Einheit führt auf ihre Detailseite“ | gestrichen | `FunkplanPage.test.tsx` „führt jede Zeile per Link zu ihrem Pflegeort“; Probe: `einheitDetailPfad(einsatzId, z.id + 1)` in `FunkplanPage.tsx` → Vitest rot |
| `trefflaeche-pruefflaechen` „Gefahrenmatrix: jede Zelle ist ganz Ziel …“ | gestrichen, Deckungsprüfung nach gate3 „Gefahrenmatrix (LFH-373)“ | Probe: Knopf `width: calc(100% - 6px)` in `GefahrenMatrix.tsx` → gate3 rot an „Matrixzelle #1 (kompakt): Breite deckt die Zelle“ |
| `funkplan` Übernahme in Lagebericht und Befehl (`:211`, `:231`) | bleibt: Ablauf über zwei Seiten (Funkplan → Bericht/Befehl), Vitest belegt nur Aufruf und Ziel | — |
| `funkplan` Sprechgruppen (`:458`) | bleibt: Sprung auf die Einsatzdaten ist ein Ablauf; der 403-Teil kostet keine eigene Saat | — |
| `dokumente` `:303`, `:396` | bleibt: Upload-Fortschritt (CDP-Drossel), Download-Dateiname und Dialog sind nur im Browser; der ETB-Abruf ist eine Anfrage ohne Ladung | — |
| `fernmeldeskizze` `:643`, `:698`, `:1056` | bleibt: die Teile hängen an Seiten, die der Fall ohnehin lädt; Streichen spart keine Ladung | — |
| `command-palette` `:198` | bleibt: Ablauf ETB → Fernmeldewesen über die Palette; die Rangfolge ist ein Nebenbefund | — |

## 7. kopfhoehe-tonpruefung (D7)

Entscheidung: **unverändert.** Die Herleitung (LLH-1158, LLH-1506) begründet „messen bis zum
Endstand plus Nachlauf“; die Mindestdauer `MESSDAUER_MS` (5 s) ist das einzige Netz gegen spätere,
unbekannte Sprünge des Kopfs in den ersten Sekunden. Der Beobachter nur in den Sprungbändern hieße
Rollen-Abdeckung abgeben (LFH-435). Beides trägt die Herleitung nicht.

## 8. Messung

Auswahl von 10 Specs (CI-Anteil 107 von 335 min): gate3-trefflaeche, gate1-ueberlauf,
fokus-verdeckung, trefflaeche-pruefflaechen, pegel-pruefliste, leisten-flaeche, funkplan,
lagekarte-smoke, command-palette, orientierung. Chromium, `PW_WORKERS=2`, `--trace off`, dasselbe
Debug-Binary, nacheinander auf derselben Maschine; Nachher-Stand Commit `0396de48` (vor der
Gefahrenmatrix-Zusammenführung).

| Spec | vorher min | nachher min |
|---|---|---|
| gate1-ueberlauf | 47,3 | 35,4 |
| gate3-trefflaeche | 43,9 | 31,2 |
| fokus-verdeckung | 24,1 | 19,8 |
| trefflaeche-pruefflaechen | 11,3 | 9,5 |
| pegel-pruefliste | 9,1 | 7,2 |
| leisten-flaeche | 6,0 | 5,9 |
| command-palette | 3,5 | 3,2 |
| funkplan | 3,2 | 2,9 |
| lagekarte-smoke | 3,2 | 2,8 |
| orientierung | 2,4 | 2,3 |
| **Summe Testzeit** | **153,9** | **120,4** |
| Wanduhr | 83,1 | 62,0 |

Nur über die 338 Fälle, die in beiden Läufen grün waren: **147,1 → 113,8 min, −33,3 min (−23 %)**.

Rot in beiden Läufen (Umgebung): `funkplan` Einzug (Beobachter, Zeitlimit 30 s),
`orientierung:40` (Titel bleibt „lifeline-hub“; auf dem alten Stand mit anderem Modul ebenso rot,
einzeln nachgeprüft). Nur vorher rot: gate3 FMS-Tableau, Einheit aus Vorlage (Admin, Beobachter),
Detailseiten, leisten Lagekarte, pruefflaechen C10. Nur nachher rot: gate3 Navigations-Drawer
(„Page crashed“, einzeln grün).

Lokal läuft die Suite langsamer als in der CI (Auswahl 147 statt 107 min). Hochgerechnet auf
die CI-Zeiten der Auswahl sind −23 % rund −25 min; die übrigen 228 CI-Minuten tragen die
API-Anmeldung, die Einsätze ohne Dialog und die Anmeldung ohne Startseite (190 Dateien), sind
lokal aber nicht gemessen. Die Akzeptanz misst der CI-Lauf des PRs.

## 9. Code-Review (Aufgabe 8.3)

Unabhängiger Prüfer über den Diff gegen `alpha` (12.11.2026), rund 326 geänderte Stellen per Skript
bis zum nächsten `goto` verfolgt, über 40 Helfer von Hand.

| Befund | Schwere | Erledigt |
|---|---|---|
| `sitzung-mehrere-tabs.spec.ts`: Fall (a) lebt von der Anmeldung im App-Code (Kanalmeldung `AuthContext.login`); die API-Anmeldung meldet nichts an andere Tabs | Fehler | Datei auf `alpha`-Stand zurück (steht auf der Ausnahmeliste); Lauf grün |
| `tabellen-sortieren-filtern.spec.ts` „Kontowechsel in einem anderen Tab“: `anmeldenAls` im zweiten Tab jetzt per API → kein Konfliktdialog | Fehler | zweiter Tab über `/login` + `anmeldenImFormular`; Regel dazu in `frontend/e2e/AGENTS.md`; Lauf grün |
| `kernfluss.spec.ts`: Smoke „Login → Einsatz …“ lief per API | Abdeckung | auf `alpha`-Stand zurück, auf die Ausnahmeliste |
| gate3 Fernmeldeskizze/Organigramm: überzähliges `goto` nach `ladeInDichte(…?ansicht=…)` | Laufzeit | entfernt; vier Fälle grün |
| Kommentare in `gate1-ueberlauf` (eigener Einsatz je Test) und `tabellen-sortieren-filtern` (Räumung beim Start der Anmeldeseite) | Doku | nachgezogen |
| Vermutung: Gate 1 misst in späteren Tests eines Workers einen älteren Einsatz (zeitabhängige Texte länger) | — | eher rot als grün; offen beobachten |
