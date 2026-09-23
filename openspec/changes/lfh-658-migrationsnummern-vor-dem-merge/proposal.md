# Proposal

## Why

Jeder Branch nimmt beim Anlegen die nächste freie Migrationsnummer. Bei vielen parallelen
Sessions greifen mehrere Branches zur selben Nummer. Git mergt das ohne Konflikt, weil die
Dateinamen verschieden sind. Rot wird erst `alpha` selbst, und zwar in jedem Test, der eine
Datenbank anlegt (22.09.2026: dreimal `0106` nach #97/#98/#99, LFH-617 zog zweimal um). Der
Guard aus #107 (`migrationsnummern_sind_eindeutig`) sieht nur den eigenen Stand. Zwei PRs, die
jeder für sich grün sind, machen `alpha` gemeinsam rot, und niemand merkt es vor dem Merge.

## What Changes

- **Entscheidung: die fortlaufende Nummer bleibt.** Kein Wechsel auf Zeitstempel und keine
  Nummernvergabe erst beim Merge. Die Begründung steht in `design.md` und wird in `CLAUDE.md`
  festgehalten. Kern: sqlx 0.9 spielt eine fehlende kleinere Version **still** nach.
  Zeitstempel machen aus einer lauten Kollision einen stillen Einschub, und bei den vielen
  Tabellen-Rebuilds dieses Projekts ist die Reihenfolge nicht egal.
- **Neue Regel „anhängen, nicht einschieben“**: Eine Migration, die ein Branch neu mitbringt,
  trägt eine Nummer **größer als jede Nummer auf dem aktuellen Ziel-Branch**. Eine Migration,
  die es an der Abzweigung schon gab, wird weder geändert noch umbenannt oder gelöscht.
- **Prüfskript** `scripts/check-migrationen.sh`: Es prüft die Regel gegen eine wählbare
  Basis (Vorgabe `origin/alpha`). Bei einem Verstoß nennt es die Datei und die nächste freie
  Nummer. Mit `--umnummerieren` legt es die eigenen neuen Migrationen auf die nächsten freien
  Nummern und zieht die Verweise darauf nach (`include_str!`, Doku).
- **Selbsttest** `scripts/check-migrationen.test.sh` gegen echte Git-Repositories im
  Temp-Verzeichnis, eingehängt ins `schnell`-Bündel von `scripts/check-all.sh`.
- **Neuer Workflow** `.github/workflows/migrationen.yml`: Er setzt auf dem Kopf-Commit jedes
  PRs den Commit-Status **`Migrationsnummern`**, einmal beim Öffnen und Aktualisieren des PRs
  und außerdem **bei jedem Push auf `alpha`/`beta`/`main` für alle offenen PRs gegen diesen
  Branch**. Mergt PR A, wird PR B also neu bewertet, ohne dass B sich bewegt.
- **Ruleset**: `Migrationsnummern` wird Required Check im Ruleset 17017911. Das ist eine
  Repo-Einstellung außerhalb des Codes und wird erst nach ausdrücklicher Freigabe gesetzt.
- **Charakterisierungstest** in `src/db.rs`: Er hält fest, dass sqlx 0.9 eine kleinere,
  noch nicht eingespielte Version nach einer größeren ohne Fehler einspielt. Die Regel oben
  stützt sich auf diese Messung. Ändert sqlx das Verhalten, wird der Test rot.

## Capabilities

### New Capabilities
- `migrationsvergabe`: Regeln für Nummer und Unveränderlichkeit von sqlx-Migrationen und
  deren Prüfung gegen den aktuellen Ziel-Branch vor dem Merge.

### Modified Capabilities
<!-- keine -->

## Impact

- Neu: `scripts/check-migrationen.sh`, `scripts/check-migrationen.test.sh`,
  `.github/workflows/migrationen.yml`.
- Geändert: `scripts/check-all.sh` (Selbsttest und lokale Prüfung im `schnell`-Bündel),
  `src/db.rs` (Charakterisierungstest), `CLAUDE.md` (neuer Abschnitt zur Migrationsvergabe).
- GitHub-Einstellung: ein zusätzlicher Required Check im Ruleset 17017911, nach Freigabe.
- **Bestands-DBs**: keine Auswirkung. Schema und Versionen der Migrationen `0001`–`0116`
  bleiben unverändert, es gibt keinen Übergang.
- **Tests mit `include_str!`**: Sie hängen weiter am Dateinamen. Neu ist nur, dass
  `--umnummerieren` die Verweise beim Umzug mitzieht.
- **Release-Kanal**: keine Auswirkung auf semantic-release. Der Versions-Commit fasst keine
  Migration an. Ein PR `alpha → main` durchläuft dieselbe Prüfung wie jeder andere.
