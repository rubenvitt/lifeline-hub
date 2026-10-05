# Proposal

## Why

Auf `/admin/stammdaten/organisation` übergeht die auffällige, klebende Leiste „Speichern“ den
geänderten Namen: sie gehört nur zum zweiten `<Form>` (DV-102-Organisation), schickt nur
`tz_organisation` und meldet trotzdem Erfolg. Der Name geht beim Verlassen still verloren, auf
jedem Ausdruck steht weiter der alte. Dazu kommt ein allgemeiner Verlust: keine Formularseite mit
Speichern-Leiste fragt nach, bevor sie per Seitenmenü, Segmentleiste oder Brotkrume verlassen
wird. Die Reiter der Einsatz-Einstellungen sind eigene Routen, ein Reiterwechsel wirft die
Eingabe weg. Nur `EinsatzDefaults` warnt, und auch nur beim Schließen des Tabs (LFH-979).

## What Changes

- **Organisation, ein Speicherweg:** Name und DV-102-Organisation stehen in einem gemeinsamen
  Formular mit der einen klebenden Leiste. Ein Klick sendet einen PATCH mit genau den geänderten
  Feldern. Der Knopf „Namen speichern“ entfällt. Die Erfolgsmeldung nennt, was gespeichert wurde.
  Ohne Änderung geht kein Aufruf raus. Das Logo bleibt ein Sofort-Weg ohne Formular.
- **Verlassen-Schutz für Formularseiten:** Ein gemeinsamer Baustein fragt bei ungespeicherten
  Änderungen vor jedem Pfadwechsel nach („Bleiben“ / „Verwerfen“) und lässt den Browser beim
  Schließen oder Neuladen warnen. Auslöser ist ein eigener Merker, der nach erfolgreichem
  Speichern zurückfällt.
- Die Rückfrage-Mechanik aus `entwurf/EntwurfNavigationSchutz.tsx` wird zu diesem Baustein
  verallgemeinert. Die Entwürfe nutzen ihn weiter, mit „Speichern und weiter“.
- Eingebunden auf allen Seiten mit Speichern-Leiste: Organisation, Fahrzeug-Detail,
  Personal-Detail, Anzeige, Einsatz-Defaults (ersetzt dort den eigenen `beforeunload`) und den
  Einsatz-Einstellungen Allgemein, Verhalten und Aufbewahrung. „Module“ speichert jede Zeile
  sofort und bleibt ohne Schutz.
- **Regel** in `frontend/AGENTS.md`, Abschnitt „Formularseiten“: eine Speichern-Leiste je Seite;
  Formularseiten mit Leiste tragen den Verlassen-Schutz.

## Capabilities

### New Capabilities

- `formularseiten`: Speicherweg und Verlassen-Schutz der Formularseiten in Verwaltung und
  Einstellungen (eine Leiste je Seite, ehrliche Erfolgsmeldung, Rückfrage vor dem Verlassen,
  Warnung beim Schließen).

### Modified Capabilities

- keine. `org-branding` beschreibt Namensänderung und -prüfung auf Ebene der Schnittstelle; die
  bleibt unverändert.

## Impact

- Frontend: `stammdaten/OrganisationTab.tsx`, `stammdaten/FahrzeugDetailPage.tsx`,
  `stammdaten/PersonalDetailPage.tsx`, `pages/einstellungen/{AnzeigeEinstellungen,EinsatzDefaults,
  EinsatzAllgemein,EinsatzVerhalten,EinsatzAufbewahrung}.tsx`, `api/organisation.ts`,
  `entwurf/EntwurfNavigationSchutz.tsx`, neue Bausteine unter `components/`.
- Tests: `test/utils.tsx` bekommt einen Data Router auf Wunsch, weil `useBlocker` ohne ihn wirft.
  Die Tests der genannten Seiten wechseln darauf.
- Regeln: `frontend/AGENTS.md`, `frontend/src/entwurf/AGENTS.md` (Verweis auf den Baustein).
- Backend unverändert: `PATCH /api/organisation` nimmt `name` und `tz_organisation` schon heute
  optional in einem Aufruf.
