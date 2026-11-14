# Proposal

## Why

Die Vorplanung (06./08.11.2026) ist im Repo, in den Routen und in der Ansicht weitgehend eine Kopie
des Einsatz-Schichtplans. Das Repo-Audit vom 12.11.2026 (LLH-1684) fand 24 gleichnamige
Repo-Funktionen, 10 gleiche Handler und 361 wortgleiche Zeilen in der Planansicht. Die Spec
`vorplanung` verlangt „dieselben Regeln wie der Schichtplan“, das hält heute nur, solange jede
Regeländerung (Raster, Soll, Personenprüfung, Ansagen) zweimal gemacht wird. Dazu folgt
`planung/repo.rs` noch nicht der Bezeichner-Regel LFH-1312.

Der Schichtplan im Einsatz hat außerdem Routen für Helfer des Plans, aber keine Oberfläche dafür;
die Vorplanung hat eine. Die Spec `kraefte-schichtplan` beschreibt das Anlegen eines Helfers schon.

## What Changes

- **Ein Kern für beide Pläne im Backend:** Prüf- und Schreibwege für Blöcke, Personen und Helfer
  laufen über einen gemeinsamen Kern, der Tabellen und Scope-Spalte als Parameter bekommt (Vorbild
  `vorlagendokument`). Die Tabellen bleiben getrennt, es gibt keine Migration.
- **Was Sonderfall des Einsatzes bleibt:** Ad-hoc-Kräfte, Ist-Abgleich, Nachziehen der Ablösung,
  Wechsel, Grenzwerte, ETB-Einträge, Modulsperren. Bei der Planung bleiben Posten, Kopf,
  Schreibschutz nach der Übernahme und `stand`.
- **Eine Planansicht im Frontend:** `SchichtplanAnsicht` und `PlanungSchichtplan` werden dünne
  Hüllen um einen gemeinsamen Editor, der seinen API-Adapter als Prop bekommt. Der gemeinsame Teil
  der Druckseiten wandert ebenfalls in einen Baustein.
- **Helferliste im Einsatz-Schichtplan:** Die Helferliste der Vorplanung wird allgemein und steht
  im Schichtplan des Einsatzes. Das ist die einzige für Anwender sichtbare Neuerung.
- **Bezeichner nach LFH-1312** (`load`, `create_*`, `update_*`, `delete_*`, `check_*`) als eigener
  `refactor`-Commit. Wire, Routen, Tabellen, Ereignisse und `data-lfh` bleiben unverändert.
- Keine Änderung an Statuscodes, Fehlertexten, Antwortformen, SSE-Ereignissen oder ETB-Einträgen
  beider Pläne.

## Capabilities

### New Capabilities

Keine.

### Modified Capabilities

- `kraefte-schichtplan`: Die Helfer des Plans lassen sich im Schichtplan des Einsatzes anlegen,
  ändern und löschen (bisher nur über die Schnittstelle).

## Impact

- **Backend:**
  - `src/abloesung/schichtplan/repo.rs`, `src/planung/repo.rs`
  - Neu: `src/abloesung/schichtplan/plan_repo.rs` (Kern)
  - `src/routes/abloesung_schichtplan.rs`, `src/routes/planung.rs`
  - Nutzer der Repos: `src/demo/planung.rs`, `src/routes/zeitachse.rs`,
    `src/abloesung/schichtplan/uebernahme/repo.rs`
- **Frontend:**
  - `abloesung/schichtplan/SchichtplanAnsicht.tsx`, `planung/PlanungSchichtplan.tsx`
  - `planung/PlanungHelferListe.tsx` → allgemeine Helferliste
  - `pages/SchichtplanDruckPage.tsx`, `planung/PlanungDruckPage.tsx`
  - `api/schichtplan.ts`, `api/planungen.ts` (nur Bezeichner)
- **Doku:** `docs/anwender/` (Kapitel Schichtplan: Helferliste), `frontend/src/kraefte/AGENTS.md`
  falls Pfade wandern.
- **Kein Einfluss** auf `openapi.json`/`types.generated.ts`, Migrationen, gespeicherte Schlüssel oder
  die e2e-Selektoren.
- Ungefähr 900–1 100 Zeilen fallen weg; die Helferliste im Einsatz kommt hinzu.
