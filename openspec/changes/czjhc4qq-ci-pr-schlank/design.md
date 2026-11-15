# Design

## Context

Motivation: proposal.md, „Why“. Stand vor der Change:

- `ci.yml` hört auf `pull_request` und `push`. Im PR ohne `voll` legt es fünf übersprungene Jobs
  an (Rust-, Frontend-, e2e-Suite, Testberichte, Release), weil jeder Job mit falschem `if` als
  übersprungener Eintrag erscheint. `ziel-branch-build.yml` (`Verteilen`) und `migrationen.yml`
  (`Offene PRs neu bewerten`) bringen je einen weiteren mit. Dazu kommen an einem PR, der noch
  nicht fertig ist, `Kompilieren` und `Melden` aus `ziel-branch-build.yml` (sie rechnen erst mit
  Auto-Merge); die gehören zum Pflicht-Check und bleiben (s. Non-Goals). Zusammen neun.
- Pflicht im Ruleset 17017911 sind `Schnellprüfungen` (Job in `ci.yml`), `Migrationsnummern` und
  `ADR-Nummern` (Commit-Status aus `migrationen.yml`) und `Baut mit Ziel-Branch` (Check-Run über
  die Checks-API). Ein Commit-Status zählt nicht, wenn das Ruleset ihn an eine App bindet.
- Der Push-Lauf von `migrationen.yml` prüft nur, ob die beiden Status in der Liste stehen, und
  meldet das in der Step-Summary.
- Ein Check-Run-Name eines Jobs in einem wiederverwendbaren Workflow lautet
  `<Aufrufer-Job> / <Job>`. Ein Pflicht-Check-Job darf deshalb nicht in einem aufgerufenen
  Workflow liegen, sonst ändert sich sein Name.

## Goals / Non-Goals

**Goals:**
- Am PR ohne `voll` keine Jobs der Kanal-Branches mehr und aus `pr.yml` genau ein übersprungener
  Eintrag; an einem nicht fertigen PR also drei statt neun (dazu `Kompilieren` und `Melden`).
- Release, Abbruch je Job auf `alpha` und `voll` verhalten sich wie vorher.
- Ruleset-Abweichung wird binnen Minuten nach einem Push auf `alpha` (sonst binnen sechs Stunden)
  rot, ohne dass Ruben sie suchen muss.

**Non-Goals:**
- Kein gemeinsamer Lauf aller PRs (LLH-1890).
- Keine Änderung der Pflicht-Checks selbst und kein Eingriff ins Ruleset.
- Rulesets von `beta` und `main` bleiben ungeprüft (dort wird nicht per PR gearbeitet).
- `Kompilieren` und `Melden` bleiben getrennte Jobs, die an einem nicht fertigen PR übersprungen
  erscheinen: `kompilieren` führt PR-Code nur lesend aus, `melden` schreibt den Check
  (ADR-0030). Sie zusammenzulegen oder leer laufen zu lassen, kostete die Trennung bzw. Runner.

## Decisions

### D1: Ein Workflow je Ereignis statt `if` am Job

`ci.yml` bekommt nur noch `push` (Kanal-Branches), ein neues `pr.yml` („PR-Prüfung“) nur
`pull_request`. Jobs, die nur bei Push laufen, stehen damit in einem Workflow, den ein PR gar nicht
startet, und erscheinen nicht. Verworfen: ein Workflow mit Bedingungen, denn jede falsche
Bedingung erzeugt einen Eintrag; eine Bedingung auf Workflow-Ebene gibt es nicht, und Auslöser
lassen sich nicht nach Labels filtern.

### D2: Die Suiten in `suiten.yml`, die Schnellprüfungen doppelt mit Formtest

Rust-, Frontend-, e2e-Suite und Testberichte ziehen in den wiederverwendbaren `suiten.yml`.
`ci.yml` ruft ihn immer, `pr.yml` nur mit `voll` (Job „Suiten (voll)“, am PR ohne `voll` der eine
übersprungene Eintrag). Die Concurrency-Gruppen der Jobs bleiben wörtlich: Im aufgerufenen
Workflow ist `github.event_name` der des Aufrufers.

Der Job `schnell` steht wörtlich gleich in `ci.yml` und `pr.yml`, weil er im PR als
`Schnellprüfungen` ohne Präfix erscheinen muss. `ci-stufen.test.sh` vergleicht beide Blöcke und wird
bei der kleinsten Abweichung rot. Verworfen: eine Composite Action für die Schritte. Sie spart die
Doppelung, aber `failure()` mit `steps.<id>.outcome` innerhalb einer Composite Action ist hier nicht
belegt, und die Karenzzeit-Erklärung (LLH-1884) hängt daran.

`release` wartet auf `[schnell, suiten]`. Damit wartet er neu auch auf `Testberichte
zusammenführen`; der Job bekommt `continue-on-error: true`, damit ein gescheiterter Bericht keinen
Release verhindert (vorher stand er bewusst nicht in `needs`).

### D3: Push-Jobs in eigene Workflows

- `ziel-branch-verteilen.yml` („Baut mit Ziel-Branch (Verteilen)“) trägt den Job `verteilen`,
  unverändert, Gruppe je Branch ohne Abbruch. Er startet weiter `ziel-branch-build.yml` per
  `workflow_dispatch`. `has_pending_verteilen` in `ziel-branch-build.sh` sucht ausstehende Läufe
  im neuen Workflow. `ziel-branch-build.yml` verliert den Auslöser `push`.
