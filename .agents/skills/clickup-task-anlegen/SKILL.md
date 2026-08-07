---
name: clickup-task-anlegen
description: Use when a task, follow-up, bug, tech-debt item, deferred work ("später"/"machen wir nachher"), open question, or feature idea surfaces while working on this Lifeline-Hub project and should be captured on the ClickUp Entwicklungsboard instead of being done now or forgotten.
---

# ClickUp-Task anlegen (Lifeline Hub)

## Zweck

Halte Arbeit fest, die während einer anderen Aufgabe sichtbar wird, aber nicht in deren
Scope gehört. Lege den Task selbstständig über den verbundenen ClickUp-Connector auf dem
**Entwicklungsboard** (`901523554968`) im Workspace `9015920204` an. Frage weder nach der
Liste noch nach einer zusätzlichen Freigabe, weil diese Projektentscheidung bereits feststeht.

## Wann anlegen

Lege einen Task an, sobald ein relevanter Punkt sonst verloren gehen könnte:

- ein Bug oder Defekt außerhalb der aktuellen Aufgabe;
- Tech-Debt oder ein notwendiges Refactoring außerhalb des aktuellen Scopes;
- ausdrücklich vertagte Arbeit ("später", "nicht jetzt");
- eine offene Frage, die später geklärt werden muss;
- eine konkrete Feature- oder Verbesserungsidee.

Lege keinen Task für normale Schritte der aktuellen Aufgabe an. Diese werden direkt erledigt
und bei längeren Arbeiten im Codex-Plan geführt.

## Task erstellen

Nutze `mcp__codex_apps__clickup_clickup_create_task` mit:

- `workspace_id`: `9015920204`;
- `list_id`: `901523554968`;
- `name`: kurzer, konkreter Titel auf Deutsch; BOS-/Fachsprache statt generischer
  Entwicklerbegriffe;
- `markdown_description`: die strukturierte Beschreibung unten;
- `priority`: nach eigener Einschätzung `urgent`, `high`, `normal` oder `low`;
- keine `tags`, weil der Space keine passenden Tags hat;
- kein `description`, wenn `markdown_description` gesetzt ist.

Der aktuelle Codex-ClickUp-Connector bietet beim Erstellen kein Feld `task_type`. Erfinde
dafür weder Tag noch Custom Field. Wenn eine künftig verfügbare Create-Operation ausdrücklich
`task_type` unterstützt, verwende für Bugs `Fehler`, für funktionale Arbeit `Feature` und nur
bei klarer fachlicher Passung einen anderen vorhandenen Typ.

## Beschreibung

Verwende dieses Grundgerüst und lasse nur wirklich unpassende Abschnitte weg:

```markdown
## Kontext
Woher der Punkt kommt und warum er relevant ist.

## Zu tun
Konkret, was gemacht werden soll.

## Akzeptanzkriterien
- Prüfbarkeit statt bloßer Lösungsbeschreibung

## Referenzen
- Commit / PR / Branch / Datei:Zeile
```

Beschreibe beobachtetes Verhalten als Beobachtung. Trenne es von vermuteter Ursache und
erfinde keine noch nicht verifizierten Details.

## Abschluss

Liste in der abschließenden Antwort kurz auf, was angelegt wurde. Verwende die URL aus der
Tool-Antwort:

```markdown
📋 Angelegte Tasks
- [Titel](task-url)
```

## Grenzen

- Frage nicht nach der Liste; sie ist projektspezifisch fixiert.
- Bitte nicht noch einmal um Erlaubnis, wenn die Auslösekriterien oben erfüllt sind.
- Setze keine Tags.
- Mache aus einem Schritt der aktuellen Aufgabe keinen separaten Board-Task.
- Melde einen Task erst als angelegt, wenn der Connector die Erstellung bestätigt hat.
