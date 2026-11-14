# Tasks

## 1. Meldung ohne Abbruch (`scripts/ziel-branch-build.sh`)

- [x] 1.1 Selbsttest zuerst rot machen: In `scripts/ziel-branch-build.test.sh` erwarten die Fälle „überholt“ (9, 10) kein `PATCH … cancelled` mehr, sondern ein `PATCH <id> in_progress` mit dem Text „Überholt“. Der Fall Einzellauf (bisher `PATCH 800 cancelled;POST …`) erwartet nur noch den frischen `POST`. `scripts/ziel-branch-build.test.sh` ist rot.
- [x] 1.2 Neue Fälle im Selbsttest. Die Attrappe liefert wie GitHub ohne `filter=all` nur den jüngsten Run je Name. Fall 9: überholt mit jüngerem Check, der Check läuft weiter. Fall 9c: ohne Nachfolger oder bei nicht lesbaren Checks wird er rot mit „neu starten“. Fall 16: ein gültiges Ergebnis schließt nur den eigenen. Fälle 13b–e: Ein schon gerechneter Stand (`external_id`) wird übernommen statt neu gerechnet. Die Fälle waren rot.
- [x] 1.3 `einzellauf`: den „Übernommen“-PATCH entfernen. `melden`: bei „überholt“ nur Titel und Text setzen und den Status `in_progress` lassen. Nach gültigem Ergebnis alle offenen Checks des Namens mit kleinerer ID auf dem Kopf mit demselben Ergebnis schließen. Skriptkopf nachziehen. `scripts/ziel-branch-build.test.sh` ist grün.

## 2. Warteschlange (`.github/workflows/ziel-branch-build.yml`)

- [x] 2.1 Formprüfung zuerst: `F10` in `scripts/ziel-branch-build.test.sh` erwartet `cancel-in-progress: false` und lehnt `cancel-in-progress: true` ab. Das ist rot.
- [x] 2.2 `concurrency` auf `cancel-in-progress: false`, Kommentar dazu und Kopfkommentar („WANN“, Gruppe) auf den neuen Ablauf. `scripts/ziel-branch-build.test.sh`, `scripts/ci-stufen.test.sh` und `actionlint` (falls im Gate) sind grün.

## 3. Stau-Wächter absichern und Doku

- [x] 3.1 `scripts/stau-waechter.test.sh`: neuer Fall. Auf dem Kopf steht `Baut mit Ziel-Branch` erst `completed/success`, danach jünger `in_progress`, Auto-Merge ist an. Dann gibt es keinen Hinweis „grün, nicht gemergt“. Der Test ist grün (Absicherung des Bestands).
- [x] 3.2 `scripts/AGENTS.md`, Abschnitt „Baut mit Ziel-Branch“: Warteschlange statt Abbruch, kein `cancelled` bei Überholung, Ablösung durch den jüngsten Check, „neu starten“ ohne Nachfolger, `external_id`. Prettier ist für `scripts/AGENTS.md` nicht zuständig. `scripts/check-all.sh --nur schnell` (bzw. das passende Bündel) ist grün.

## 4. Gesamtprüfung

- [ ] 4.1 `./scripts/check-all.sh --geaendert` ist lokal grün, die volle Suite belegt die CI des PRs.

## Workflow follow-up

- Review vor dem PR, dann `/opsx:archive` im selben Branch, dann PR gegen `alpha`.
- Wirkung nach dem Merge beobachten: Läufe je PR und Wartezeit bei Merge-Serien. Messwerte gehen nach LLH-1890.
