# Suiten auf alpha laufen zu Ende statt bei jedem Merge abzubrechen — Entwurf

Zunder: https://zunder.rubeen.dev/#/aufgabe/xmwf58ws0mnu4ulowan9aeys (LLH-2035)
Stand: 22.11.2026, Weg abgestimmt mit Ruben am selben Tag (alle fünf Jobs, ADR als Teilablösung,
jetzt umsetzen).

## Warum

Auf `alpha`, `beta` und `main` bricht heute jeder neue Push die Testjobs des laufenden
Suiten-Laufs ab (ADR-0048, Regel „Auf einem Kanal-Branch bricht ein neuer Push …“). Die
Rust-Suite braucht auf `ubuntu-latest` rund 68 Minuten; bei mehreren Merges pro Stunde kommt
kein Lauf mehr durch. Gemessen am 22.11.2026: von den letzten 25 Push-Läufen von `ci.yml` auf
`alpha` (13:10–18:04) endeten 24 als `cancelled`, der einzige grüne war ein manueller Neustart in
einer Ruhephase. Ohne Ergebnis sieht der Stau-Wächter kein Rot, und ein Release entsteht nicht.

## Ziel, Nicht-Ziel, Anti-Ziel

- **Ziel:** Ein gestarteter Testjob auf einem Kanal-Branch läuft zu Ende. Je Gruppe wartet
  höchstens ein Lauf; ein neuer Push ersetzt nur den wartenden (GitHub-Verhalten bei
  `cancel-in-progress: false`). Auch in Merge-Schüben entsteht so regelmäßig ein vollständiges
  Ergebnis.
- **Nicht-Ziel:** Die Rust-Suite schneller machen (Sharding, nextest) — eigene Aufgabe, ergänzt
  diese. PR-Läufe ändern: dort ist die Gruppe je Lauf (`github.run_id`), der Abbruch übernimmt
  `pr.yml` als Ganzes; der Wert von `cancel-in-progress` ist dort wirkungslos.
- **Anti-Ziel:** Ein Release eines überholten Commits, oder Läufe, die sich unbegrenzt stauen.
  Beides bleibt ausgeschlossen: der Release tritt bei einem neueren Commit über
  `scripts/release-ruhefenster.sh` zurück (Regel „ÜBERHOLT“), und GitHub hält je Gruppe nur
  einen wartenden Lauf.

## Ansätze

1. **Alle fünf Suiten-Jobs ohne Abbruch** (`rust`, `frontend` je Anteil, `e2e`, `ios`,
   `berichte`) — **gewählt.** Ein zu Ende gelaufener Lauf ist vollständig: Stau-Wächter und
   Release sehen ihn als grün oder rot.
2. Nur `rust` ohne Abbruch. Liefert ein Rust-Ergebnis, aber die schnellen Jobs desselben Laufs
   würden weiter abgebrochen; ein Lauf wäre in Schüben nie ganz grün und released nie.
   Verworfen.
3. Concurrency auf Job-Ebene ganz entfernen. Dann liefen alle Läufe parallel, Runnerzeit
   vervielfacht sich, ältere Läufe könnten nach jüngeren enden. Verworfen.

ADR-Form: **neue ADR, die die eine Regel aus ADR-0048 ablöst** (Teilablösung, wie ADR-0049 und
ADR-0050 es mit ADR-0048 schon tun) — gewählt statt einer Vollablösung von ADR-0048, weil sich
nur diese eine Regel ändert.

## Was sich ändert

- `.github/workflows/suiten.yml`: in den fünf Jobs `cancel-in-progress: false`, Gruppen
  unverändert (je Branch und Job bei Push, je Lauf im PR). Kopfkommentar „ABBRUCH AUF
  KANAL-BRANCHES“ umschreiben, ebenso die Kommentarzeile am Job `rust`.
- `scripts/ci-stufen.test.sh`: die fünf Gruppenprüfungen erwarten `|false` statt `|true`
  („Gruppe je Branch ohne Abbruch“).
- `scripts/AGENTS.md`, „Leichte PR-Prüfung“, Absatz „Auf `alpha`, `beta`, `main`“: Testjobs
  laufen zu Ende, höchstens ein wartender Lauf je Gruppe, der jüngste Lauf deckt die
  übersprungenen Zwischenstände mit ab. Die Regel „Neu starten nur den jüngsten Lauf“ bleibt mit
  neuer Begründung: ein neu gestarteter Job eines älteren Laufs tritt als wartender in die Gruppe
  und verdrängt den wartenden Job des jüngeren Laufs.
- `.github/workflows/release.yml`, Kopfkommentar: „ein Lauf, dessen Tests ein neuerer Push
  abgebrochen hat“ — bleibt sachlich richtig (ein verdrängter wartender Lauf zählt als
  abgebrochen); nur prüfen, nicht ändern, wenn er stimmt.
- **Neue ADR** `ADR-0086-testjobs-auf-kanal-branches-laufen-zu-ende.md` (Nummer vor dem PR gegen
  `origin/alpha` und offene PRs prüfen): Regeln — aus ADR-0048 entfällt der Abbruch; die
  Testjobs in `suiten.yml` laufen auf Kanal-Branches zu Ende, Concurrency je Branch und Job mit
  `cancel-in-progress: false`; der Release bleibt unverändert (eigene Gruppe, `needs`). Prüfung
  per `awk` über `suiten.yml`: kein `cancel-in-progress: true`, fünfmal `false`. `gilt_fuer`:
  `.github/workflows/suiten.yml`, `scripts/ci-stufen.test.sh`, `scripts/AGENTS.md`.
- Stau-Wächter (`scripts/stau-waechter.sh`): keine Änderung. Er wertet schon den jüngsten
  abgeschlossenen Lauf aus und überspringt abgebrochene; mit der Änderung findet er öfter einen.

## Folgen

- Das Ergebnis für den neuesten Commit kommt später: im schlimmsten Fall nach dem Ende des
  laufenden plus einem eigenen Durchlauf (rund zweimal 68 Minuten).
- Mehr Runnerzeit als heute, weil laufende Jobs nicht mehr abgebrochen werden; begrenzt auf einen
  laufenden und einen wartenden Lauf je Job.
- Der PR braucht das Label `voll` (ADR-0050, Kriterium 1: Änderung an `suiten.yml`).

## Dem Bauenden überlassen

Wortlaut der Kommentare und der ADR-Abschnitte Kontext/Konsequenzen; genaue Form der
ADR-Prüfung, solange sie unter einer Sekunde läuft und eine Gegenprobe (`true` statt `false`)
rot würde.
