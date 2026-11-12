# Proposal

## Why

Vom 08. bis 12.11.2026 lief CodeRabbit in der Testphase auf jedem PR. 49 Commits nennen es als
Auslöser, darunter echte Fehler: ein ELW konnte einem anderen die Führung nehmen (#1243), ein
Gerät sah Namen fremder Bezugspersonen (LLH-1612), ein abgeschnittener Grundstock ging still
verloren (LLH-1490). Die Testphase ist abgelaufen, und das freie Kontingent reicht bei rund zehn
PRs am Tag für fast keinen davon.

Der eigene Review-Schritt hat diese Fehler nicht gefunden, aus zwei Gründen:

- Er hängt an `superpowers:requesting-code-review`. Superpowers ist nicht mehr in Benutzung und in
  Cloud-Sitzungen gar nicht geladen; der Schritt fällt dort still aus.
- Die Review-Vorlage des Orchestrators fragt allgemein nach „Logikfehler, Org-Isolation,
  Konventionen, Tests“. Die drei größten Befundklassen der Testphase (stiller Verlust,
  Lade-/Fehler-/Offline-Zustand, Grenzen für Eingaben von außen) kommen darin nicht vor.

## What Changes

- **Prüfliste aus den Befunden:** die zehn Klassen der Testphase als eine Datei mit Prüffrage
  und Beispielen aus dem Repo, unter `.claude/skills/dev-zunder-ausfuehren/references/`.
- **Review als fester Schritt vor dem PR:** In Schritt 4 von `dev-zunder-ausfuehren` startet der
  Agent selbst einen Reviewer mit frischem Kontext, ohne Anstoß durch den Menschen. Der Reviewer
  bekommt den Diff gegen `origin/alpha`, die geltenden Regeln und die Prüfliste, nicht das
  Gespräch.
- **Gegenprüfung:** Jeder Befund wird von einem zweiten Agenten geprüft, der ihn zu widerlegen
  versucht. Bestätigte Befunde werden vor dem PR behoben.
- **Nachweis im PR:** Die PR-Vorlage bekommt den Abschnitt „Review“ mit den Befunden und ihrem
  Verbleib.
- **Ein Review je PR, eine Prüfliste:** Phase 4 von `dev-zunder-orchestrieren` und das Skelett
  „Review-find-verify“ lesen dieselbe Prüfliste; die vier allgemeinen Dimensionen entfallen.
- **`superpowers:requesting-code-review` entfällt** in `AGENTS.md` und beiden Skills. Der Schritt
  nutzt nur das Agent- und das Workflow-Tool und läuft lokal wie in der Cloud.

Nicht Teil dieser Change (am 12.11.2026 mit Ruben so abgestimmt, Variante A):

- Kein Wächter in der CI, der den Abschnitt „Review“ erzwingt. Er kommt nach, falls der
  Abschnitt in der Praxis fehlt.
- Keine GitHub-Action, die auf jedem PR reviewt.
- Die übrigen Superpowers-Verweise (`test-driven-development`, `systematic-debugging`,
  `using-git-worktrees`, `verification-before-completion`, `finishing-a-development-branch`)
  bleiben vorerst stehen; ihre Ablösung ist eine eigene Entscheidung.

## Capabilities

### New Capabilities

- `review-vor-dem-pr`: Der Review, den der Agent vor jedem PR selbst startet: wann er läuft, was
  der Reviewer bekommt, wogegen er prüft, wie Befunde gegengeprüft werden und wo ihr Verbleib
  steht.

### Modified Capabilities

Keine. `entwurfs-hoheit` erlaubt das Review als Subagent oder Workflow parallel zu den Gates
(Szenario „Review parallel zu den Gates“) und bleibt unverändert.

## Impact

- `.claude/skills/dev-zunder-ausfuehren/SKILL.md` (Schritt 4, neuer Abschnitt „Review vor dem PR“,
  Tabelle „Agenten nach Bedarf“)
- `.claude/skills/dev-zunder-ausfuehren/references/review-pruefliste.md` (neu)
- `.claude/skills/dev-zunder-orchestrieren/SKILL.md` (Phase 4) und
  `references/workflow-bausteine.md` (Skelett „Review-find-verify“)
- `AGENTS.md`, Abschnitt „Planung und Ausführung“ (zwei Stellen nennen `requesting-code-review`)
- `.github/pull_request_template.md` (Abschnitt „Review“)
- Kein Projektcode, keine Gates, keine Migration.
- Außerhalb des Repos: Die CodeRabbit-App am Repository kann Ruben abschalten; im Repo liegt
  keine `.coderabbit.yaml`. Die Verweise auf CodeRabbit in Tests und Kommentaren bleiben als
  Herkunftsangabe stehen.
- Keine Zunder-Aufgabe: Die Change trägt deshalb keinen `<kurz>`-Vorsatz und die Commits keine
  `Zunder:`-Zeile.
