# Tasks

TDD je Aufgabe. Pfade im Frontend relativ zu `frontend/src/`. Setzt auf `lsug0joq-tabellen-touch`
(schwebende Bearbeitung in Tabellenzellen) auf.

## 1. h74aqt6p: Zelle „Funktion“

- [x] 1.1 `kraefte/EinsatzfunktionZelle.tsx`: leere Einsatzfunktion mit Qualifikation → Qualifikation als Wert plus Stift über `ausloeser` (D1); ohne Qualifikation bisherige Aufforderung; gesetzt wie bisher (D2); ohne Schreibrecht nur das Gefüllte. Tests in `kraefte/EinsatzfunktionZelle.test.tsx` je Szenario der Delta-Spec rot→grün
- [x] 1.2 Stilfunktion des Stifts mit Böden als Literalen prüfen (`bedienzielStil`-Muster), Unit-Test je Stufe rot→grün; `e2e/kraefte-einsatzfunktion.spec.ts` misst den Stift in der Personalliste in allen drei Stufen, grün (dort liegt der Durchstich der Einsatzfunktion)
- [x] 1.3 `pages/PersonalPage.tsx`: Spaltenbreite „Funktion“ geprüft: bleibt 140 px, eine lange Qualifikation bricht an Wortgrenzen neben dem Stift; `pages/PersonalPage.test.tsx` und `e2e/kraefte-einsatzfunktion.spec.ts` nachziehen, grün

## 2. Regel und Doku

- [x] 2.1 `frontend/AGENTS.md`, „Inline-Bearbeitung und Status“: Listenform der Regel (D3); Prettier grün
- [x] 2.2 `docs/anwender/kapitel/personal.md` (Funktion eintragen über den Stift) samt Bild nach `docs/anwender/AGENTS.md`; Wächter grün

## Workflow follow-up

- `/opsx:archive h74aqt6p-personal-funktion-zelle` im selben Branch vor dem PR.
