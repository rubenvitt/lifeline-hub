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
und nachher direkt hintereinander (Abschnitt 9).

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
  `browserspeicher-gesperrt`, `einmalpasswort`, `sitzung-mehrere-tabs`, `doku-bilder/**`.
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

## 8. kopfhoehe-tonpruefung (D7)

Entscheidung: **unverändert.** Die Herleitung (LLH-1158, LLH-1506) begründet „messen bis zum
Endstand plus Nachlauf“; die Mindestdauer `MESSDAUER_MS` (5 s) ist das einzige Netz gegen spätere,
unbekannte Sprünge des Kopfs in den ersten Sekunden. Der Beobachter nur in den Sprungbändern hieße
Rollen-Abdeckung abgeben (LFH-435). Beides trägt die Herleitung nicht.
