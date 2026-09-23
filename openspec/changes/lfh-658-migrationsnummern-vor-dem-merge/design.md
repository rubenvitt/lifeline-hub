# Design

## Context

- `src/db.rs:migrate` bettet `./migrations` per `sqlx::migrate!` ein. `build.rs` sorgt seit
  #107 für den Neubau, sobald eine Migrationsdatei dazukommt. `migrationsnummern_sind_eindeutig`
  meldet eine doppelte Nummer mit Dateinamen, sieht aber nur den eigenen Stand.
- **sqlx 0.9, gemessen im Quelltext** (`sqlx-core-0.9.0/src/migrate/migrator.rs`,
  `run_direct`): Das Einspielen prüft nur, ob jede eingespielte Version noch in der Quelle
  steht (`validate_applied_migrations`, abschaltbar per `ignore_missing`). Danach läuft es
  **alle** Quell-Migrationen in Versionsreihenfolge durch und spielt jede nicht
  eingespielte ein. Eine Prüfung „applied out of order“ gibt es nicht. Eine kleinere Version,
  die nach einer größeren auftaucht, wird also **still** nachgespielt.
- CI: `ci.yml` läuft auf `pull_request` gegen den Merge-Ref, das ist der Ziel-Branch zum
  Zeitpunkt des Laufs. Bewegt sich der Ziel-Branch danach, läuft nichts neu. Das Ruleset
  17017911 fordert 11 Checks mit `strict_required_status_checks_policy: false`.
- Das Repo gehört einem **Benutzerkonto**. Die Merge Queue von GitHub gibt es nur für
  Repositories von Organisationen (docs.github.com, „Managing a merge queue“) und scheidet
  damit aus.
- Tests greifen per `include_str!("../migrations/00NN_…")` auf einzelne Dateien zu, heute in
  `src/db.rs` für 0025, 0082, 0089, 0111 und 0112. Außerdem nennen Doku und `CLAUDE.md`
  Migrationsdateien beim Namen.

## Goals / Non-Goals

**Goals:**
- Zwei jeweils grüne PRs können `alpha` nicht mehr unbemerkt durch Migrationsnummern rot
  machen oder die Einspielreihenfolge verdrehen.
- Das Umnummerieren nach einer Kollision ist ein einziger Befehl statt Handarbeit.
- Die Entscheidung ist begründet und an einer Stelle festgehalten (`CLAUDE.md`).

**Non-Goals:**
- Kein Wechsel des Versionsschemas, keine Änderung an eingespielten Migrationen.
- Keine fachliche Prüfung, ob zwei Migrationen inhaltlich verträglich sind. Die Regel
  erzwingt nur, dass eine neue Migration hinter allem Gemergten läuft. Ob sie dort das
  Richtige tut, zeigen die Tests des Branches nach dem Rebase.
- Kein vollständiger Schutz vor Rennen im Sekundenbereich (siehe Risiken).

## Decisions

### D1 — Fortlaufende Nummer behalten, Zeitstempel verworfen
Zeitstempel (`20260922153000_x.sql`) schließen Kollisionen praktisch aus. Die Reihenfolge
lösen sie nicht. Branch A beginnt früher, Branch B mergt zuerst. Dann spielt eine Dev- oder
alpha-DB erst B und später A ein, eine frische DB dagegen A vor B. Wie unter Context gemessen, meldet
sqlx das nicht. Das Projekt baut Tabellen häufig per CHECK-Rebuild neu (0082, 0089, 0112).
Fügt A eine Spalte an und baut B dieselbe Tabelle neu, verliert die frische DB die Spalte
still. Aus einer lauten Kollision würde ein stiller Schemaunterschied. Die Gegenmaßnahme wäre
dieselbe Regel „neue Version > alles auf dem Ziel“, geprüft gegen den aktuellen Ziel-Branch.
Damit brauchen Zeitstempel genau den Mechanismus aus D3 und kosten zusätzlich ein Mischschema
(`0116` neben `2026…`) samt Dokumentation.
*Übergang, falls später doch gewünscht:* Er ginge ohne Bruch. Versionen sind `i64`, ein
Zeitstempel sortiert hinter `0116`, und eingespielte Migrationen blieben unberührt. Die
Entscheidung ist also nicht einbahnig.

