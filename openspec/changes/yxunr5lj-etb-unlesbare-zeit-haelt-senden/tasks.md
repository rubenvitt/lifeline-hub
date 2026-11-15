# Tasks

Zunder: https://zunder.rubeen.dev/#/aufgabe/yxunr5ljwl6dhhkwnq7d9uaj (LLH-1866). Jede Aufgabe per
TDD: erst der Test, der ohne die Änderung rot ist.

## 1. Zeitfeld meldet eine verworfene Eingabe (D1)

- [x] 1.1 `anzeige/ZeitpunktEingabe.tsx`: optionaler Prop `onDiscard(grund | null)`, aufgerufen beim
  Verwerfen im `onBlur` und mit `null`, sobald der Grund weicht (Tippen, Wahl, Escape). Prüfen:
  Tests in `ZeitpunktEingabe.test.tsx` für Verwerfen, erneutes Tippen und Kalenderwahl; ein Test
  belegt, dass ein Formular ohne `onDiscard` wie bisher den unveränderten Wert sendet
  (Spec `zeiteingabe`, „Verlassen mit unlesbarer Eingabe“).

- [x] 1.2 Enter auf den gezeigten Wert und Escape ohne Tippen nehmen den Grund zurück (D1a), Escape
  wird dann verbraucht. Prüfen: Tests in `ZeitpunktEingabe.test.tsx` für beide Tasten.

## 2. ETB hält das Senden an (D1–D4)

- [x] 2.1 `etb/EtbFeldzeile.tsx` reicht `onDiscard` des Felds Zeit durch; `etb/Schnellerfassung.tsx`
  führt `zeitVerworfen` und setzt es beim Entwurfswechsel zurück. Prüfen: Test in
  `Schnellerfassung.test.tsx`, dass ein Wechsel des Entwurfs keinen Grund mitnimmt.
- [x] 2.2 `absenden()` hält an, wenn `zeitVerworfen` oder `zeitBefehlGrund` gesetzt ist, nach
  Von/An-Pflicht und Zeichengrenzen, vor der Zukunftsprüfung; Grund „Zeit nicht übernommen: …“ als
  `role="alert"` in der Fußzeile, Feld Zeit in der Fehlerrolle, Fokus dorthin. Prüfen: Tests für
  „14:3x“ + Klick auf „Erfassen“ (`blur` dann `click`), „2460“ + Enter im Inhalt, „/zeit 2590 Pumpe“
  + „Erfassen“; jeweils kein Aufruf des Sendewegs, Text bleibt, Fokus im Feld Zeit.
- [x] 2.3 Freigabe nach dem Halt: Feld leeren, Enter oder Escape im Feld, lesbare Zeit tippen, Kalenderwahl, `/zeit`
  berichtigen oder löschen. Prüfen: je ein Test, dass danach gesendet wird, mit der erwarteten
  Ereigniszeit.
- [x] 2.4 e2e im echten Browser: in `e2e/etb-zeitdarstellung.spec.ts` „14:3x“ ins Feld Zeit, direkt
  „Erfassen“ klicken, kein neuer Eintrag, Grund sichtbar; Feld leeren, „Erfassen“, Eintrag da.
  Prüfen: die Spec läuft in Chromium grün.

## 3. Doku und Regeln

- [x] 3.1 `docs/anwender/kapitel/einsatztagebuch.md`, „Felder, Bausteine und Werte setzen“, Punkt 2
  und 3: unlesbare Zeit und unlesbares `/zeit` halten das Senden an, Ausweg Feld leeren oder Zeit
  berichtigen. Prüfen: Doku-Wächter in `./scripts/check-all.sh --geaendert --ohne-e2e` grün.
- [x] 3.2 `frontend/src/etb/AGENTS.md` nur ergänzen, falls dort die Prüfkette von `absenden()`
  beschrieben ist (sonst nichts). Prüfen: `grep -n "zukunftsVerstoss\|Zukunft" frontend/src/etb/AGENTS.md`.

## 4. Abschluss

- [ ] 4.1 `./scripts/check-all.sh --geaendert --ohne-e2e` grün; Ergebnis im PR unter „Geprüft“.

## Workflow follow-up

- Review vor dem PR über den ganzen Branch (zusammen mit LLH-1847 und LLH-1887).
- `/opsx:archive yxunr5lj-etb-unlesbare-zeit-haelt-senden` vor dem PR, im selben Branch.
