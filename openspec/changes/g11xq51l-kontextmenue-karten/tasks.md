## 1. Geteilte Hörer in `useKontextMenue` (D1)

- [ ] 1.1 TDD: zwei eingehängte Flächen teilen einen Satz Fensterhörer und einen Nachklick-Riegel (Zählung über `addEventListener`-Spione); nach dem Aushängen der letzten Fläche hängt kein Hörer mehr
- [ ] 1.2 TDD: Tasten-Nachlauf, Stift-Riegel und Abheben am `window` wirken mit zwei Flächen genau einmal; das Abheben beendet nur den Druck der Fläche, die ihn hält
- [ ] 1.3 Umbau auf Modulzustand mit Zählung; alle bestehenden Tests von `useKontextMenue`, `Datensicht.kontextmenue`, `KontextMenue` und Skizze bleiben grün, Schnittstelle unverändert

## 2. Kartenbaustein (D2, D3)

- [ ] 2.1 TDD: `kartenKontextEintraege(aktionen)` liefert die Einträge in Lieferreihenfolge, gesperrte mit Grund im Etikett, rote über `menueEintraege()` hinter einem Trenner
- [ ] 2.2 TDD: `useKartenKontext` — Rechtsklick auf das Element öffnet `KontextMenue` mit allen Aktionen; ohne Aktion bleibt das Browsermenü; verliert die Karte alle Aktionen, schließt das Menü
- [ ] 2.3 TDD: Wahl ohne `rueckfrage` ruft `onWahl` sofort; mit `rueckfrage` öffnet ein Dialog mit Titel, Knopf und Gefahrfarbe, erst OK ruft `onWahl`; Abbrechen löst nichts aus
- [ ] 2.4 `ListenEintrag` nimmt `kontext?: KontextHandler<HTMLLIElement>` und spreizt ihn an das `<li>`; `Liste.test.tsx` um einen Test ergänzt

## 3. Chat (D4)

- [ ] 3.1 Einträge und Wahl einer Nachricht in eine Funktion ziehen, die ⋮ und Kontextmenü speist; bestehende Tests von `NachrichtenStrom` grün
- [ ] 3.2 TDD: Rechtsklick neben den Text einer eigenen Nachricht öffnet das Menü mit denselben Einträgen wie ihr ⋮; „Löschen“ öffnet den bestehenden Dialog; Rechtsklick auf den Anhang und auf eine gelöschte Nachricht öffnet kein eigenes Menü

## 4. Meldung, Nachforderung, Auftrag (D3, D6)

- [ ] 4.1 `MeldungKarte`: Aktionen als `KartenAktion[]` (Bestätigen mit Rückfrage „Sofortmeldung bestätigen?“, Fortschaltung, `weitere`), Knopfzeile und ⋮ daraus; TDD: Kontextmenü zeigt Knöpfe vor ⋮-Einträgen, auch unter drei Aktionen, ohne Zuweisung; Bestandstests grün
- [ ] 4.2 `NachforderungKarte`: Fortschaltung, Übernahmen (gesperrt mit Grund), Zuordnen und ⋮-Einträge (Bearbeiten, Zurückziehen, Ablehnen, Eintreffen zurücknehmen) als `KartenAktion[]`; TDD: Reihenfolge, gesperrte Übernahme mit Grund, rote Abschlüsse hinter dem Trenner; Bestandstests grün
- [ ] 4.3 `AuftragTeile`: `auftragAktionen(…)` als reine Funktion (In Bearbeitung, Vollzug melden, Abnehmen mit Rückfrage „Auftrag abnehmen?“, Berichtigen, Aufheben); `AuftragHandlungen` rendert daraus, `AuftragKarte` bindet `useKartenKontext` an, `AuftragDetail` nicht; TDD: Kontextmenü der Karte und Rückfrage „Abnehmen“; Bestandstests grün

## 5. Ablösung und Verpflegung (D3, D6)

- [ ] 5.1 `AbloesungKarte`: „Ablösung vollziehen“, ⋮-Einträge und „Vollzug zurücknehmen“ als `KartenAktion[]`, Kontextmenü am `<article>`; TDD: laufende Schicht zeigt alle Einträge, beendete mit Rücknahme nur „Vollzug zurücknehmen“; Bestandstests grün
- [ ] 5.2 `verpflegung/StellenListe`: Kontextmenü je Stelle aus der bestehenden Aktionsliste; TDD: aktive Stelle zeigt „Bearbeiten …“, Trenner, rot „Auflösen …“; läuft die Inbetriebnahme, stehen die Einträge gesperrt; Bestandstests grün
- [ ] 5.3 `ZeitfensterKarte`: Kontextmenü aus `aktionen` ohne „Ausgabe öffnen“; „Bedarf bearbeiten“ gesperrt mit Grund, solange eine andere Bearbeitung offen ist; TDD dazu; Bestandstests grün
- [ ] 5.4 `AusgabeAnsicht`: Kommentar am ⋮ „Weitere Kostform“ verweist auf die Spec „Ein Zählschirm hat kein Kontextmenü“; Test, dass ein Rechtsklick auf eine Zähltaste kein eigenes Menü öffnet

## 6. Betreuung über den Kartenplan (D5)

- [ ] 6.1 `StellenBlock`: Kartenplan mit `aktion` „Belegung melden“ und `weitere` aus `stellenMenue`; Spalte und Kennungsknopf aus derselben `aktion`; TDD: Rechtsklick auf eine unverortete Stelle zeigt „Belegung melden“, „Auf Karte verorten“, Trenner, rot „Stornieren“; namentliche Stelle ohne „Belegung melden“; Bestandstests grün
- [ ] 6.2 `BezirkTabelle`: Kartenplan mit `aktion` „Stand melden“ und `weitere` aus `bezirkMenue`; Spalte aus derselben Quelle; TDD analog; Bestandstests grün

## 7. Regeln, Doku, Nachweis

- [ ] 7.1 `frontend/AGENTS.md`, Regel „Kontextmenü nur über den Baustein“: Karten über `useKartenKontext` mit `KartenAktion[]` als einer Quelle für Knöpfe, ⋮ und Kontextmenü; Sprünge und Auswahlfelder nicht; Zählschirm ohne; Prettier grün
- [ ] 7.2 `docs/anwender/kapitel/einsatz-oberflaeche.md`, „Wo das Kontextmenü gilt“: Chat, Meldungen, Nachforderungen, Aufträge, Ablösung, Betreuung, Verpflegung ergänzt, Zählschirm ausgenommen; `quellen:` um die neuen Bausteine ergänzt; Doku-Wächter grün
- [ ] 7.3 e2e `frontend/e2e/kontextmenue-karten.spec.ts`: Rechtsklick auf eine Meldung zeigt Knöpfe und ⋮-Einträge; Umschalt+F10 mit Fokus auf einem Knopf der Karte öffnet es, Escape gibt den Fokus zurück; langer Druck per CDP-Touch bei 390 px auf eine Chat-Nachricht öffnet ihr Menü
- [ ] 7.4 `./scripts/check-all.sh` grün (lokal mindestens `--nur schnell` und `--nur frontend`, dazu die neuen e2e-Specs; den Rest belegt die CI des PRs)
- [ ] 7.5 Bilder der Änderung (Kontextmenü an Meldung, Nachforderung, Chat, Betreuungstabelle) per Wegwerf-Spec aufnehmen

## Workflow follow-up

- `/opsx:archive g11xq51l-kontextmenue-karten` im selben Branch vor dem PR
- PR gegen `alpha`, Zunder LLH-1598 auf `review` mit `pr_url`
