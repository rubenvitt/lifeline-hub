# Tasks

## 1. Meldung ohne Abbruch (`scripts/ziel-branch-build.sh`)

- [ ] 1.1 Selbsttest zuerst rot machen: In `scripts/ziel-branch-build.test.sh` erwarten die Fälle „überholt“ (9, 10) kein `PATCH … cancelled` mehr, sondern ein `PATCH <id> in_progress` mit dem Text „Überholt“. Der Fall Einzellauf (bisher `PATCH 800 cancelled;POST …`) erwartet nur noch den frischen `POST`. `scripts/ziel-branch-build.test.sh` ist rot.
- [ ] 1.2 Neue Fälle im Selbsttest: (a) `melden` grün schließt ältere offene Checks des Kopfes (IDs kleiner) mit `success`, (b) ein offener Check mit größerer ID bleibt unberührt, (c) abgeschlossene ältere Checks werden nicht neu geschrieben, (d) ist die Liste der Checks nicht lesbar, wird der eigene Check trotzdem geschlossen und der Lauf endet mit 0. Die Fälle sind rot.
- [ ] 1.3 `einzellauf`: den „Übernommen“-PATCH entfernen. `melden`: bei „überholt“ nur Titel und Text setzen und den Status `in_progress` lassen. Nach gültigem Ergebnis alle offenen Checks des Namens mit kleinerer ID auf dem Kopf mit demselben Ergebnis schließen. Skriptkopf nachziehen. `scripts/ziel-branch-build.test.sh` ist grün.

## 2. Warteschlange (`.github/workflows/ziel-branch-build.yml`)

- [ ] 2.1 Formprüfung zuerst: `F10` in `scripts/ziel-branch-build.test.sh` erwartet `cancel-in-progress: false` und lehnt `cancel-in-progress: true` ab. Das ist rot.
- [ ] 2.2 `concurrency` auf `cancel-in-progress: false`, Kommentar dazu und Kopfkommentar („WANN“, Gruppe) auf den neuen Ablauf. `scripts/ziel-branch-build.test.sh`, `scripts/ci-stufen.test.sh` und `actionlint` (falls im Gate) sind grün.

## 3. Stau-Wächter absichern und Doku

- [ ] 3.1 `scripts/stau-waechter.test.sh`: neuer Fall. Auf dem Kopf steht `Baut mit Ziel-Branch` erst `completed/success`, danach jünger `in_progress`, Auto-Merge ist an. Dann gibt es keinen Hinweis „grün, nicht gemergt“. Der Test ist grün (Absicherung des Bestands).
- [ ] 3.2 `scripts/AGENTS.md`, Abschnitt „Baut mit Ziel-Branch“: Warteschlange statt Abbruch, kein `cancelled` bei Überholung, ein gültiges Ergebnis schließt ältere offene Checks. Prettier ist für `scripts/AGENTS.md` nicht zuständig. `scripts/check-all.sh --nur schnell` (bzw. das passende Bündel) ist grün.

## 4. Gesamtprüfung

- [ ] 4.1 `./scripts/check-all.sh` mit den Bündeln für `scripts/` und `.github/` ist grün, belegt durch die CI des PRs.

## Workflow follow-up

- Review vor dem PR, dann `/opsx:archive` im selben Branch, dann PR gegen `alpha`.
- Wirkung nach dem Merge beobachten: Läufe je PR und Wartezeit bei Merge-Serien. Messwerte gehen nach LLH-1890.
