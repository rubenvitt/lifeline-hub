# Tasks

Zunder: https://zunder.rubeen.dev/#/aufgabe/s4u2yl0p5icigp4lx42mgu4e

## 1. Laufzeile auf jeder Seite

- [x] 1.1 Bildung „Bezeichnung (Nummer)“ aus `components/druck/Druckkopf.tsx` als Funktion herausziehen und dort nutzen; Unit-Test mit und ohne interne Nummer (leere/Leerzeichen-Nummer → keine Klammern) grün, bestehende Druckkopf-Tests grün
- [x] 1.2 `EtbDruckTabelle` bekommt die Laufzeile als erste `thead`-Zeile (`colSpan` über alle Spalten, `data-lfh="etb-druck-laufzeile"`), `EtbDruckPage` bildet Einsatz- und Stand-Text einmal und reicht ihn an Druckkopf und Tabelle; Test in `pages/EtbDruckPage.test.tsx` (Text „Einsatztagebuch · … · Stand … · bis Nr. N“ im `thead`, keine Tabelle bei leerer Auswahl) per TDD rot→grün
- [x] 1.3 `e2e/etb-druck.spec.ts`: im Chromium-PDF trägt jede Seite Einsatzbezeichnung und „bis Nr.“; Druckbild prüft weiter sechs Spaltenköpfe; Lauf in Chromium und Firefox grün (WebKit unverändert)

## 2. Systemeinträge verdichtet

- [x] 2.1 `EtbDruckTabelle`: Systemeintrag als verdichtete Zeile (Nr., Zeit, eine Zelle über vier Spalten mit „System · Inhalt · Erfasser“, Berichtigungshinweise, `data-lfh="etb-druck-system"`, kleinere Schrift, Absatzränder 0); Komponententest (neu `etb/EtbDruckTabelle.test.tsx` oder in `EtbDruckPage.test.tsx`): Folge 86–89 lückenlos, 87/88 verdichtet mit Inhalt und Erfasser, 86/89 voll; per TDD rot→grün
- [x] 2.2 Schmaler Schirm: verdichtete Zeile bei 390 px ohne Metazeile, Zelle über die Breite; mobiles Gate (`e2e/druckansicht-mobil-kern.ts` bzw. Handy-Teil von `etb-druck.spec.ts`) grün
- [x] 2.3 `e2e/etb-druck.spec.ts`: Systemeinträge im Druckbild als verdichtete Zeilen; Seitenzahl des PDFs mit vielen Systemeinträgen als Messwert-Annotation festhalten

## 3. Regeln und Doku

- [x] 3.1 `frontend/src/druck/AGENTS.md`, „ETB-Druck“: Laufzeile im `thead` statt `@page`-Text, Systemeinträge verdichtet; Prettier über `frontend/` grün
- [ ] 3.2 `docs/anwender/kapitel/drucken-export.md`, Abschnitt ETB-Druckansicht: Laufzeile (mit Hinweis Safari nur Seite 1) und verdichtete Systemeinträge beschreiben; Bild nach `docs/anwender/AGENTS.md` erneuern, falls es die Stelle zeigt; Doku-Wächter grün

## 4. Gesamtprüfung

- [ ] 4.1 `./scripts/check-all.sh --geaendert --ohne-e2e` grün und die Druck-Specs `etb-druck` in Chromium, Firefox, WebKit grün

## Workflow follow-up

- `/opsx:archive s4u2yl0p-etb-druck-kopfzeile-verdichten` im selben Branch vor dem PR.
- Bilder der Änderung (Seite 2 mit Laufzeile, verdichtete Systemeinträge) in PR und Meldung.