### D2 — Nummer erst beim Merge vergeben: verworfen
Merges laufen über GitHub (UI, `gh pr merge`, Auto-Merge). Es gibt keinen Haken, der
unmittelbar vor dem Merge Dateien umbenennt, ohne dass ein Bot auf den PR-Branch pusht.
Ein solcher Push löst die volle CI von rund 14 Minuten erneut aus und verschiebt das Problem
nur. Platzhalter-Dateinamen brechen außerdem `include_str!` und lokale Testläufe auf dem
Branch.

### D3 — Prüfung gegen den aktuellen Ziel-Branch als Commit-Status, neu bewertet bei jedem Push auf den Ziel-Branch
Alternativen:
- **„Branches must be up to date“** (`strict_required_status_checks_policy: true`): Das ist
  sicher, erzwingt aber nach **jedem** Merge ein Update jedes offenen PRs samt vollem
  CI-Lauf, auch ohne Migration. Bei vier und mehr parallelen Sessions wären das Stunden
  Wartezeit für ein Problem, das nur PRs mit Migration haben.
- **Merge Queue**: für Benutzerkonto-Repos nicht verfügbar.
- **Check-Run im PR-Workflow allein**: Er veraltet, sobald sich der Ziel-Branch bewegt. Genau
  das ist die Lücke von #107.

Gewählt: ein eigener Workflow `migrationen.yml` mit zwei Auslösern, beide über dasselbe
Skript:
1. `pull_request` (`opened`, `synchronize`, `reopened`, `edited` für einen Wechsel des
   Ziel-Branches): prüft den Kopf-Commit gegen den frisch geholten Ziel-Branch und setzt den
   Status `Migrationsnummern`.
2. `push` auf `alpha`/`beta`/`main`: holt `refs/pull/<n>/head` aller offenen PRs gegen
   diesen Branch, prüft jeden und setzt den Status auf dessen Kopf-Commit. `concurrency` je
   Branch mit `cancel-in-progress`, weil nur der jüngste Ziel-Stand zählt.

Warum ein **Commit-Status** statt eines Check-Runs: Einen Status kann der Push-Lauf auf einen
fremden Commit setzen, auch für PRs, die nie einen eigenen Lauf hatten. Ein Check-Run gehört
dem Lauf, der ihn erzeugt hat. Neu anstoßen ließe er sich nur per Rerun, und der Rerun eines
Laufs, den es nie gab, geht nicht. Der Job selbst heißt anders („Migrationen prüfen“), damit
Check-Run und Status nicht denselben Namen tragen.

### D4 — Die Regel steht im Skript, nicht im YAML
`scripts/check-migrationen.sh <basis> [<kopf>]` (Vorgabe `origin/alpha`, `HEAD`). Dieselbe
Arbeitsteilung wie `release-ruhefenster.sh`: Das Skript ist die Wahrheit, die CI der Ort. Nur
so ist die Regel im Selbsttest gegen echte Git-Repositories prüfbar. Drei Punkte:
`M = merge-base(kopf, basis)`, `K = kopf`, `B = basis`.
- **Unveränderlich**: `git diff --name-status M K -- migrations/` darf für Dateien, die in M
  existieren, kein `M`/`D`/`R` zeigen. Die Abzweigung ist hier der Maßstab, nicht B. Was B
  seit M neu hat, fehlt dem Branch zwar, der Branch löscht es aber nicht.
- **Anhängen**: Jede in `M..K` hinzugefügte Datei trägt eine Nummer > `max(Nummern in B)`,
  und die Nummern der neuen Dateien sind paarweise verschieden.
- Nummer = numerisches Präfix vor dem ersten `_`. Eine neue Datei ohne vierstelliges Präfix
  ist ein Verstoß.
- `--umnummerieren` (nur zusammen mit dem Kopf `HEAD`, also im Arbeitsbaum): legt die neuen
  Dateien in aufsteigender Reihenfolge per `git mv` auf `max(B)+1, …`. Anschließend ersetzt
  es in allen versionierten Dateien (`git grep -l`) den alten Dateinamen durch den neuen und
  gibt die übrigen Fundstellen der alten Nummer als Hinweis aus, etwa Testfunktionsnamen wie
  `migration_0117_…`. Es committet nicht.

