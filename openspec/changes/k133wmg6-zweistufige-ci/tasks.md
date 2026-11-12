# Tasks

## 1. Ausgangsstand

- [x] 1.1 Warten, bis PR #1289 (LLH-1660) auf `alpha` gemergt ist; dann den Branch auf `origin/alpha` bringen (Merge, kein Rebase) und prüfen, dass `scripts/nur-umnummeriert.sh`, `scripts/stau-waechter.sh` und der Schritt „Nur umnummeriert?“ in `ci.yml` vorliegen. Weicht #1289 im Merge-Stand von design.md (Context) ab, die Change per `/opsx:update` nachziehen, bevor Code entsteht

## 2. Auswahl der Suiten als Skript (D5, D6)

- [x] 2.1 Test zuerst: `scripts/ci-auswahl.test.sh` mit Attrappe für die Check-Run-Abfrage, Fälle: Push → alles; PR Stufe `eins` mit Diff (Frontend, Doku, `src-tauri/`); Stufe `zwei` mit Diff; reine Umnummerierung mit Frontend grün/rot/fehlend und e2e grün/fehlend am Vorgänger je Stufe; Abfrage scheitert → alles. Rot gegen ein fehlendes Skript
- [x] 2.2 `scripts/nur-umnummeriert.sh gruen <suite>` (`frontend` | `e2e`) umsetzen, die Rust-Abfrage entfällt; bestehende Fälle in `scripts/nur-umnummeriert.test.sh` auf das Argument umstellen und Fälle „Vorgänger ohne e2e, Frontend grün“ ergänzen; Selbsttest grün
- [x] 2.3 `scripts/ci-auswahl.sh <stufe>` umsetzen (Logik aus dem Job `aenderungen` samt Umnummerierung, Fehler → alles), bis 2.1 grün ist; Selbsttest an Schritt 11 von `check-all.sh` hängen und `./scripts/check-all.sh --nur schnell` (Schritt 11) grün
- [x] 2.4 Job `aenderungen` in `ci.yml` auf `scripts/ci-auswahl.sh eins` umstellen (Ausgaben `rust`, `frontend`; Zusammenfassung bleibt); prüfen per `actionlint` falls vorhanden, sonst `yq` auf gültiges YAML

## 3. Zweite Stufe als eigener Workflow (D1–D4)

- [x] 3.1 Test zuerst: `scripts/ci-stufen.test.sh` prüft `ci.yml` und `e2e.yml` auf die Form aus D3/D4 (Matrix mit `check: [e2e-Binary]` an `binaer`, Fertig-Bedingung als Job-`if` an `aenderungen`, `binaer`, `e2e`, „e2e betroffen“ nur an Schritten, kein Job in `ci.yml` mit dem Namen `e2e-Binary` oder `e2e k/4`, `release.needs` nennt `schnell`, `rust`, `frontend`, `e2e`, Auslöser-Typen und `workflow_call` vorhanden, Nebenläufigkeitsgruppe nach D4). Rot gegen den heutigen Stand
- [x] 3.2 `.github/workflows/e2e.yml` anlegen: Jobs `aenderungen` (`ci-auswahl.sh zwei`), `binaer`, `e2e`, `berichte` (nur Playwright, Laufzeiten) aus `ci.yml` übernehmen, Kopf-Kommentar mit Stufen, Fertig-Regel, fehlenden Pflicht-Checks und Nebenläufigkeit; Actions per SHA gepinnt wie in `ci.yml`
- [x] 3.3 `ci.yml` umbauen: `binaer` und `e2e` entfernen, Aufruf-Job `e2e` (`uses: ./.github/workflows/e2e.yml`, `if: github.event_name == 'push'`), `berichte` nur noch Vitest, Kopf-Kommentar („Nur die betroffenen Suiten“, neu „Zwei Stufen“) nachziehen; 3.1 grün
- [x] 3.4 Kommentar in `scripts/check-all.sh` (Zeile zum `e2e-Binary`) und `scripts/e2e-anteile.mjs` auf den neuen Ort prüfen und nachziehen; `grep -rn "ci.yml" scripts/ .github/ docs/ AGENTS.md` auf Verweise, die jetzt `e2e.yml` meinen
- [x] 3.5 Regel in `scripts/AGENTS.md` (Abschnitt „Im PR laufen nur die betroffenen Suiten“ ergänzen: zwei Stufen, fertig = Auto-Merge oder Label `e2e`, Pflicht-Checks fehlen davor, Label für Rückmeldung ohne Merge) und Zeile in `.claude/skills/dev-zunder-ausfuehren/SKILL.md`, Schritt 4 (e2e auf GitHub erst nach Auto-Merge oder Label `e2e`; früher lokal `check-all.sh --geaendert`); prüfen per Lesen, dass die Regel nur einmal steht
- [x] 3.6 `docs/architektur/07-verteilungssicht.md`, Abschnitt 7.7: Diagramm um `e2e.yml` ergänzen (PR → `ci.yml`; Auto-Merge/Label → `e2e.yml`; Push → `ci.yml` ruft `e2e.yml`); `./scripts/check-all.sh --nur schnell` (Architekturdoku-Schritt) grün