- `migrationen-kanal.yml` („Migrationsnummern (Kanal)“) trägt `offene-prs` samt Autofix,
  ohne den Schritt „Sind die Status Pflicht?“ (geht in D4 auf). `migrationen.yml` verliert `push`.

Der Check `Baut mit Ziel-Branch` entsteht weiter über die Checks-API mit demselben Token, sein Name
hängt nicht am Workflow.

### D4: `scripts/ruleset-pruefen.sh` mit der Liste und `ruleset.yml`

Das Skript trägt die Pflichtliste (Name und Art: `status` oder `check`) als einzige Stelle und
liest die Antwort von `GET repos/{repo}/rules/branches/alpha` von stdin. Es sammelt alle Regeln
vom Typ `required_status_checks` (mehrere Rulesets möglich), meldet fehlende, zusätzliche, eine
Quelle an einem Status, eine fremde Quelle (nicht GitHub Actions, App-ID 15368) an einem Check und
`strict_required_status_checks_policy`. Exit 0 in Ordnung, 1 Abweichung, 2 nicht lesbar. stdin
statt eigenem API-Aufruf, damit der Stau-Wächter seine Attrappe weiterreichen kann und der
Selbsttest ohne Netz läuft.

`ruleset.yml` („Ruleset“, Job „Pflicht-Checks im Ruleset“) läuft bei Push auf `alpha`, alle sechs
Stunden und per `workflow_dispatch`, nur mit `contents: read`. Rot bei Abweichung: GitHub schickt
die Mail über den gescheiterten Lauf. Verworfen: der Schritt in `migrationen.yml` (der Lauf hat
einen anderen Zweck, und ein rotes „Migrationsnummern“ führte auf die falsche Spur).

### D5: Stau-Wächter

Beim Befund `haengt` an einem PR auf `alpha` holt er die Regeln von `alpha` einmal je Lauf über
`gh_api` und reicht sie an `ruleset-pruefen.sh` (die Pflichtliste gilt nur dort). Bei Abweichung
bekommt der Hinweis einen Absatz „Wahrscheinliche Ursache“ mit den Zeilen des Skripts. Die
gefundene Abweichung geht in die Kennung des Hinweises ein: taucht sie auf oder ist sie behoben,
wird der Hinweis neu geschrieben (Review: sonst bekäme ein schon stehender Hinweis die Ursache nie
und behielte eine veraltete). Ohne Abweichung oder ohne lesbares Ruleset bleibt die Kennung die
des Befunds, ein Aussetzer der API schreibt einen Hinweis ohne Ursache nicht neu. Verworfen: den
Text per PATCH nachziehen; der Hinweis nennt die Minuten seit dem Grün, sein Text ändert sich also
in jedem Lauf.

### D6: Neue ADR statt ADR-0047

ADR-0047 nennt die Suiten-Jobs „in `ci.yml`“ und `e2e.yml` „aus `ci.yml` aufgerufen“; ihre
Prüfung verlangt den Aufruf in `ci.yml`. Eine akzeptierte ADR ändert sich nicht, also ersetzt eine
neue ADR sie mit denselben Regeln, angepasst an `pr.yml`/`suiten.yml`, und zwei neuen: ein Workflow
je Ereignis, Pflichtliste in `ruleset-pruefen.sh`.

## Risks / Trade-offs

- [Release-Pfad auf `alpha` erst nach dem Merge belegbar] → Formtest deckt `needs` und Gruppen ab;
  der PR hat das Label `voll`, damit `pr.yml` → `suiten.yml` → `e2e.yml` einmal echt läuft. Nach
  dem Merge den ersten Lauf auf `alpha` prüfen (Release oder Rücktritt per Ruhefenster).
- [Neue Job-Namen auf `alpha` (`Suiten / …`)] → `lauf_art` im Stau-Wächter filtert nur `Release`
  heraus und zählt alle übrigen; Selbsttest-Fall mit dem neuen Namen. `ci-messung.sh` misst
  PR-Läufe künftig in `pr.yml`.
- [`schnell` doppelt] → Formtest vergleicht beide Blöcke; Dependabot zieht die Pins in beiden.
- [Ruleset-API liefert die Quelle nicht] → Die API liefert `integration_id` je Check; fehlt das
  Feld, gilt „ohne Quelle“. Der erste Lauf nach dem Merge zeigt die echte Antwort.
- [Mail-Flut bei dauerhaftem Fehler alle sechs Stunden] → Gewollt: der Fehler blockiert alle PRs.
- [Laufende PR-Branches kennen `pr.yml` nicht] → Ein PR, der vor dem Merge abzweigt, fährt noch das
  alte `ci.yml` aus seinem Merge-Ref; `pull_request` liest den Workflow aus dem Merge mit dem
  Ziel-Branch, also gilt ab dem Merge für jeden PR-Lauf der neue Stand.

- [Übergang: Einzelläufe auf alten PR-Branches] → Ein Einzellauf von `Baut mit Ziel-Branch` läuft
  mit Workflow und Skript seines PR-Branches. Ein Branch, der vor dem Merge abzweigte, fragt in
  `has_pending_verteilen` noch die Push-Läufe von `ziel-branch-build.yml`, die es nicht mehr gibt.
  Folge: Ein überholter Check wird dort nach 5 Minuten rot („neu starten“), auch wenn ein
  Verteilen-Lauf noch aussteht; der nächste Check löst ihn ab. Hingenommen, bis die offenen PRs
  `alpha` hineingemergt haben (Review vor dem PR).

## Migration Plan

Ein Merge, kein Ruleset-Handgriff. Rücknahme: Merge-Commit zurücknehmen.
