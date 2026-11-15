# Design

## Context

Den Anlass beschreibt proposal.md. Heute (Herleitung `openspec/changes/archive/2026-11-12-k133wmg6-zweistufige-ci/design.md`, ADR-0026):

- **`ci.yml`:** prüft jeden PR-Push mit Schnellprüfungen sowie, nach Bereichen (`scripts/ci-auswahl.sh eins`), mit Rust- und Frontend-Suite.
- **Pflicht-Shards:** Die Shards sind Pflicht im Ruleset 17017911. Deshalb tragen die schweren Jobs ihre Bedingung an jedem Schritt und melden „leer grün“.
- **`e2e.yml`:** ist die zweite Stufe an fertigen PRs (Auto-Merge an oder Label `e2e`) und die e2e-Suite der Kanal-Branches (per `workflow_call` aus `ci.yml`).
- **Kein Abbruch auf Kanal-Branches:** `ci.yml` bricht dort nicht ab. Der Release-Job hängt am selben Lauf, und ein Abbruch zwischen Versions-Commit und GitHub-Release hinterließe ein Tag ohne Release (Kopf von `ci.yml`, `concurrency`).
- **Kein `workflow_run` für den Release:** semantic-release liest den Branch aus `GITHUB_REF` (Kopf von `release.yml`).

## Goals / Non-Goals

**Goals:**
- Ein PR ohne Label kostet Schnellprüfungen, `Migrationsnummern`, `ADR-Nummern` und `Baut mit Ziel-Branch`, sonst nichts.
- Auf Kanal-Branches bricht ein neuer Push die Tests des laufenden Laufs ab, ein laufender Release bricht nie ab.
- Weniger bewegliche Teile: keine Auswahl nach Bereichen mehr in der CI, keine zweite Stufe.

**Non-Goals:**
- Kein gemeinsamer Lauf aller PRs. Das bleibt LLH-1890.
- Keine Änderung an `Baut mit Ziel-Branch` außer der Definition von „fertig“. Warteschlange und Übernahme bleiben, wie die Change `p4avye3q-ziel-branch-build-ersetzen-buendeln` sie gebaut hat.
- `Verteilen` bleibt in `ziel-branch-build.yml`. Ein eigener Workflow dafür würde nur Rauschen sparen und kann später kommen.

## Decisions

**D1 Die schweren Jobs bleiben in `ci.yml` und bekommen ein Job-`if`: Push oder Label `voll`.** Seit sie keine Pflicht mehr sind, ist ein übersprungener Job an einem PR ohne `voll` unschädlich (an einem mit `voll` siehe D2). Im PR stehen dann `Schnellprüfungen` und wenige übersprungene Einträge, keine Läufe.
- *Alternative: eigener Workflow `voll.yml` mit wiederverwendbaren Suiten.* Bringt einen Verschiebe-Umbau mit sich und neue Check-Namen. Verworfen, der Gewinn wäre nur weniger übersprungene Einträge.

**D2 `ci.yml` hört im PR auch auf `labeled`.** Bei jedem Label-Ereignis laufen die Schnellprüfungen neu. An einem PR ohne `voll` läuft ein fremdes Label in einer eigenen Gruppe (je Lauf), bricht keinen laufenden Lauf ab und startet keine Suite. Das betrifft vor allem Dependabot, das mehrere Labels nacheinander setzt. An einem PR mit `voll` startet jedes Ereignis die Suiten neu, in der Ref-Gruppe. Ein übersprungener gleichnamiger Check wäre sonst der jüngste und verdeckte eine rote Suite (Review, zweiter Durchgang). Ein erster Fix, der Suiten bei fremden Labels übersprang, hatte genau diesen Fehler. Die Schnellprüfungen dürfen bei einem fremden Label nicht übersprungen werden: Ein übersprungener jüngster Check zählt als grün, auch über einem roten (Kopf von `e2e.yml`, heute). Ein fremdes Label kostet deshalb einen Schnelllauf von etwa 2 Minuten, und das ist hinnehmbar.

**D3 Abbruch auf Kanal-Branches über Concurrency auf Job-Ebene.**
- *Workflow-Ebene:* PR-Läufe teilen sich wie bisher eine Gruppe je Ref mit Abbruch. Ein Push-Lauf bekommt eine eigene Gruppe je Lauf, also keinen Abbruch auf Workflow-Ebene.
- *Testjobs:* `rust`, `frontend` (Gruppe je Shard), `e2e` (der Aufruf von `e2e.yml`) und `berichte` tragen auf einem Kanal-Branch eine Gruppe je Branch und Job mit `cancel-in-progress: true`. Der neue Lauf bricht so die Tests des alten ab.
- *Release:* Der Job `release` hat eine eigene Gruppe je Branch ohne Abbruch. Ein laufender Release läuft zu Ende. Seine `needs` lassen ihn entfallen, wenn ein Testjob abgebrochen oder rot ist (Standard-`if`).
- *Ein Release zur Zeit:* Ein wartender Release wird höchstens durch einen jüngeren ersetzt.
- *Alternative: Release per `workflow_run` nach grünem CI-Lauf.* Scheidet aus, weil semantic-release den Branch aus `GITHUB_REF` liest.

**D4 `e2e.yml` wird reiner `workflow_call`.**
- Auslöser, Gruppenlogik und Matrix-Trick der zweiten Stufe entfallen. Binary, Shards, Bericht und Runner-Wahl (ADR-0025) bleiben dort.
- `ci.yml` ruft ihn bei Push oder `voll`. Der Aufruf-Job heißt `e2e`, die Checks heißen `e2e / e2e 1/4` usw.
- Die Fork-Sperre der Runner-Wahl bleibt.

