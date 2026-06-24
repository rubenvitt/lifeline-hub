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

## Frontend — Deeplink-Muster (Route vs. Query-Param)

Modulübergreifende Deeplinks folgen einem festen Muster (LFH-25):

- **Item-Route** `/einsaetze/:id/<modul>/:<modul>Id` → das Modul hat eine eigene
  Vollseiten-Detailansicht (uhs, br, lagebericht, befehl, person, tier, schaden).
- **Query-Param-Selektion** `/einsaetze/:id/<modul>?<modul>=<id>` → das Zielobjekt wird in
  einer Listenseite selektiert/als Drawer geöffnet, weil (noch) keine Detail-Route existiert
  (`?einheit=`, `?fahrzeug=`, `?personal=`, `?abschnitt=`, `?meldung=`,
  `?auftrag=`, `?gefahrengebiet=`, ETB `?eintrag=`). `?neu=1` fokussiert die Schnellerfassung.

Faustregel: Vollseiten-Detail vorhanden → Item-Route, sonst Query-Param. Param-Namen sind
sprechend (`:<modul>Id`, Query-Key Modul-Singular) und nutzen die stabile DB-`id` (nicht die
laufende Anzeigennummer).

**Quelle der Wahrheit:** `frontend/src/routing/deeplinks.ts` (zentrale, unit-getestete
URL-Builder) — keine inline-Template-Literals für Einsatz-Pfade. `parseRouteId` dort
validiert Route-IDs (positive Ganzzahl, sonst Redirect auf die Liste).
Details: `docs/superpowers/specs/2026-06-23-deeplinks-vereinheitlichen-design.md`.

## Frontend — Lint-Disziplin

`pnpm lint` läuft mit `--max-warnings 0`: Warnings brechen das Gate genauso hart wie
Errors (LFH-168). Sie werden **behoben, nicht ignoriert** — und zwar an der Wurzel:

- `react-hooks/exhaustive-deps` strukturell lösen (z. B. Primitive statt Objekt in die
  Deps, `useMemo`/`useCallback` zur Identitäts-Stabilisierung), nicht die fehlende
  Dependency stumpf hineinzwingen, wenn das den Effekt ungewollt neu auslösen würde.
- `eslint-disable` nur als **begründete Ausnahme**, wenn der echte Fix nachweislich falsch
  wäre (z. B. eine Dependency, die den Effekt bewusst *nicht* neu triggern soll): dann
  zeilengenau (`eslint-disable-next-line <regel>`) **an der gemeldeten Stelle** — die
  exhaustive-deps-Warnung sitzt auf der Deps-Array-Zeile, nicht auf dem `useEffect(` — und
  **mit Kommentar, warum**. Keine pauschalen Datei-/Block-Disables, keine toten Direktiven
  (eslint meldet ungenutzte Disables selbst). Referenz: `LagekartePage` Blob-URL-Effekt (LFH-166).
