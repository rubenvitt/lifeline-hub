## 1. Hook `useDatensatzKontextMenue` (D1)

- [x] 1.1 TDD: `components/useDatensatzKontextMenue.test.tsx` — Rechtsklick auf ein Element mit `ausloeser(zeile)` öffnet `menue` mit `eintraege(zeile)` und `zugaenglicherName(zeile)`, `offen` wird wahr; Wahl ruft `onWahl(key, zeile)` genau einmal und schließt
- [x] 1.2 TDD: ohne Einträge kein Menü (Browsermenü); verschwindet die Zeile (`finde` liefert nichts) oder verliert sie alle Einträge, schließt das offene Menü im nächsten Render
- [x] 1.3 `Datensicht.tsx` auf den Hook umstellen (Abschnitt „Kontextmenü“), `offen` hält die Zeilenschleuse; `Datensicht.kontextmenue.test.tsx` und übrige Datensicht-Tests grün

## 2. Primäraktion gesperrt (D7)

- [x] 2.1 TDD: `PrimaerAktion.gesperrt(zeile)` — `kontextEintraege` setzt den Eintrag `__primaer` gesperrt, die Wahl löst nicht aus; der Knopf im Kartenfuß der `Datensicht` ist `disabled`

## 3. `KatalogTabelle.zeilenMenue` und `ZeilenMenueAusloeser` (D2)

- [x] 3.1 TDD: `ZeilenMenueAusloeser({ menue, zeile })` rendert das ⋮ aus `eintraege`, `zugaenglicherName`, `onWahl`; `laeuft(zeile)` sperrt und zeigt den Ladezustand; ohne Einträge nichts
- [x] 3.2 TDD: `KatalogTabelle` mit `zeilenMenue` — Rechtsklick auf eine Zeile öffnet das Menü dieser Zeile; bei `laeuft` stehen alle Einträge gesperrt; ohne `zeilenMenue` kein Kontextmenü und unverändertes `onRow`
- [x] 3.3 TDD: ein `onRow` des Aufrufers wirkt weiter neben den Handlern des Hooks (beide gerufen); `rowKey` als String und als Funktion findet die Zeile

## 4. Tabellen der Stammdaten und Benutzer (D2, D4, D5)

- [x] 4.1 Schichtmodelle: Beschreibung per `useMemo`, Spalte über `ZeilenMenueAusloeser`, Tabelle mit `zeilenMenue`; `laeuft` je Zeile über `vorgabe.variables`; TDD Rechtsklick zeigt „Bearbeiten“, „Als Vorgabe setzen“/„Vorgabe aufheben“, Trenner, rot „Löschen“
- [x] 4.2 Benutzer: dasselbe; TDD Rechtsklick zeigt die Einträge des ⋮ samt gesperrter Hub-Einträge
- [x] 4.3 Externe Stellen, Sprechgruppen, Verpflegungsplan: Beschreibung für ⋮ (schmal) und Tabelle; TDD je Seite am breiten Schirm: Kontextmenü-Einträge gleich den Knopfetiketten (Reihenfolge, Gefahr rot)
- [x] 4.4 `dienststatus.tsx`: `dienststatusMenue(…)` neben `dienststatusSpalten`; Fahrzeuge-, Personal- und Material-Tab der Stammdaten reichen es als `zeilenMenue`; TDD breit: Einträge gleich den Knöpfen, bei laufendem Wechsel gesperrt, vom Hub kein eigenes Menü
- [x] 4.5 Bestehende Tests grün: `verwaltungstabellen.test.tsx`, `SchichtmodelleTab.test.tsx`, `BenutzerPage.test.tsx`, `SprechgruppenTab.test.tsx`, Tabs Fahrzeuge/Personal/Material

## 5. Listen und eigene Zeilen (D3, D6)

- [x] 5.1 Pegel: Hülle um `ListenEintrag`, Beschreibung mit Index aus der Zeile; TDD Rechtsklick auf den ersten Pegel zeigt „Nach oben“ gesperrt; `EinsatzPegel.test.tsx` grün
- [x] 5.2 Geräte und Lagemonitor-Zugänge: dasselbe; TDD Rechtsklick zeigt die Einträge des ⋮, beendete/widerrufene Zeilen ohne eigenes Menü; Bestandstests grün
- [x] 5.3 Fahrzeuge/Besatzung: Handler an `einheit-person`, ⋮ aus derselben Beschreibung; TDD Rechtsklick zeigt die Einträge, Rechtsklick auf den Namens-Link öffnet kein eigenes Menü; `FahrzeugeBesatzung.test.tsx` grün
- [x] 5.4 Bild-Hintergründe: Handler am Namensteil; TDD Rechtsklick auf den Namen öffnet das Menü, auf Schalter und Regler nicht, ohne Schreibrecht nicht; `Sidebar.test.tsx` grün

## 6. Kommunikationsplan und Personen (D7)

- [ ] 6.1 Kommunikationsplan: Primäraktion und ⋮ einmal beschrieben, als `karte.aktion`/`karte.weitere` an die `Datensicht`, Spalte rendert daraus; TDD Rechtsklick auf eine gepflegte Stelle zeigt „+ Verbindung“, die ⋮-Einträge und rot „Stelle entfernen“; ohne Netz alle gesperrt; Gruppen- und abgeleitete Zeilen ohne eigenes Menü; `KommunikationsplanPage.test.tsx` grün
- [ ] 6.2 Personen: Test in `PersonenPage.zeilenaktionen.test.tsx`, dass Rechtsklick auf eine Personenzeile die Einträge des Zeilenmenüs zeigt (keine Codeänderung)

## 7. Regel, Doku, Nachweis

- [ ] 7.1 `frontend/AGENTS.md`, „Kontextmenü nur über den Baustein“: Tabellen über `KatalogTabelle.zeilenMenue`, Listen und eigene Zeilen über `useDatensatzKontextMenue`, eine Beschreibung für ⋮ und Kontextmenü (D8)
- [ ] 7.2 Anwenderdoku: `docs/anwender/kapitel/einsatz-oberflaeche.md` — der Absatz zum Kontextmenü nennt auch Verwaltungstabellen und Einstellungslisten; `quellen:` ergänzt; Doku-Wächter grün
- [ ] 7.3 e2e `frontend/e2e/kontextmenue-datensatz.spec.ts` um eine Verwaltungstabelle erweitern: Rechtsklick auf eine Zeile der externen Stellen am breiten Schirm zeigt die Aktionen der Knopfreihe; Umschalt+F10 vom Knopf „Bearbeiten“ öffnet es
- [ ] 7.4 `./scripts/check-all.sh` grün (lokal mindestens `--nur schnell` und `--nur frontend`, dazu die e2e-Spec aus 7.3)
- [ ] 7.5 Bilder der Änderung (Kontextmenü in einer Stammdaten-Tabelle breit, in der Pegelliste, im Kommunikationsplan) per Wegwerf-Spec aufnehmen

## Workflow follow-up

- `/opsx:archive lor2qhep-kontextmenue-tabellen` im selben Branch vor dem PR
- PR gegen `alpha`, Zunder LLH-1599 auf `review` mit `pr_url`
