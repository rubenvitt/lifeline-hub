# Tasks

Gegliedert nach Subtask von LLH-1017 (`<kurz>` = erste 8 Hex-Zeichen der Zunder-UUID). Jede
Aufgabe entsteht per TDD (`superpowers:test-driven-development`); geprüft wird mit
`mise exec -- pnpm -C frontend exec vitest run <Datei>` bzw. der genannten e2e-Spec.

## 1. Funkprotokoll-Ordnung — LLH-1149 (vkoertmc)

- [x] 1.1 Reine Kehrung im Modell (`funkprotokollFolge`) und `baueZeilen` mit gepufferten Zeilen am Ende; Vitest in `zeitachseModell.test.ts`/`etbZeile.test.ts` (Ordnung aufsteigend, Stundengruppen aufsteigend, Puffer unten, Bilanz/`letzteBerichtigungen` unverändert)
- [x] 1.2 `EtbZeitachse` rendert gespiegelt, Sammelbanner unten mit „↓“; Vitest `EtbZeitachse.test.tsx` und `EtbZeitachse.render.test.tsx` (gemerktes Rendern: neuer Eintrag unten rendert keine fremde Gruppe)
- [x] 1.3 Hook `components/useFunkprotokollLauf.ts` (Öffnen am Ende, `amEnde`, Mitlaufen an der jüngsten id, Anker bei Nachladen oben) mit Vitest gegen ein Dokument-Double; `overflow-anchor: none` an der Zeitachse
- [x] 1.4 Einfrieren bei „nicht am Ende ODER Fokus“, Auftauen am Ende ohne Fokus; Vitest am Modell und an der Zeitachse
- [x] 1.5 `EtbPage`: „Ältere laden“ oben, „Neuere laden“ unten, Alerts unter der Zeitachse, `erfassenUndZeigen` rollt ans Ende statt zum Kopf; Vitest `EtbPage.test.tsx`/`EtbPage.seitenfenster.test.tsx` nachgezogen
- [x] 1.6 Lesemarke als Trennlinie in der Achse mit Banner-Rückfall außerhalb des Fensters bzw. unter Filter, Text taktisch; Vitest `EtbLesemarke*.test.tsx`, `lesemarkeModell.test.ts`
- [x] 1.7 Informationstelefon in derselben Bauform (Kehrung, „Ältere laden“ oben, Sammelbanner unten, Deeplink-Anruf vorn, Hook aus 1.3); Vitest `InfotelefonPage.test.tsx`, `infotelefon/zufluss.test.ts`
- [x] 1.8 Regeln fortgeschrieben: `frontend/src/etb/AGENTS.md` (Erfassung, Seitenfenster, Zufluss, Lesemarke) und `frontend/src/stab/AGENTS.md` (Infotelefon); Prettier grün
- [x] 1.9 e2e nachgezogen: `etb-chronologie`, `etb-zeilenhoehe`, `leisten-flaeche`, `etb-seitenfenster`, `fokus-verdeckung`, `palette-datensaetze` (Leserichtung, Lage von „Neuere/Ältere laden“); `tsc` und `eslint` über `frontend/e2e` grün. Das Ende ist unter `xl` die Spalte über der Erfassung, nicht das Dokumentende (Bilanz darunter, `useFunkprotokollLauf` `ende`). `fokus-verdeckung` ist in dieser Umgebung auch auf `alpha` (1a3d5e7) in denselben fünf Fällen rot; entschieden wird in der CI des PRs
- [x] 1.10 Doku: `docs/anwender/kapitel/einsatztagebuch.md` und `presse-infotelefon.md` beschreiben die Leserichtung, Mitlaufen, Sammelbanner unten und die Lesemarke; Wächter der Anwenderdoku grün

## 2. Eine Filterleiste — LLH-1065 (wbej3nl0)

- [x] 2.1 `Segmentleiste` mit Variante `umschalten` (ein Knopf, `aria-pressed`, durchgestrichener Punkt im Aus-Zustand); Vitest im Baustein
- [x] 2.2 `EtbFilterleiste` mit Slots `vorn`/`mitte` und neuer Ordnung (Typ · System | Zeitraum · Einheit · Volltext), Dateikopf nachgezogen; Vitest `EtbFilterleiste.test.tsx`
- [x] 2.3 `EtbPage`: Segmentleiste ab `md` aus dem Kopf in die Leiste, Switch durch den Umschaltknopf ersetzt (`aria-describedby` der Zahl bleibt), „Filter (n)“ unter `md` unverändert; Vitest `EtbPage.test.tsx` (role `switch` → `button`, `ohne_system` in der URL, Zusammenspiel mit `typ=system`)
- [x] 2.4 Mehrzahl `lage` → „Lagefeststellungen“ in `etbTypMehrzahl`; Vitest `statusFarben.test.ts`, `EtbBilanz.test.tsx`, `lageentwicklungUebernahme.test.ts`
- [x] 2.5 Spec-Wortlaut „Umschaltknopf“ und Regel „Systemeinträge ausblenden“/„Unter md zuerst die Zeitachse“ in `frontend/src/etb/AGENTS.md`
- [x] 2.6 e2e: Leiste bei 1440×900 kompakt in höchstens zwei Zeilen, Typ und System in einer, Kopf ohne Segmentleiste ab `md` (eigene Spec `e2e/etb-filterleiste.spec.ts`)