### D5 — Lokal im `schnell`-Bündel
`scripts/check-all.sh` bekommt zwei Schritte im `schnell`-Bündel. Der erste ist der
Selbsttest `check-migrationen.test.sh`, immer und ohne Netz. Der zweite ist die Prüfung gegen
`origin/alpha`, sofern der Ref existiert, sonst übersprungen mit lautem Hinweis (Muster wie
`check-deps.sh`). Lokal ist `origin/alpha` so frisch wie der letzte `fetch`. Das ist eine
Frühwarnung, keine Durchsetzung. Durchgesetzt wird über D3. In der CI-Kopie (flacher
Checkout ohne `origin/alpha`) überspringt der zweite Schritt, dort trägt `migrationen.yml`.

### D6 — Charakterisierungstest für sqlx
In `src/db.rs` baut ein Test zwei `Migrator`-Instanzen aus Hand-Migrationen. Die erste kennt
nur v2, die zweite v1 und v2, beide laufen gegen dieselbe In-Memory-DB. Der Test hält fest,
dass die zweite ohne Fehler durchläuft und v1 anwendet. Auf dieser Messung ruht D1/D4. Wird
sqlx strenger, zeigt der rote Test, dass die Regel neu bewertet werden kann.

## Risks / Trade-offs

- [Rennen: PR B wird in den Sekunden zwischen dem Merge von A und dem Ende des Push-Laufs
  gemergt] → Das Fenster liegt bei etwa 30–60 s. Auto-Merge feuert in diesem Fenster nicht
  neu, weil B vorher schon grün war und nicht gewartet hat. Das Netz bleibt
  `migrationsnummern_sind_eindeutig` auf `alpha`. Ein Einschub ohne Kollision würde dort
  nicht auffallen, das Restrisiko ist aber auf dieses Fenster begrenzt.
- [PRs aus Forks: der `GITHUB_TOKEN` hat dort keine Schreibrechte, der Status wird beim
  `pull_request`-Lauf nicht gesetzt] → Der Push-Lauf setzt ihn beim nächsten Merge.
  Das Repo hat heute keine Fork-Beiträge. Bis dahin hängt ein Fork-PR auf „Expected“, das
  ist sichtbar und nicht still.
- [Neuer Required Check hängt offene PRs auf „Expected“] → Den Check erst eintragen, nachdem
  `migrationen.yml` auf `alpha` liegt und ein Push-Lauf allen offenen PRs einen Status gesetzt
  hat.
- [Der Status stammt vom `GITHUB_TOKEN`] → Der Required Check wird ohne `integration_id`
  eingetragen. Ob GitHub Statusmeldungen des Tokens der App 15368 zuordnet, ist nicht
  gemessen, und ein falscher Pin ließe jeden PR still hängen. Das Fälschungsrisiko ist bei
  einem Solo-Repo ohne Fremd-Apps gering.
- [Umbenennen einer Alt-Dublette auf `alpha`, wie am 22.09.] → Mit der Prüfung entstehen
  solche Dubletten nicht mehr. Falls doch, per Commit auf `alpha` durch einen Admin. Der
  Ruleset-Bypass liegt allein bei der Release-App, der Fall braucht also eine
  Einzelentscheidung.

## Migration Plan

1. PR mit Skript, Selbsttest, Workflow, Doku und Test nach `alpha` mergen. Der eigene
   `pull_request`-Lauf setzt dabei schon den Status auf diesem PR.
2. Der Merge löst den Push-Lauf aus. Prüfen, dass alle offenen PRs den Status
   `Migrationsnummern` tragen (`gh api repos/…/commits/<sha>/status`).
3. **Nach Freigabe durch den User**: `Migrationsnummern` in die Required Checks des Rulesets
   17017911 aufnehmen (`gh api -X PUT repos/rubenvitt/lifeline-hub/rulesets/17017911`),
   ohne `integration_id`.
4. Rückweg: den Eintrag aus dem Ruleset entfernen. Der Workflow meldet dann nur noch.