**D5 Ohne Auswahl nach Bereichen in der CI.**
- Mit `voll` laufen alle Suiten ganz, auf Kanal-Branches ohnehin. `scripts/ci-auswahl.sh` und `scripts/nur-umnummeriert.sh` haben keinen Aufrufer mehr und werden samt Selbsttests entfernt.
- Der Job `aenderungen` entfällt.
- Lokal bleibt `scripts/bereiche.sh` die Zuordnung für `check-all.sh --geaendert`.

**D6 „Fertig“ heißt Auto-Merge an.** In `ziel-branch-build.sh` (`pr_zeilen`) fällt das Label `e2e` weg, `voll` zählt nicht. Der Auslöser `labeled` an `ziel-branch-build.yml` entfällt.

**D7 Stau-Wächter.**
- Der Befund `ohne-e2e` entfällt samt `E2E_CHECKS`, `E2E_AUSWAHL` und `automerge_seit`. Ein noch stehender Hinweis dieser Art wird beim nächsten Lauf über die übliche Regel „kein Befund mehr → behoben“ geschlossen.
- Bei „alpha rot“ ist ein Lauf mit `conclusion = cancelled` schon heute „unklar“ und wird übersprungen. Der Selbsttest hält das ausdrücklich fest.

**D8 Lokal vor dem PR.**
- `check-all.sh` bekommt `--ohne-e2e`. Es nimmt den e2e-Schritt aus jeder Auswahl, auch aus `--geaendert`. `--auswahl` und die Schlusszeile sagen ausdrücklich „ohne e2e, kein voller Lauf“.
- Der Skill `dev-zunder-ausfuehren` verlangt vor dem PR `./scripts/check-all.sh --geaendert --ohne-e2e`. Das Label `voll` nennt er für riskante Änderungen. Die PR-Vorlage zieht nach.

**D9 Architektur.**
- Eine neue ADR (nächste freie Nummer über `origin/alpha`) ersetzt ADR-0026: „Ein PR prüft leicht, die Suiten laufen auf den Kanal-Branches“. ADR-0026 bekommt `status: ersetzt` und `ersetzt_durch`.
- ADR-0025 bekommt nur Pfadnachzüge.
- Kapitel 7 (Verteilungssicht) zieht nach.

## Risks / Trade-offs

- **[Brüche, die erst ein Test zeigt, landen auf `alpha`.]**
  - Lokal fährt der Agent die betroffenen Suiten ohne e2e.
  - `Baut mit Ziel-Branch` hält Kompilierfehler fern.
  - Den Rest fängt der alpha-rot-Ablauf (Stau-Wächter, Label `alpha-rot`).
  - e2e-Brüche zeigen sich erst auf `alpha`.
- **[Concurrency auf Job-Ebene bei einem `uses:`-Job (Aufruf von `e2e.yml`) bricht anders ab als erwartet.]**
  - Lokal nicht prüfbar.
  - Nach dem Merge an zwei Merges kurz hintereinander auf `alpha` beobachten: Die Tests des älteren Laufs enden abgebrochen, sein Release entfällt, der jüngere läuft durch.
  - Ein Fehlschlag fällt höchstens auf, indem ein alter Lauf noch zu Ende testet. Kosten entstehen dann nur als Runner-Zeit.
- **[Das Ruleset passt nicht zum Workflow.]**
  - Ändert Ruben das Ruleset zu früh, mergen PRs nach dem alten Workflow ohne Suiten. Das wäre harmlos, weil die Suiten auf `alpha` nachlaufen.
  - Ändert er es zu spät, hängen nach dem Merge alle PRs auf „Expected“ für die Suiten. Deshalb steht der Handgriff im PR als Merge-Bedingung.
- **[Abgebrochene Läufe auf `alpha` zeigen in der Commit-Liste ein rotes Kreuz.]** Gewollt. Grün auf `alpha` heißt: Der jüngste vollständige Lauf ist grün.
- **[Ein Neustart eines älteren Laufs bricht die Tests des jüngeren ab]** (Review). Ein neu gestarteter Job tritt in dieselbe Gruppe. Regel in `scripts/AGENTS.md`, im Skill und im Auftrag „alpha rot“: neu starten nur den jüngsten Lauf.
- **[Ein PR mit `voll` und roter Suite ist mergebar.]** Gewollt (keine Pflicht). Die Suite steht sichtbar am PR.

## Migration Plan

1. #1380 umsetzen, Review, archivieren.
2. Ruben legt das Label `voll` an (es gibt es noch nicht) und löscht das Label `e2e`. Danach trägt er im Ruleset 17017911 aus: `Rust-Suite`, `Frontend-Suite 1/4`–`4/4`, `e2e-Binary`, `e2e 1/4`–`4/4`. Pflicht bleiben `Schnellprüfungen`, `Migrationsnummern`, `Baut mit Ziel-Branch` und `ADR-Nummern` (unverändert).
3. Unmittelbar danach #1380 mergen. PR-Läufe lesen den Workflow aus dem Merge-Ref und gehen beim nächsten Ereignis auf den neuen Ablauf über. Ein Einzellauf von `Baut mit Ziel-Branch` liest ihn bis zum Hineinmergen von `alpha` vom PR-Branch.
4. Beobachten: zwei Merges kurz hintereinander auf `alpha` (siehe Risiken).
5. Zurückrollen: den Merge-Commit zurücknehmen und das Ruleset wiederherstellen (Liste oben).