## 3. Zeitraum-Schnellwahl — LLH-1080 (wyylm0tn)

- [x] 3.1 `anzeige/zeitfenster.ts` (`zeitfensterWahl`, `zeitraumBeschriftung`) mit Vitest: Letzte Stunde/4 Stunden abgerundet, Heute in einer Anzeigezone ≠ Prozesszone (`test/prozessZone.ts`), seit LB nur mit Termin, Beschriftung ohne Sekunden und Wiedererkennung nach Neuladen
- [x] 3.2 `etb/EtbZeitraumWahl.tsx` (Knopf mit Aufklapper, am Handy und im Handschuh als Blatt, Ziele in Steuerhöhe, „Eigener Zeitraum“ über `ZeitraumEingabe`); Vitest: eine Wahl setzt `von`/`bis` einmal, „bis“ leer erlaubt, Round-Trip durch `URLSearchParams`
- [x] 3.3 `EtbFilterleiste`/`EtbPage`: Zeitraum-Bedienziel statt zweier Felder, LB-Stand nur mit Freigabe `lagebesprechung`; Vitest `EtbPage.test.tsx`; e2e `dialoge-handy` auf den neuen Weg umgestellt
- [x] 3.4 Doku `einsatztagebuch.md`, Abschnitt „Einträge suchen und filtern“: Leiste, Umschaltknopf und Schnellwahl beschrieben

## 4. Filterband — LLH-1071 (nyc0b0fm)

- [x] 4.1 Baustein `components/instrument/Filterhinweis.tsx` (Export über `index.ts`) mit Vitest: Text mit und ohne Zahlen, Merkmalliste, Kürzung mit Titel, Zusatzzeilen, `onZuruecksetzen`, nichts ohne Merkmal
- [x] 4.2 `etb/filterMerkmale.ts` (Kurzform je Merkmal, Zeitraum über `zeitraumBeschriftung`) mit Vitest
- [x] 4.3 `EtbPage`: Band im `fuss` über der Erfassung bei jedem Merkmal, `m` aus der Zählung ohne Filter, „Filter zurücksetzen“ räumt Leiste und URL; Vitest je Merkmal und ohne Zählung keine Zahl
- [x] 4.4 `useEtbErfassung.erfassen` liefert die Antwort; Zusatz „Nr. n erfasst – außerhalb des Filters · anzeigen“ mit Sprung ohne Filter; Vitest in `EtbPage.test.tsx` und `useEtbErfassung`-Test
- [x] 4.5 Hinweis „+n Nachträge vor <Uhrzeit> erfasst · anzeigen“ bei Zeitraum „seit LB“; Vitest mit Mock-Antwort
- [x] 4.6 Bausteinliste in `frontend/AGENTS.md` um `Filterhinweis` ergänzt; e2e Kontrast Tag/Nacht des Bands (Muster `hinweis-kontrast.spec.ts`) und `leisten-flaeche` mit Filter auf 390 px
- [x] 4.7 Doku `einsatztagebuch.md`: ein Satz zum Band und zum Eintrag außerhalb des Filters

## 5. Berichtigt-Kennzeichnung — LLH-1099 (rh1l9wpd)

- [x] 5.1 `berichtigungsindex` bleibt für Druck und Bilanz (beide Richtungen, nur Geladenes); die Zeitachse liest ihn nur noch vorwärts (Grundeintrag einer Berichtigung), Kommentar nachgezogen; Vitest `zeitachseModell.test.ts`
- [x] 5.2 Zeile liest `berichtigt_durch`, Chip „berichtigt“ + „→ Nr. n“ in der Kopfzeile, weitere in der Hinweiszeile; Vitest `EtbZeitachse.test.tsx` (Berichtigung nicht geladen, Typfilter Meldung); Mutationsprobe: Rückkehr zur Fensterbildung macht den Fall rot
- [x] 5.3 „Berichtigen“ auch an einer Berichtigung, Leiste nennt die Kette (`berichtigungTitel`); Vitest `EtbZeitachse.test.tsx`, `zeitachseModell.test.ts`
- [x] 5.4 Doku `einsatztagebuch.md`, „Einen Eintrag berichtigen“: Chip und Berichtigung einer Berichtigung

