# Design

## Context

Motivation: proposal.md, „Why“. Der Check bestand aus `ziel-branch-build.yml` (PR-Ereignis,
Einzellauf per `workflow_dispatch`), `ziel-branch-verteilen.yml` (nach jedem Push auf einen
Kanal-Branch) und `scripts/ziel-branch-build.sh` (Auswahl, Verteilen, Melden). Ruben hat ihn am
15.11.2026 um 08:36 im Ruleset ausgetragen; der nächste PR (#1389) mergte sofort.

## Goals / Non-Goals

**Goals:**
- Kein Workflow erzeugt den Check mehr, und nach einem Merge auf `alpha` startet keine Kette.
- `ruleset.yml` ist mit dem ausgetragenen Ruleset wieder grün.

**Non-Goals:**
- Die Ursache des Hängens (vermutet: offener Check von `verteilen` in einer anderen Check-Suite)
  wird nicht mehr aufgeklärt; der Mechanismus entfällt.
- Kein Ersatz-Check. Kompilierbrüche zweier einzeln grüner PRs fängt „alpha rot“.

## Decisions

### D1: Ganz entfernen statt als Info-Check behalten
Ein Check ohne Pflicht sperrt nichts, kostet aber je Merge und fertigem PR rund 9 Minuten Runner
und konkurriert mit den Läufen auf `alpha`. Verworfen: den PR-Ereignis-Lauf als freiwillige Info
behalten (dann zeigte jeder fertige PR wieder Jobs, und ein roter Info-Check verwirrt).

### D2: `check-all.sh --nur baut` bleibt
Schritt 17 ist ein reines `cargo check` plus Typprüfung und taugt lokal als schneller Test, ob
ein Stand kompiliert. Nur sein Bezug auf den Check entfällt. Verworfen: Schritt und Bündel
entfernen (Umnummerieren aller Schrittangaben, kein Gewinn).

### D3: Neue ADR ersetzt ADR-0030
ADR-0030 trägt zwei Entscheidungen: den Check und „bei rotem alpha ist genau ein PR zuständig“.
Die neue ADR übernimmt die zweite unverändert und hält die Abkehr von der ersten fest.

## Risks / Trade-offs

- [`alpha` wird auch aus Kompilierbrüchen rot] → Der Stau-Wächter bestimmt einen Zuständigen;
  der Bruch ist auf dem nächsten Lauf sichtbar. So war es vor dem 12.11.2026.
- [Offene PRs tragen noch alte Checks `Baut mit Ziel-Branch` auf „läuft“] → Sie sind keine
  Pflicht mehr und sperren nichts; mit dem nächsten Push verschwinden sie aus der Ansicht.
- [Alte PR-Branches enthalten `ziel-branch-build.yml` noch] → `pull_request` liest den Workflow
  aus dem Merge mit `alpha`, dort fehlt er; ein Einzellauf wird nicht mehr angestoßen.

## Migration Plan

Ruleset schon angepasst. Merge dieses PRs; danach `ruleset.yml` einmal von Hand starten.
