# Proposal

## Why

Der Funkplan nach FwDV 100 Anlage 5 nennt die Gegenstellen, und die wichtigste davon ist die eigene
Führungsstelle (ELW, Einsatzleitung). Der Einsatz kennt sie heute nicht: Funkplan und
Fernmeldeskizze zeigen deshalb seit LFH-548/LFH-625 nur die benannte Lücke „Eigene Gegenstelle
(Führungsstelle) nicht erfasst“. `einsatz_mitgliedschaft.fuehrungsstelle` (Migration 0100) ist
Freitext je Person und trägt weder Rufname noch Sprechgruppen noch Erreichbarkeit. Dieses Feld
fehlt, damit S6 einen vollständigen Funkplan aushängen kann (LFH-849).

## What Changes

- Neu: Am Einsatz lässt sich die **eigene Führungsstelle** erfassen: Rufname, Sprechgruppen
  (TMO/DMO, dieselbe Zuordnung wie an Abschnitt und Einheit), Kommunikationsmittel und
  Erreichbarkeit. Eigene Tabelle je Einsatz, eigener Endpunkt `GET`/`PATCH
  /api/einsaetze/{id}/fuehrungsstelle`.
- Neu: Die Seite **Einsatzdaten** bekommt das Paneel „Eigene Führungsstelle“. Jede Angabe ist
  einzeln in der Leseansicht bearbeitbar (`InlineAngabe`), mit denselben Rechten wie die
  Kopfdaten.
- Geändert, **Funkplan**: Mit Angaben steht die Führungsstelle als erste Zeile vor den
  Abschnitten, in der Tabelle, im Druck und im Lagebericht (dort ohne Erreichbarkeit). Ohne
  Angaben bleibt der Hinweis „nicht erfasst“, und keine Zeile wird erfunden.
- Geändert, **Funkplan und Fernmeldeskizze**: Die Verbindung zwischen der Führungsstelle und den
  obersten Abschnitten wird beurteilt wie jede andere Verbindung. Sie zählt in der Lücke
  „Verbindungen ohne gemeinsame Sprechgruppe“ und trägt in der Skizze das Kanten-Urteil. Die Wurzel
  „Einsatzleitung“ der Skizze zeigt Rufname, Sprechgruppen und Kommunikationsmittel der
  Führungsstelle.
- Geändert, **Einsatzkopf live**: Eine Änderung der Führungsstelle verteilt das Ereignis
  `einsatz`, damit Funkplan und Einsatzdaten auf jedem Schirm frisch werden.
- Aufbewahrung: Die Erreichbarkeit wird bei der Schwärzung des Einsatzes genullt. Rufname,
  Kommunikationsmittel und Sprechgruppen-Zuordnung bleiben als Führungsstruktur erhalten.

## Capabilities

### New Capabilities
- `einsatz-fuehrungsstelle`: Erfassen, Lesen, Rechte, Live und Schwärzung der eigenen
  Führungsstelle eines Einsatzes, samt ihrer Bearbeitung auf der Seite Einsatzdaten.

### Modified Capabilities
- `stab-funkplan`: „Fehlende eigene Gegenstelle wird benannt“ wird zur Zeile der Führungsstelle
  mit Hinweis nur bei fehlenden Angaben. Die Lücke „Verbindungen ohne gemeinsame Sprechgruppe“
  bezieht die obersten Abschnitte gegen die Führungsstelle ein. Die Übernahme in den Lagebericht
  gibt die Zeile ohne Erreichbarkeit wieder.
- `stab-fernmeldeskizze`: Die Wurzel „Einsatzleitung“ zeigt die erfasste Führungsstelle. Die
  Kanten unter der Wurzel tragen das Urteil gegen deren Sprechgruppen.
- `einsatzkopf-live`: Das Ereignis `einsatz` wird auch nach einer Änderung der Führungsstelle
  verteilt.

## Impact

- Backend: neue Migration (Nummer über `alpha`), `src/einsatz/` (Repo, DTO
  `FuehrungsstelleAnzeige`), neue Routen in `src/routes/einsatz.rs`, `src/sprechgruppe/repo.rs`
  (Zuordnung), Schwärzungsregister `src/einsatz/schwaerzung_registry.rs`, `src/api_doc.rs`,
  Integrationstests unter `tests/`.
- Frontend: `api/` (Laden, Patch, Query-Key `fuehrungsstelle` live über `einsatz`), generierte
  Typen, `pages/EinsatzdatenPage.tsx`, `stab/funkplan.ts`, `stab/luecken.ts`,
  `stab/fernmeldeskizze.ts`, `stab/FernmeldeskizzeBild.tsx`, `pages/FunkplanPage.tsx`, Tests und
  e2e.
- Regeln: `frontend/src/stab/AGENTS.md` (Funkplan-Absatz).
- Keine Änderung an `einsatz_mitgliedschaft.fuehrungsstelle` (Führungsstelle je Person, LFH-461),
  an der Einsatzliste oder an der Akte der Aufbewahrung.
