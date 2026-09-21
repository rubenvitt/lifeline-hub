# Proposal

## Why

Bei Großbränden, Gefahrstoffaustritten und Industrieunfällen ist die Schadstoffbelastung der
Umgebungsluft ein Teil des Lagebilds: Gefährdung der Bevölkerung, Räumungs- und
Warnentscheidungen, Eigenschutz der Kräfte. Das Umweltbundesamt (UBA) veröffentlicht die
Messstationen des bundesweiten Luftmessnetzes mit einem stündlichen Luftqualitätsindex; die
Lagekarte kann diese Werte bisher nicht zeigen (LFH-79, Folgeebene zu LFH-69).

## What Changes

- Neue Fachebene **`luftqualitaet`** am bestehenden Aggregator `GET /api/karte/fachebenen/{quelle}`:
  Luftmessstationen als GeoJSON-Punkte mit aktuellem Luftqualitätsindex (fünf Stufen von
  „sehr gut" bis „sehr schlecht"), Leitschadstoff und den Einzelmesswerten der Station.
- **Treiber ist der Index-Abruf, nicht die Stationsliste.** Gezeichnet werden nur Stationen,
  für die im Abfragefenster ein Index vorliegt (gemessen am 21.09.2026: 388 von 2400
  gelisteten bzw. 1175 aktiven Stationen). Die Stationsliste liefert nur Koordinaten und
  Stammdaten.
- Zeitstempel der Quelle sind **MEZ ohne Sommerzeit** (`date start (CET)`) und werden beim
  Normalisieren in einen Zeitpunkt mit Zonenangabe umgerechnet; der Umschlag trägt als `stand`
  den jüngsten Messzeitpunkt.
- Caching per Stale-while-revalidate wie die übrigen Ebenen, TTL 15 Minuten (stündliche
  Werte, unregelmäßiger Importzeitpunkt der Quelle).
- Frontend: Ebenen-Eintrag im Fachebenen-Panel, Punktlayer mit Farbe **und** Punktgröße je
  Indexstufe (zwei Kanäle, WCAG 1.4.1), Detailanzeige im Fachebenen-Inspector,
  Persistenz der Sichtbarkeit in Kartenansichten.
- Neue Vertragskarte **`luftqualitaetIndex`** in `theme/statusFarben.ts` — die
  **siebzehnte**. CLAUDE.md führt jede weitere Karte als eigene Entscheidung; sie ist hier
  begründet: die Indexstufe ist eine Domänen-Achse mit Zustandsbedeutung wie
  `hochwasserKlasse` (LFH-77), und eine Karte außerhalb der Datei liefe am Abdeckungstest
  vorbei (LFH-358). Fünf Stufen fallen dabei auf drei Rollen (`normal`/`achtung`/`alarm`),
  unterschieden über das Pflichtfeld `label`.
- Doku: Eintrag in `docs/fachebenen-quellen.md` mit Pflicht-Attribution „Umweltbundesamt",
  **Lizenz-Vorbehalt** (die Einordnung als dl-de/by-2-0 ist nur sekundär belegt) und den
  gemessenen Eigenheiten der Quelle.
- Nicht **BREAKING**: der Wire-Vertrag des Aggregators (`FachebeneAntwort`) bleibt
  unverändert; ein vor dieser Änderung gespeicherter Kartenansichts-Stand liest die neue
  Ebene als „aus".

## Capabilities

### New Capabilities

- `fachebene-luftqualitaet`: Bereitstellung und Darstellung der UBA-Luftmessstationen mit
  aktuellem Luftqualitätsindex als Punkt-Fachebene der Lagekarte — Abruf, Normalisierung,
  Zeitstempel, Status/Offline-Verhalten, Attribution, Darstellung und Persistenz.

### Modified Capabilities

<!-- keine — unter openspec/specs/ existiert noch keine Fähigkeit -->

## Impact

- **Backend:** `src/karte/quellen.rs` (Fetcher + SWR), `src/karte/normalisierung.rs`
  (Normalisierer + Wire-Pins), `src/routes/karte.rs` (Quellen-`match`), `tests/karte.rs`
  (Routen-Test aus dem Cache).
- **Frontend:** `api/fachebenen.ts` (Quelle + Klassen-Typ), `theme/statusFarben.ts` (+ Test),
  `pages/lagekarte/fachebenen.ts`, neues `pages/lagekarte/luftqualitaetStil.ts`,
  `useFachebenen.ts`, `fachebenenAuswahl.ts`, `useKartenAnsicht.ts`,
  `FachebenenInspector.tsx`, `fachebenenLayer.ts` (Kategorie-Label), jeweils mit Tests.
- **Extern:** neuer ausgehender Abruf gegen `https://luftdaten.umweltbundesamt.de/api/air-data/v2`
  (zwei Aufrufe je Aktualisierung, zusammen rund 0,7 MB; keine Authentifizierung).
- **Keine** Migration, **kein** neuer OpenAPI-Typ, **keine** neue Abhängigkeit.
