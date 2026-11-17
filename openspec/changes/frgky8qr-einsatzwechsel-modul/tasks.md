# Tasks

Zunder: LLH-1821 (https://zunder.rubeen.dev/#/aufgabe/frgky8qras9lz4ugohwejiju). Jede Aufgabe
per TDD.

## 1. Modul-Hinweis (D1)

- [x] 1.1 `routing/deeplinks.ts`: `einsatzPfad(id, {modul})` und `parseModulHinweis`; Deeplink-Test (bekannter Schlüssel, unbekannter verworfen, ohne Hinweis unverändert)
- [x] 1.2 `DefaultModulRedirect.tsx`: mit Hinweis auf Freigaben warten, freies Modul → dessen Startseite, gesperrt/ausgeblendet/nicht fertig/unbekannt → bisheriges Ziel; `DefaultModulRedirect.test.tsx` für jeden Fall und gegen Doppel-Navigation
- [ ] 1.3 `EinsatzSwitcher.tsx` hängt das aktuelle Modul an; Test: Wechsel aus `/einsaetze/7/fahrzeuge?fahrzeug=3` führt auf `/einsaetze/8?modul=fahrzeuge` und weiter auf `/einsaetze/8/fahrzeuge`
- [ ] 1.4 `command-palette/befehle.ts`: Einsatzwechsel mit Modul-Hinweis, auch für Strg+↵; `befehle.test.ts`
- [ ] 1.5 „Zuletzt besucht“: Test, dass die Ankunft im selben Modul nicht aufzeichnet; Tabelle der Ankünfte in `zuletztModule.ts` nachziehen

## 2. Nebenzeile (D2)

- [ ] 2.1 Reiner Helfer für die Nebenzeile (Art außer bei Übung, Kennung oder „seit TT.MM.“, Ort) mit Unit-Tests; Wechsler nutzt ihn; `EinsatzSwitcher.test.tsx` für Sanitätsdienst mit Nummer und Übung ohne Nummer

## 3. Doku und Verifikation

- [ ] 3.1 `docs/anwender/kapitel/einsatz-oberflaeche.md`, „Zwischen Einsätzen wechseln“: Modul bleibt, Rückfall aufs Standardmodul, Nebenzeile; Wächter der Anwenderdoku grün
- [ ] 3.2 `./scripts/check-all.sh --geaendert --ohne-e2e` grün

## Workflow follow-up

- Review vor dem PR über den ganzen Branch (LLH-1811, Phase 4), dann `/opsx:archive`.