## 6. Leise und gebündelte Systemeinträge — LLH-1106 (xnc0gxjh)

- [x] 6.1 `Zeitachseneintrag` Variante `leise` und `vonAn` ohne „System → System“; Vitest im Baustein und in `EtbZeitachse.test.tsx`
- [x] 6.2 Reine Funktion `buendleSystemfolgen` mit Vitest (2 vs. 3, Unterbrechung durch anderen Typ, Stundenwechsel, Nachtrag, berichtigt, Anhang, aus unter `typ=system` und `q`)
- [x] 6.3 Bündelzeile in der Zeitachse (`aria-expanded`, Name „n Systemeinträge <von>–<bis> anzeigen/zuklappen“, offen bleibt offen, Sprung klappt im Render auf); Vitest `EtbZeitachse.test.tsx`, Mutationsprobe Schlüssel am jüngsten Eintrag macht „offen bleibt offen“ rot
- [x] 6.4 Regel in `frontend/src/etb/AGENTS.md` (leise, Bündel, nie im Druck); Doku `einsatztagebuch.md`, „Automatische Einträge“
- [x] 6.5 e2e `etb-zeilenhoehe` mit Systemeinträgen (Bündelzeile zählt als eine Zeile), Kontrast der leisen Zeile in `hellmodus-kontrast`

## 7. Typ in der Erfassung — LLH-1112 (l0ztbp27)

- [x] 7.1 Präfix mit Typwort und Kante, Name „Eintragstyp <Typ> ändern“, Menü mit Punkten, Berichtigung „Berichtigung“ mit roter Kante; Vitest `Schnellerfassung.test.tsx`; Selektoren in `EtbPage.test.tsx` und `e2e/etb-folgeauftraege.spec.ts` nachgezogen
- [x] 7.2 `Schnellerfassungszeile` mit Opt-in `kante`; Vitest im Baustein
- [x] 7.3 „Werte behalten“ nimmt den Typ mit (`nurUebernahme`, `useEtbEntwuerfe`), „+“-Reiter startet als Meldung; Vitest `useEtbEntwuerfe.test.tsx`, `EtbEntwurfsTabs.test.tsx`
- [x] 7.4 Erfassungs-Norm „Werte behalten“ in `frontend/AGENTS.md` fortgeschrieben; Doku `einsatztagebuch.md` Schritt 2

## 8. Nachtrag — LLH-1088 (ovoyr01i)

- [x] 8.1 `erkenneZeitBefehl` in `schnellerfassungModell.ts` mit Vitest (`1420`, `14:20`, `101420`, `-15`, unlesbar `2590`, nach einem Typbefehl, Tageswechsel in fremder Anzeigezone)
- [x] 8.2 Verdrahtung in `Schnellerfassung` (Chip gesetzt, Rest bleibt Inhalt, unlesbar bleibt Text mit Grund) und Vorschlag „zeit 1420“ im `/`-Menü; Vitest `Schnellerfassung.test.tsx`
- [x] 8.3 `zukunftsVerstoss` vor Upload und Warteschlange, Grund am Chip; Chip zeigt den Tag, wenn nicht heute; Vitest `Schnellerfassung.test.tsx`, `MetaChip.test.tsx`
- [x] 8.4 Nachtrag-Hinweis mit Tag in `EtbZeitachse` und `EtbEintragVorschau`; Vitest über Mitternacht
- [x] 8.5 Regel in `frontend/src/etb/AGENTS.md` (Erfassung) und Doku `einsatztagebuch.md`, „Felder, Bausteine und Werte setzen“; e2e Nachtrag-Ablauf (`/zeit -10` + Text + Enter)

## 9. Integration

- [ ] 9.1 Prüfliste Einsatztauglichkeit (15 Kriterien) für ETB-Seite und Informationstelefon im PR ausgefüllt
- [x] 9.2 Doku-Bilder `einsatztagebuch/*` und `presse-infotelefon/*` über die Bilder-Specs neu erzeugt (Mitänderungsregel `docs/anwender/AGENTS.md`)
- [ ] 9.3 `./scripts/check-all.sh` grün (lokal die Bündel ohne Server-Stack, vollständig in der CI des PRs)

## Workflow follow-up

- `/opsx:archive gonnp1g8-etb-ux-durchgang` im selben Branch, danach PR gegen `alpha`.
- Folgetickets: Palette der Entscheidungs-Kante (Nacht ≥ 3 : 1), berichtigt-Kennzeichnung in Lage-Dashboard/Überblick/Lageentwicklung, Zeitfenster der Lagemeldungen auf `anzeige/zeitfenster.ts`, Design System „Lifeline Hub“ (LLH-1147).
