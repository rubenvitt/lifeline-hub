---
name: dev-clickup-task
description: Use when starting to implement, pick up, or work on a specific task from the Lifeline-Hub ClickUp Entwicklungsboard — e.g. "implementiere ClickUp #123", "mach mal Task X", or before coding work that corresponds to a known ClickUp task. NOT for capturing new tasks (use clickup-task-anlegen).
---

# ClickUp-Task implementieren (Lifeline Hub)

## Überblick

Einen Task vom **Entwicklungsboard** (`901523554968`) umsetzen. Dieser Skill macht nur
**zwei eigene Entscheidungen** — Workspace (Branch/Worktree) und Komplexitäts-Routing —
und delegiert alles andere an die passenden superpowers-Skills. Nichts davon
reimplementieren.

## Wann benutzen

- User nennt einen konkreten Task ("implementiere ClickUp #123", "mach Task LH-42", URL/Name)
- Bevor Code-Arbeit für einen bekannten Board-Task beginnt

**Nicht** zum Anlegen neuer Tasks → `clickup-task-anlegen`.

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

Komplexität aus Task-Beschreibung selbst einschätzen und den passenden Skill wählen:

| Komplexität | Skill |
|---|---|
| Trivial (Typo, Text/Copy-Change) | Direkt, kein Sub-Skill |
| Anforderung unklar | **`superpowers:brainstorming`** zuerst |
| Bug, Ursache unklar | **`superpowers:systematic-debugging`** |
| Feature/Bugfix, klare Spec | **`superpowers:test-driven-development`** |
| Multi-Step / mehrere Files | **`superpowers:writing-plans`** → **`superpowers:executing-plans`** |

## Schritt 4: Abschluss

- **`superpowers:verification-before-completion`** — vor jeder „fertig"-Aussage
- **`superpowers:requesting-code-review`** vor dem Mergen
- Commits/PR auf die `custom_id` referenzieren (z.B. `LH-42` im Body)
- Integration → **`superpowers:finishing-a-development-branch`**
- Kurz am Ende den Task-Status auf dem Board passend setzen (sofern sinnvoll)

## Don'ts

- Worktree-/Branch-Logik **nicht** selbst bauen — an `using-git-worktrees` delegieren.
- Bei nicht passendem Branch **nicht** ungefragt wechseln/anlegen — erst fragen.
- Komplexität nicht überspringen — auch „kleine" Features brauchen TDD.
- Keinen neuen Task anlegen — das ist `clickup-task-anlegen`.
