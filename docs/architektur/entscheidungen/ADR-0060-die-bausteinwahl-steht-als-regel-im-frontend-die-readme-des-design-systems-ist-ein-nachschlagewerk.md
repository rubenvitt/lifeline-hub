---
id: ADR-0060
titel: Die Bausteinwahl steht als Regel im Frontend, die README des Design Systems ist ein Nachschlagewerk
status: akzeptiert
datum: 2026-11-16
gilt_fuer:
  - frontend/scripts/design-system/**
  - frontend/src/designSystem.test.ts
herleitung:
  - openspec/changes/archive/2026-11-16-v127ps65-design-system-nachschlagewerk/design.md
  - Zunder LLH-1807 (Variante V1 abgestimmt mit Ruben am 16.11.2026)
---

# ADR-0060: Die Bausteinwahl steht als Regel im Frontend, die README des Design Systems ist ein Nachschlagewerk

## Regeln

- MUST: Welcher Baustein einen Bedarf trägt, steht genau einmal, in `frontend/AGENTS.md`,
  „Bausteinwahl (wann nehme ich was)“; die README des Design Systems beginnt damit.
- MUST: Jede Karte des Design Systems steht in der Spalte „Karte“ der Bausteinwahl, und jede dort
  genannte Karte existiert (`frontend/src/designSystem.test.ts`).
- MUST NOT: Die erzeugte README trägt Ticketnummern; der Generator filtert Verweise und bricht bei
  einem Rest ab.
- SHOULD: Eine Regel, die nur eine Karte betrifft, steht an dieser Karte (`regeln`, `ruleHead`)
  statt in der README.

## Prüfung

```sh
verlange '^## Frontend — Bausteinwahl \(wann nehme ich was\)' frontend/AGENTS.md
verlange 'BAUSTEINWAHL_HEAD' frontend/scripts/design-system/readme.ts
verlange 'pruefeOhneTicket\(readme\)' frontend/scripts/design-system/readme.ts
verbiete '(LFH|LLH)-[0-9]+' docs/design/design-system/project/README.md
```

## Kontext

Das Design System zeigte Fachbausteine, aber keine Grundformen, und seine README war mit über
600 Zeilen und mehr als hundert Ticketverweisen eine Regelhistorie. Ein Entwurf fand die Antwort
auf „welcher Baustein?“ nicht und baute Grundformen nach.

## Konsequenzen

Die Bausteinwahl ist eine Tabelle Bedarf → Baustein → Karte; ein Wächter hält sie mit den Karten
deckungsgleich. Wer einen Baustein mit Karte einführt, trägt ihn dort ein. Die Ticketnummern
bleiben als Prüfspur in `frontend/AGENTS.md`, die README des Design Systems bleibt frei davon.
