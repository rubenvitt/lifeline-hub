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
  den Modus nur mit Schreibrecht. Koordinaten in der Schadens-Erfassung: LFH-453.
