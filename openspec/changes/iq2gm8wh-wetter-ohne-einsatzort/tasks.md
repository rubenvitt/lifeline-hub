# Tasks

Per TDD, Test zuerst rot. Pfade relativ zu `frontend/src/`.

## 1. Paneele knapp (D2)

- [x] 1.1 `StandHinweis` in `wetter/WetterPaneele.tsx` zeigt bei `kein_ort` nur „ohne Einsatzort“ ohne Knopf; `onEinsatzdaten` an `WarnungenPaneel` entfällt. `AktuellPaneel.test.tsx` und die Paneel-Tests erwarten „ohne Einsatzort“ und keinen Knopf; Tests grün

## 2. Seitenhinweis (D1)

- [x] 2.1 `pages/WetterPegelPage.tsx`: Bei `kein_ort` steht über dem Warnpaneel in voller Breite der Hinweis „Einsatzort nicht verortet — Warnungen, Vorhersage und aktuelle Bedingungen brauchen eine Koordinate“ mit dem Knopf „Einsatzort in den Einsatzdaten verorten“ (`data-lfh="wetter-kein-ort"`), der zu den Einsatzdaten führt. `WetterPegelPage.test.tsx` (heute: dreimal „Einsatzort nicht verortet“) erwartet den Satz und den Knopf genau einmal und dreimal „ohne Einsatzort“; kein Hinweis bei Laden oder Fehler. Tests grün
- [x] 2.2 `docs/anwender/kapitel/wetter-pegel.md` (Abschnitt „Das Wetter gilt für den Einsatzort“) auf Seitenhinweis und knappe Paneele anpassen; Wächter der Anwenderdoku grün

## 3. Integration

- [ ] 3.1 `./scripts/check-all.sh --geaendert --ohne-e2e` grün (gemeinsam mit der Lagekarten-Change im selben Branch)

## Workflow follow-up

- Review vor dem PR, dann `/opsx:archive` im selben Branch.
