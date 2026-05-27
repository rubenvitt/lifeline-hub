---
name: dev-clickup-task
description: Use when starting to implement, pick up, or work on a specific task from the Lifeline-Hub ClickUp Entwicklungsboard — e.g. "implementiere ClickUp #123", "mach mal Task X", or before coding work that corresponds to a known ClickUp task. NOT for capturing new tasks (use clickup-task-anlegen).
---

# ClickUp-Task implementieren (Lifeline Hub)

## Überblick

Einen Task vom **Entwicklungsboard** (`901523554968`) umsetzen. Dieser Skill macht wenige
**eigene Entscheidungen** — Workspace (Branch/Worktree), Komplexitäts-Routing und das
**Mitführen des Board-Status** — und delegiert alles andere an die passenden
superpowers-Skills. Nichts davon reimplementieren.

## Wann benutzen

- User nennt einen konkreten Task ("implementiere ClickUp #123", "mach Task LH-42", URL/Name)
- Bevor Code-Arbeit für einen bekannten Board-Task beginnt

**Nicht** zum Anlegen neuer Tasks → `clickup-task-anlegen`.

## Board-Status mitführen

Der Task soll auf dem Board zeigen, wo die Arbeit gerade steht. Status **automatisch**
(keine Rückfrage) mit `mcp__claude_ai_ClickUp__clickup_update_task` setzen — `task_id` und
`status` wörtlich (case-sensitive).

Status-Spur des Boards:
`backlog → scoping → in design → ready for development → in development → in review → testing → shipped → done` (Sonderfall: `cancelled`).

**Wann welcher Status** ergibt sich aus den `→`-Markern in Schritt 3 (Routing) und Schritt 4
(Abschluss). Regeln dazu:

- **Nur vorwärts.** Steht der Task schon weiter (oder genau auf dem Ziel-Status), nicht
  zurücksetzen und nicht redundant neu schreiben.
- **Unabhängig vom Workspace.** Auch wenn der User den Branch-Switch (Schritt 2) ablehnt und
  ihr wo-ihr-seid weiterarbeitet, wird der Status gesetzt.
- **`cancelled`** nur, wenn der Task verworfen wird — nicht beim bloßen Pausieren/Abbrechen
  einer Session.

## Schritt 1: Task laden

`mcp__claude_ai_ClickUp__clickup_get_task` mit der genannten ID/URL. Daraus ziehen:

- **`custom_id`** (z.B. `LH-42`) — für Branch-Name und Commit-Referenzen
- **Name + Beschreibung** — für Slug, Typ und Komplexität
- **Conventional-Typ** selbst ableiten (der Space hat keine Tags): `feat` / `fix` /
  `refactor` / `chore` / `docs` …

Task unklar oder mehrdeutig → kurz beim User rückfragen, nicht raten.

## Schritt 2: Workspace prüfen (Branch / Worktree)

Branch-Name bilden: **`<typ>/<custom_id>-<slug>`**, custom_id klein, Slug aus dem
Task-Namen (ASCII, kebab-case, Umlaute auflösen, 3–5 Wörter).
Beispiel: `feat/lh-42-personal-status`.

`git branch --show-current` prüfen:

| Aktueller Branch | Gilt als passend? | Aktion |
|---|---|---|
| `main` / `master` | Nein | **User fragen**, dann Worktree |
| Generisch (`dev`, `wip`, `test`) oder erkennbar zu **anderer** Task | Nein | **User fragen**, dann Worktree |
| Gehört erkennbar zu **dieser** Task (ID oder Thema passt) | Ja | Hier weiterarbeiten |

**Wenn nicht passend:** dem User die Lage und den vorgeschlagenen Branch nennen und
explizit fragen, z.B.: *„Wir sind auf `main`. Für LH-42 schlage ich
`feat/lh-42-personal-status` in einem isolierten Worktree vor — anlegen?"*
Bei Zustimmung → **REQUIRED SUB-SKILL:** `superpowers:using-git-worktrees` (mit diesem
Branch-Namen). Der Skill erledigt Detection, natives `EnterWorktree`, Setup und Baseline.
Lehnt der User ab → wo wir sind weiterarbeiten.

## Schritt 3: Komplexität einschätzen → Routing

Komplexität aus Task-Beschreibung selbst einschätzen und den passenden Skill wählen. Beim
Start in den jeweiligen **Board-Status** wechseln (raus aus `backlog`):

| Komplexität | Skill | Board-Status |
|---|---|---|
| Trivial (Typo, Text/Copy-Change) | Direkt, kein Sub-Skill | `in development` |
| Anforderung unklar | **`superpowers:brainstorming`** zuerst | `scoping` → danach `in design`/`in development` |
| Bug, Ursache unklar | **`superpowers:systematic-debugging`** | `in development` |
| Feature/Bugfix, klare Spec | **`superpowers:test-driven-development`** | `in development` |
| Multi-Step / mehrere Files | **`superpowers:writing-plans`** → **`superpowers:executing-plans`** | `in design` → `ready for development` → `in development` |

## Schritt 4: Abschluss

- **`superpowers:verification-before-completion`** — vor jeder „fertig"-Aussage
- **`superpowers:requesting-code-review`** vor dem Mergen → **Status: `in review`** (läuft
  danach noch eine Abnahme-/Testrunde → `testing`)
- Commits/PR auf die `custom_id` referenzieren (z.B. `LH-42` im Body)
- Integration → **`superpowers:finishing-a-development-branch`** → nach erfolgreichem Merge
  **Status: `shipped`**; ist damit nichts mehr offen → `done`
- Wird der Task verworfen statt umgesetzt → **Status: `cancelled`**

## Don'ts

- Worktree-/Branch-Logik **nicht** selbst bauen — an `using-git-worktrees` delegieren.
- Bei nicht passendem Branch **nicht** ungefragt wechseln/anlegen — erst fragen.
- Komplexität nicht überspringen — auch „kleine" Features brauchen TDD.
- Keinen neuen Task anlegen — das ist `clickup-task-anlegen`.
- Status nicht rückwärts oder redundant setzen — nur vorwärts entlang der Spur.
