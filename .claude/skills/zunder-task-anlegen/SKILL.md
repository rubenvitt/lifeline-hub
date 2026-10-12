---
name: zunder-task-anlegen
description: Use when a task, follow-up, bug, tech-debt item, deferred work ("später"/"machen wir nachher"), open question, or feature idea surfaces while working on this Lifeline-Hub project and should be captured on the Zunder Entwicklungsboard instead of being done now or forgotten.
---

# Zunder-Aufgabe anlegen (Lifeline Hub)

## Überblick

Aufgaben und Follow-ups werden **selbstständig** über den Zunder-Connector angelegt — ohne
vorher um Erlaubnis oder nach der Stelle zu fragen. Ziel ist immer das Dev-Projekt
**„Dev: Lifeline-Hub“** (Entwicklungsboard). IDs, Status und Kennungen stehen zentral in
`AGENTS.md`, Abschnitt „Zunder“.

## Wann anlegen

Sobald etwas auftaucht, das nicht jetzt erledigt wird, aber nicht verloren gehen darf:

- Bug/Defekt bemerkt, der nicht zur aktuellen Aufgabe gehört
- Tech-Debt / Refactoring-Bedarf entdeckt
- Vom User vertagt ("machen wir später", "nicht jetzt")
- Offene Frage, die später geklärt werden muss
- Idee / Feature-Vorschlag aus dem Gespräch

**Nicht** für Schritte der aktuellen Aufgabe — die werden direkt erledigt.

## So anlegen

`create_task` des Zunder-Connectors mit:

- `location`: `{"kind":"project","id":"aafceb07-f9e9-5e8b-8ffe-a38afadd7067"}` (fix — nicht
  nach der Stelle fragen; ohne `location` landet die Aufgabe in der Inbox)
- `title`: kurzer, konkreter Titel auf Deutsch; BOS-/Fachsprache statt generischer Dev-Begriffe
- `description`: strukturiert (siehe unten), Markdown
- `type`: `bug` für Defekte, `feature` für Funktionales, sonst `aufgabe`
- Gehört der Punkt zu einer laufenden Aufgabe: `parent_id` setzen. Mehrere Teilaufgaben auf
  einmal: `decompose_task` statt einzelner `create_task`-Aufrufe.

Prioritäten, Tags und Zuständige gibt es in Zunder nicht.

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

Am Ende der Antwort kurz auflisten, was angelegt wurde (`id` aus der Tool-Antwort):

```
📋 Angelegte Aufgaben
- [Titel](https://zunder.rubeen.dev/#/aufgabe/<id>)
```

## Don'ts

- Nicht nach der Stelle fragen — sie ist fix.
- Nicht vor dem Anlegen um Erlaubnis bitten — selbstständig anlegen.
- Nichts löschen (`delete_task`) — Überflüssiges auf `dropped` setzen.
