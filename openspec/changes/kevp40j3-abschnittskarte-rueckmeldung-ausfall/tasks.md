# Tasks

Voraussetzung: Gruppe 1 der Change `g1u57q0f-meldebild-alarm-etiketten` ist umgesetzt
(Rolle, `rueckmeldungUeberfaelligSeit`, `grundWort`).

## 1. Ausfall aus dem Meldebild

- [x] 1.1 `ausfallJeEinheit` in `ueberblickDaten.ts` liest den Ausfall je Einheit aus dem Meldebild-Raster (`toenungsGruende`), statt eines eigenen Kerns (design.md, Entscheidung 2). `meldebildRaster.test.ts` bleibt grün.

## 2. Abschnittskarte im Überblick

- [x] 2.1 `abschnittZeilen` führt `einheitIds`, `ausfallMittel`, `ausfallMaterial` je Zeile; Tests in `ueberblickDaten.test.ts` zuerst (rot): Ausfall-Summe gleicht der Summe der Meldebild-Zeilen derselben Einheiten. Umgesetzt mit `einheitenRueckmeldung` statt `einheitIds` (Urteil im Render über `abschnittGruende`).
- [x] 2.2 `abschnittGruende(zeile, jetzt)` (vorher als `abschnittRueckmeldung` geplant, liefert alle Gründe der Karte) mit Tests: eine überfällige neben einer frischen → 1, längste 47; drei überfällige → 3; Einheit ohne Rückmeldung → `keine`; Daten unbekannt → `null`.
- [x] 2.3 `grundWort` um die Mehrzahl erweitern („3 Einh. Rückm. überfällig, längste seit 47 min“, „2 Einh. ohne Rückm.“); Tests.
- [x] 2.4 `abschnittGliederung`: Alarm-Chips hinter dem Lagezustand (Rückmeldung mit `jetzt`, Ausfall), dritte Verteilungszelle „nicht verfügbar“. Seitentest in `UeberblickPage.test.tsx`: Abschnitt „planmäßig“ mit überfälliger Einheit zeigt „planmäßig“ UND „Rückm. überfällig seit 47 min“ (`data-rolle="alarm"`); kein Chip, solange die Rückmeldungen laden.

## 3. Regel und Doku

- [x] 3.1 `frontend/AGENTS.md`, „Eine Heimat je Zahl“: Ausfall einer Einheit nur über die Gründe der Tönung des Meldebilds (`toenungsGruende`), Rückmeldung eines Abschnitts je Einheit. Prettier über `frontend/` grün.
- [ ] 3.2 `docs/anwender/kapitel/ueberblick.md` Schritt 4 (Etiketten, „nicht verfügbar“, Lagezustand bleibt) und Bild über den Bildlauf erneuern; `mise exec -- openspec validate kevp40j3-abschnittskarte-rueckmeldung-ausfall --strict` grün.

## Workflow follow-up

- Gemeinsamer Review vor dem PR über den ganzen Branch (Welle 1 von LLH-1717).
- `/opsx:archive kevp40j3-abschnittskarte-rueckmeldung-ausfall` vor dem PR, im selben Branch.
