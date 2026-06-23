# CLAUDE.md

## ClickUp

Dieses Projekt hat ein eigenes ClickUp-Projekt im Space **Lifeline Hub** (`901511065513`,
Workspace/Team `9015920204`). Das **Entwicklungsboard** (`901523554968`) ist das
Task-Board des Projekts, das **Feedbackboard** (`901523554969`) sammelt Feedback.

Tasks werden selbstständig über den ClickUp-MCP angelegt — wie und wann beschreibt der
Skill `clickup-task-anlegen`.

## Frontend — UI-Form-Leitlinie (Drawer-Nutzung)

Die UI-Form richtet sich nach Umfang/Interaktion des Inhalts (LFH-19):

- **Vollseite / eigene Route** (`/einsaetze/:einsatzId/<modul>/:id`) → umfangreiche
  Detail-/Bearbeitungsansichten: mehrere Sektionen/Tabs, >~5 Felder, Workflow, Deep-Link-würdig.
  Referenzmuster: `BefehlDetailPage`, `PersonenDetailPage`.
- **Modal / Dialog** → kurze, blockierende Aktion: Bestätigung, kleines Formular (≤~3 Felder).
- **Inline / Expander** → kontextbezogener Zusatzinhalt, der die Seite nicht verlässt.
- **Drawer** → nur schlanker, fokussierter Quick-View (read-only Vorschau) oder
  Schnellerfassung (≤~4 Felder). Referenz: `PersonDetailDrawer`. Kein Bearbeiten
  umfangreicher Entitäten, keine mehrteiligen Tabs.

Faustregel: Sobald ein Drawer Tabs bekommt, einen Edit-Modus mit vielen Feldern trägt
oder breiter als ~480 px sein muss, gehört der Inhalt auf eine eigene Route.
Details/Inventar: `docs/superpowers/specs/2026-06-22-drawer-nutzung-reduzieren-design.md`.
