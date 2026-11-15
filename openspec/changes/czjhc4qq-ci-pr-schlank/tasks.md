# Tasks

## 1. Ruleset-Wächter (LLH-1895, q10lxu1u)

- [x] 1.1 `scripts/ruleset-pruefen.test.sh` anlegen (Attrappen-JSON: in Ordnung, Pin an `Migrationsnummern`, fremde App an `Schnellprüfungen`, fehlende Pflicht, überzählige `e2e 1/4`, strict, zwei Rulesets, kaputtes JSON) und rot sehen; dann `scripts/ruleset-pruefen.sh` mit der Pflichtliste schreiben, bis der Selbsttest grün ist
- [x] 1.2 `.github/workflows/ruleset.yml` (Push auf `alpha`, alle sechs Stunden, `workflow_dispatch`, nur `contents: read`) anlegen; Formfälle in `ci-stufen.test.sh` (Auslöser, Rechte, Aufruf des Skripts) rot, dann grün
- [x] 1.3 Selbsttest in `check-all.sh` einhängen (Schritt mit den Gate-Selbsttests) und `check-all.test.sh` grün
- [x] 1.4 Stau-Wächter: Fälle in `stau-waechter.test.sh` (haengt mit Pin → Ursache im Hinweis; Ruleset nicht lesbar → Hinweis wie bisher; gleiche Kennung) rot sehen, dann `stau-waechter.sh` erweitern, bis grün

## 2. Push-Jobs aus den PR-Workflows (LLH-1896, z12s72u9)

- [x] 2.1 `ziel-branch-verteilen.yml` mit dem Job `verteilen` anlegen, `push` und `verteilen` aus `ziel-branch-build.yml` entfernen, `has_pending_verteilen` auf den neuen Workflow umstellen; `ziel-branch-build.test.sh` zuerst angepasst rot, dann grün
- [x] 2.2 `migrationen-kanal.yml` mit `offene-prs` (ohne den Schritt „Sind die Status Pflicht?“) anlegen, `push` und `offene-prs` aus `migrationen.yml` entfernen; Kopfkommentare beider Dateien nachziehen; Formfall in `ci-stufen.test.sh` (kein `push` in `migrationen.yml`, `ziel-branch-build.yml`) rot, dann grün
- [x] 2.3 `suiten.yml` (workflow_call: rust, frontend, e2e, berichte mit unveränderten Gruppen, berichte mit `continue-on-error: true`) und `pr.yml` (schnell, Suiten nur mit `voll`) anlegen, `ci.yml` auf Push mit schnell, suiten, release umbauen; `ci-stufen.test.sh` auf die neue Form umschreiben (u. a. `schnell` in beiden Dateien gleich, kein PR-Auslöser in `ci.yml`, kein Push-Auslöser in `pr.yml`, `release` wartet auf `schnell` und `suiten`), zuerst rot gegen die alte Form, dann grün
- [x] 2.4 Stau-Wächter `lauf_art` mit Job-Namen `Suiten / …` als Selbsttest-Fall belegen (rot bleibt rot, Release allein zählt nicht); `ci-messung.sh` Vorgabe auf `pr.yml` und Selbsttest grün; `e2e.yml`-Kopf und `release.yml`-Kopf auf den neuen Aufrufer anpassen

## 3. Doku und Regeln

- [x] 3.1 Neue ADR (nächste freie Nummer über `origin/alpha`) mit `ersetzt: ADR-0047` und Prüfblock; ADR-0047 auf `status: ersetzt`, `ersetzt_durch`; Architektur-Wächter in `check-all.sh --nur schnell` grün
- [ ] 3.2 `scripts/AGENTS.md` („Leichte PR-Prüfung“: Workflow je Ereignis, Pflichtliste in `ruleset-pruefen.sh`, Ruleset-Lauf), Kapitel 7 (Diagramm und Text, `Stand`), README und Kommentare, die `ci.yml` als PR-Workflow nennen, nachziehen; ein grep über das Repo (ohne Archive) findet keine Stelle mehr, die `ci.yml` im PR laufen lässt

## 4. Gesamtprüfung

- [ ] 4.1 `./scripts/check-all.sh --geaendert --ohne-e2e` lokal grün; die Form der Workflows mit `actionlint`, falls verfügbar, sonst per Formtest belegt

## Workflow follow-up

- Review vor dem PR, `/opsx:archive`, dann PR gegen `alpha` mit Label `voll`, damit `pr.yml` → `suiten.yml` → `e2e.yml` einmal echt läuft.
- Nach dem Merge: ersten `ci.yml`-Lauf auf `alpha` (Release bzw. Rücktritt) und den ersten Lauf von `ruleset.yml` prüfen, dazu einen PR ohne `voll` auf übersprungene Einträge.
