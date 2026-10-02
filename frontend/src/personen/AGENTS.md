# Personen und Sichtung — Regeln

Gilt für `frontend/src/personen/`, `pages/personen/`, `pages/PersonenPage.tsx` und
`pages/PersonenDetailPage.tsx`, ergänzt `frontend/AGENTS.md`. Pfade relativ zu `frontend/src/`.

- **Sichtung geht mit dem Anlegen mit** (`POST …/personen` mit `sichtung`, eine Transaktion,
  unter `war_neu`) — kein nachgeschobener Request (Offline-Idempotenz). Mit `vermisst` 422,
  unbekannte Kategorie 400.
- **Eine Erfassungsmaske ist ein Bauteil, kein Ort:** `personen/AufnahmeFelder.tsx` (ohne
  `<Form>`) für Modal und `/einsaetze/:id/personen/aufnahme`; Budget verschieben, nicht dehnen.
- **`SK_META`** führt Schlüssel von `sichtungsfarben` oder `null`, keine CSS-Werte.
- **Verortungsauftrag** per `lagekartePfad(…, { platzieren })` → `?platzieren=<typ>:<id>`;
  `parsePlatzierenAuftrag` verwirft Unbrauchbares ganz; die Karte räumt den Parameter und betritt
  den Modus nur mit Schreibrecht, bei `person` zusätzlich nur mit freigegebenem Modul „Personen“
  (`personenZugriff === 'frei'`, LFH-670). Koordinaten in der Schadens-Erfassung: LFH-453.
- **Die Kartenansicht hat eine Schleuse** (LFH-668,
  `openspec/changes/archive/2026-10-01-lfh-668-betroffenen-karte-schleuse/design.md`): solange Maus/Stift über der
  Ansicht, der Fokus darin oder ein Bündel aufgefächert ist, halten die Marker Menge, Folge und Lage
  (`personen/kartenSchleuse.ts`); Sichtung und Beschriftung fließen, neu/verlegt/entfallen wartet
  im Sammelbanner der Standzeile (feste Höhe). Entfallene bleiben bis dahin stehen. Touch zählt nur
  über `onSpiderOffen`; Fokus zählt nur von der Tastatur (ein Fokus bis 1 s nach Druck oder Loslassen
  im Bereich räumt die Bedingung, der Canvas ist fokussierbar), ein Druck außerhalb klappt das Bündel ein. Nachweis: `e2e/betroffene-karte-schleuse.spec.ts`.
- **Fotos und Dateien** (LFH-757, Spec `personen-anhaenge`): aufklappbarer Abschnitt der
  Detailseite (`pages/personen/PersonAnhaenge.tsx` über den geteilten Block
  `components/anhaenge/ObjektAnhaenge`, `huelle="abschnitt"`); die Liste lädt erst mit dem
  Abschnitt. Jeder Download steht serverseitig im Zugriffsprotokoll, deshalb nur als bewusster
  Verweis, nie als Vorschau. `personAnhaenge` hängt am `person`-Ereignis, das Detail (`person`)
  bleibt nicht live, und die Anhangliste steht nicht im Lagebild offline.
