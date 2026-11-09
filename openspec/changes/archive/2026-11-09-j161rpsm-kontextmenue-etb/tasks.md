## 1. Schalter `langerDruck` am Baustein (D1)

- [x] 1.1 TDD in `components/useKontextMenue.test.tsx`: mit `langerDruck: false` startet ein Touchdruck keinen Zeitgeber und setzt kein `data-kontext-druck`; ein `contextmenu` nach einem Touch-/Stift-`pointerdown` öffnet nicht und ruft kein `preventDefault`; Rechtsklick (Maus) und Tasten öffnen weiter; Vorgabe `true` unverändert (Bestandstests grün)
- [x] 1.2 Kommentar am Hook und Regel in `frontend/AGENTS.md` („Kontextmenü nur über den Baustein“) um den Schalter ergänzen; Prettier grün

## 2. Eine Quelle der Zeilenaktionen (D2)

- [x] 2.1 TDD `etb/zeilenAktionen.test.ts`: `zeilenAktionen` liefert für einen Eintrag Berichtigen (gesperrt mit Grund), Wiedervorlage, Auftrag erteilen (gesperrt ohne Freigabe) wie bisher, für eine abgelehnte Zeile Erneut senden, Nur protokollieren (nur bei Kopplung und angebotenem Weg), Verwerfen mit `gefahr`
- [x] 2.2 `EtbZeitachsenZeile` baut ⋮ und Knöpfe der abgelehnten Zeile aus diesen Funktionen, Wahl über `fuehreZeilenWahlAus`; Bestandstests `EtbZeitachse.test.tsx` grün

## 3. Kontextmenü an der Zeitachse (D3, D4)

- [x] 3.1 TDD: Rechtsklick auf den Text eines gesendeten Eintrags öffnet das Menü mit denselben Einträgen wie das ⋮ (auch gesperrt); Wahl ruft den Handler genau einmal; Rechtsklick auf vorgemerkte Zeile, Bündelzeile, Eintrag ohne Aktion, Link: kein `preventDefault`, kein Menü
- [x] 3.2 TDD: abgelehnte Zeile zeigt Erneut senden / Nur protokollieren / Trenner / rot Verwerfen; „Verwerfen“ ruft `onVerwerfen` ohne Rückfrage
- [x] 3.3 TDD: Umschalt+F10 bei Fokus auf dem ⋮ einer Zeile öffnet das Menü dieser Zeile; Escape gibt den Fokus zurück; langer Touchdruck öffnet nicht
- [x] 3.4 TDD: offenes Menü hält neue Einträge zurück (Sammelbanner); verschwindet die Zeile, schließt das Menü; nach dem Schließen ohne Fokus in der Achse (Rechtsklick, Escape oder Wahl, Zeile weg) taut sie wieder auf
- [x] 3.5 `EtbZeitachse.render.test.tsx` grün: ein neuer Eintrag rendert keine bestehende Zeile neu (stabile Fabrik)

## 4. Kontextmenü am MetaChip (D5)

- [x] 4.1 TDD in `etb/MetaChip.test.tsx`: Rechtsklick auf einen Chip öffnet Bearbeiten / Trenner / rot Entfernen; Chip aus dem Standard zeigt die Standard-Einträge; `gesperrt` zeigt sie gesperrt; Bearbeiten-Zustand (Eingabefeld) behält das Browsermenü; Wahl ruft dieselben Rückrufe wie das ⋮
- [x] 4.2 `Schnellerfassung.test.tsx` und `kontextMenue.guard.test.ts` grün (kein eigenes `onContextMenu`)

## 5. Regeln und Anwenderdoku

- [x] 5.1 `frontend/src/etb/AGENTS.md`: Kontextmenü an Zeile und Chip, eine Quelle (`etb/zeilenAktionen.ts`), kein langer Druck im ETB; Prettier grün
- [x] 5.2 `docs/anwender/kapitel/einsatz-oberflaeche.md` („Wo das Kontextmenü gilt“: ETB, kein langer Druck dort) und `docs/anwender/kapitel/einsatztagebuch.md` (Rechtsklick auf Eintrag und Chip); `quellen:` nachziehen; Doku-Wächter grün

## 6. Browser-Nachweis und Gate

- [x] 6.1 e2e `frontend/e2e/kontextmenue-etb.spec.ts`: Rechtsklick auf einen ETB-Eintrag zeigt die ⋮-Einträge, „Berichtigen“ öffnet die Berichtigung; Rechtsklick auf einen Chip der Erfassung zeigt dessen Einträge
- [x] 6.2 `./scripts/check-all.sh` grün — lokal Bündel `schnell` grün, dazu die berührten Vitest-Dateien (etb, Kontextmenü-Baustein, Datensicht, Fernmeldewesen; 1426 Tests) und die e2e-Specs `kontextmenue-etb`, `kontextmenue-datensatz`; volle Vitest-, Rust- und e2e-Suite belegt die CI des PRs
- [x] 6.3 Bilder der Änderung (Kontextmenü am Eintrag, an abgelehnter Zeile, am Chip) per Wegwerf-Spec aufnehmen

## Workflow follow-up

- `/opsx:archive j161rpsm-kontextmenue-etb` im selben Branch vor dem PR
- PR gegen `alpha`, Zunder LLH-1597 auf `review` mit `pr_url`