## 4. Stau-Wächter: Auto-Merge ohne e2e-Lauf (D8)

- [x] 4.1 Test zuerst in `scripts/stau-waechter.test.sh`: Auto-Merge seit über 20 min, kein e2e-Check-Run → Hinweis; e2e läuft oder ist fertig → kein Hinweis; ohne Auto-Merge → kein Hinweis; Auto-Merge vor 5 min eingeschaltet auf altem Kopf → kein Hinweis; danach e2e da → Hinweis „behoben“. Rot gegen den heutigen Wächter
- [x] 4.2 Befund in `scripts/stau-waechter.sh` umsetzen (Uhr nach D8, kein Push, Hinweis-Regeln wie beim Konflikt), bis 4.1 grün; Mutationsprobe: Wartezeit-Vergleich umdrehen und Auto-Merge-Bedingung entfernen, beide getötet

## 5. Messung (D9)

- [x] 5.1 Test zuerst: `scripts/ci-messung.test.sh` mit eingespielten API-Antworten (Läufe zweier PRs über zwei Workflows, ein abgebrochener, ein übersprungener Job) prüft Zeilen je PR und Summe
- [x] 5.2 `scripts/ci-messung.sh --von --bis` umsetzen, bis 5.1 grün; Selbsttest an Schritt 11. Das Nachrechnen der Messung vorher über die echte API geht in der Cloud-Sitzung nicht (`gh` ist dort nur für die Suche freigegeben); es wandert in die Folgeaufgabe aus 6.5, die beide Zeiträume mit demselben Skript misst (Läufe bleiben 90 Tage abrufbar). Vermerk in design.md „Nachträge“

## 6. Abschluss

- [x] 6.1 Mutationsproben an den Workflows (D7): Job-`if` an `e2e` in `e2e.yml` entfernen, Matrix an `binaer` entfernen, `e2e`-Aufruf in `ci.yml` auf alle Ereignisse öffnen, `gruen e2e` auf Frontend-Checks verbiegen; jede von einem Selbsttest getötet, Ergebnis in design.md „Nachträge“
- [x] 6.2 `openspec validate k133wmg6-zweistufige-ci --strict` grün
- [ ] 6.3 `./scripts/check-all.sh --geaendert` lokal so weit möglich; der volle Beleg ist die CI des PRs (Stufe 1 bei jedem Push, Stufe 2 nach Label `e2e` am eigenen PR, bevor Auto-Merge an ist)
- [ ] 6.4 Probe am eigenen PR: ohne Label stehen `e2e-Binary` und `e2e 1/4` bis `4/4` auf „Expected“; Label `e2e` setzen → zweite Stufe läuft ohne neuen Commit; Label entfernen während des Laufs → Abbruch. Beobachtung in design.md „Nachträge“
- [ ] 6.5 Zunder-Folgeaufgabe anlegen (`zunder-task-anlegen`): einen Werktag nach dem Merge mit `scripts/ci-messung.sh` nachmessen und mit dem Wert vorher vergleichen; Link in design.md „Nachträge“

## Workflow follow-up

- `/opsx:archive k133wmg6-zweistufige-ci` im selben Branch vor dem PR, Spec-Sync und Verweise nachziehen.
- PR gegen `alpha`; Bilder entfallen (keine sichtbare Wirkung in der App), dafür ein Satz und die Check-Liste aus 6.4.
