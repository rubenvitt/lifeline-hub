---
name: clickup-task-anlegen
description: Use when a task, follow-up, bug, tech-debt item, deferred work ("später"/"machen wir nachher"), open question, or feature idea surfaces while working on this Lifeline-Hub project and should be captured on the ClickUp Entwicklungsboard instead of being done now or forgotten.
---

# ClickUp-Task anlegen (Lifeline Hub)

## Überblick

Tasks und Follow-ups werden **selbstständig** über den ClickUp-MCP angelegt — ohne
vorher um Erlaubnis oder nach der Liste zu fragen. Ziel ist immer das
**Entwicklungsboard** (`901523554968`).

## Wann anlegen

Sobald etwas auftaucht, das nicht jetzt erledigt wird, aber nicht verloren gehen darf:

- Bug/Defekt bemerkt, der nicht zur aktuellen Aufgabe gehört
- Tech-Debt / Refactoring-Bedarf entdeckt
- Vom User vertagt ("machen wir später", "nicht jetzt")
- Offene Frage, die später geklärt werden muss
- Idee / Feature-Vorschlag aus dem Gespräch

**Nicht** für Schritte der aktuellen Aufgabe — die werden direkt erledigt.

## So anlegen

`mcp__claude_ai_ClickUp__clickup_create_task` mit:

- `list_id`: **`901523554968`** (fix — nicht nach der Liste fragen)
- `name`: kurzer, konkreter Titel auf Deutsch; BOS-/Fachsprache statt generischer Dev-Begriffe
- `markdown_description`: strukturiert (siehe unten) — **nicht** `description` verwenden
- `priority`: nach Einschätzung — `urgent` / `high` / `normal` / `low`
- **Keine Tags** — der Space hat keine, `tags` würde fehlschlagen

### Aufbau der Beschreibung

```
## Kontext
Woher der Punkt kommt (kurz), warum relevant.

## Zu tun
Konkret, was gemacht werden soll.

## Akzeptanzkriterien   (wenn sinnvoll)
- …

## Referenzen
- Commit / PR / Branch / Datei:Zeile
```

## Abschluss

Am Ende der Antwort kurz auflisten, was angelegt wurde (URL aus der Tool-Antwort):

```
📋 Angelegte Tasks
- [Titel](task-url)
```

## Don'ts

- Nicht nach der Liste fragen — sie ist fix.
- Nicht vor dem Anlegen um Erlaubnis bitten — selbstständig anlegen.
- Keine Tags setzen.
- `description` nicht statt `markdown_description` nutzen.
