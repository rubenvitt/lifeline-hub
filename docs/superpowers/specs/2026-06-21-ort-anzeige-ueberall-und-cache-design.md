# Ort-Anzeige an allen Koordinaten + Langzeit-Cache — Design

> Erweitert die „Ort-Vorschau in der Koordinaten-Eingabe" (gemergt) auf **alle** Koordinaten-
> Stellen (Eingaben **und** reine Anzeigen) über eine geteilte Komponente, und cacht die
> **Ortsnamen sehr lange** — clientseitig persistent (IndexedDB) und serverseitig permanent mit
> langer Stale-while-revalidate-Auffrischung. Die **Peilung bleibt live** (Marker bewegen sich).

## Kontext & Problem

Die Ort-Zeile (Peilung + Ortsname) hängt bisher nur an **einem** Eingabefeld (EinsatzdatenPage,
Einsatzort). Überall sonst — Lagekarte-Sidebar (Platzieren), Lagerelevant-Modal, sowie alle
**reinen Anzeige-Stellen** (EinsatzdatenPage-Detail, Lagekarte-Inspector, LagemeldungenPage) —
fehlt sie. Der Anwender erwartet den Ort an **jeder** Koordinate, Eingabe wie Ausgabe.

Zudem soll der teure/externe Teil (Reverse-Geocoding) **sehr lange** gecacht werden, lokal und auf
dem Server, damit Ortsnamen auch offline und ohne wiederholte Nominatim-Last sofort dastehen.

**Bestand (verifiziert):**
- Server-Cache `geocoding_cache` (SQLite) ist bereits **permanent** (kein Prune/TTL).
- Client cacht nichts dauerhaft: QueryClient ist in-memory (`staleTime: 10s`), `useOrtVorschau`
  überschreibt mit `staleTime: Infinity` — überlebt aber keinen Reload.
- `idb` (IndexedDB) ist Dependency und etabliertes Muster (`src/offline/queue.ts`).
- SWR-Muster existiert bereits: `liefere_mit_swr` in `src/karte/quellen.rs`.

## Entscheidungen (mit User abgestimmt)

1. **Volle Anzeige überall:** geteilte `KoordinatenAnzeige` zeigt Peilung **+** Ortsname an jedem
   Input und Output, inkl. Listen. Token-Bucket (≤1/s) + Cache + gerundeter Key bremsen die
   Geocoder-Last; Batch-Endpoint bewusst aufgeschoben (YAGNI).
2. **Lebensdauer-Trennung (Korrektheit):** Nur der **Ortsname** (Koordinate → Ort) ist
   unveränderlich und wird lang gecacht. Die **Peilung** hängt von aktuellen Markern ab und bleibt
   **live** — `staleTime` runter von `Infinity` auf kurz.
3. **Client dauerhaft:** persistenter IndexedDB-Store `gerundete-Koordinate(~100 m) → ortsname`,
   quasi-permanent; aktualisiert sich, wann immer online eine frische Antwort kommt.
4. **Server lange + SWR:** Ortsnamen permanent ausliefern; Einträge älter als **90 Tage** lösen beim
   nächsten Zugriff eine **nicht-blockierende** Hintergrund-Neugeocodierung aus (rate-limitiert,
   inflight-dedupliziert). Nie blockierend, nie hart abgelaufen.
5. **Gerundeter Key (3 Nachkommastellen, ~100 m)** einheitlich über Local-Store, React-Query-Key
   und Server-Cache.
6. **Karten-Pins** selbst bekommen keine Ort-Zeile (nur der Inspector beim Klick).

## Architektur

### Frontend

**Geteilte Ort-Zeile (Refactor).** Die heute in `KoordinatenEingabe` eingebettete
`OrtVorschauZeile` wird zu einer eigenständigen, exportierten Komponente
`src/anzeige/OrtZeile.tsx` extrahiert (Props: `einsatzId`, `koord`, `exclude?`). Beide Consumer
nutzen sie:
- `KoordinatenEingabe` (Eingabe) — wie bisher, debounced (`debounceMs ~700`).
- `KoordinatenAnzeige` (**neu**, Ausgabe) — `src/anzeige/KoordinatenAnzeige.tsx`: rendert die
  formatierte Koordinate (`useAnzeigeKonventionen().formatKoordinate`) **plus** `OrtZeile`. Props:
  `{ lat, lon, einsatzId?, exclude? }`. Für statische Werte `debounceMs = 0` (sofort). Ohne
  `einsatzId` rendert sie nur die Koordinate (additiv, kein Hook → kein QueryClient-Zwang).

**Persistenter Ortsnamen-Store.** `src/anzeige/ortCache.ts` (idb): eine Object-Store-Map
`ortKey → ortsname`. API:
- `ortKeyVon(lat, lon): string` — `${runde(lat)},${runde(lon)}` (3 Nachkommastellen).
- `holeOrt(key): Promise<string | null>`
- `setzeOrt(key, name): Promise<void>`
Quasi-permanent (kein Eviction). Cache-Fehler nicht fatal (→ null/no-op, geloggt).

**Hook-Anpassung `useOrtVorschau`.**
- `staleTime` von `Infinity` auf einen kurzen Wert (z. B. `30_000`) → Peilung bleibt frisch.
- Bei erfolgreicher Antwort mit nicht-leerem `ortsname` → `setzeOrt(ortKey, ortsname)`.
- Der **angezeigte** Ortsname = `response.ortsname ?? persistierter Ortsname` (Lese-Fallback,
  damit Ortsnamen offline / bei Rate-Limit weiter erscheinen). Der persistierte Wert wird über
  eine begleitende, sehr lang gecachte Query (`['ort-name', ortKey]`, `staleTime: Infinity`,
  `queryFn: () => holeOrt(ortKey)`) eingelesen, sodass `OrtZeile` reaktiv bleibt.
- `debounceMs` bleibt Parameter (Eingabe ~700, Anzeige 0).

**Verdrahtung — Eingaben:**
- `pages/lagekarte/Sidebar.tsx:141`: `einsatzId` (neue Prop, vom LagekartePage durchgereicht) +
  `exclude` aus `platzierungZiel` (`typ:id`), Typ-Mapping `fuehrung→personal`, sonst identisch;
  `einsatzort`-Platzierung → `einsatzort:<einsatzId>`.
- `meldungen/LagerelevantModal.tsx:63`: `einsatzId` (aus Props/Context); kein Selbst-Ausschluss
  (die Lagemeldung existiert noch nicht).

**Verdrahtung — Ausgaben (über `KoordinatenAnzeige`):**
- `pages/EinsatzdatenPage.tsx:234` (Detail/Descriptions): `exclude=einsatzort:<einsatzId>`.
- `pages/lagekarte/Inspector.tsx:79` (Marker-Klick): `exclude=<marker-typ>:<marker-id>` (Marker-Typ
  → Backend-Typ-Tag gemappt).
- `pages/LagemeldungenPage.tsx:55` (Liste, je Eintrag): `exclude=lagemeldung:<id>`.

### Backend (Server-Cache lange + SWR)

`src/geocoding/` wird um eine **lange SWR-Auffrischung** ergänzt:
- Konstante `CACHE_TTL = 90 Tage`.
- `cache::lese` liefert zusätzlich das Alter (Sekunden) — neue Funktion `cache::lese_mit_alter`.
- In `reverse_mit`: Cache-Treffer wird **immer sofort** zurückgegeben. Ist er älter als `CACHE_TTL`,
  wird **einmalig** (inflight-dedupliziert) ein `tokio::spawn` mit einer Neugeocodierung
  angestoßen (rate-limitiert über den bestehenden Token-Bucket; bei Erfolg `cache::schreibe`).
  Schlägt der Refresh fehl, bleibt der alte Wert — nie blockierend.
- Inflight-Dedup: ein `Mutex<HashSet<String>>` in den `OnceLock`-Statics (Schlüssel = `lat_key:lon_key`),
  analog `FachebenenState.inflight`. Im injizierbaren `reverse_mit` wird das Inflight-Set wie der
  Bucket als Parameter übergeben (Test-Isolation, frisch pro Test).
- Endpoint-Vertrag `{peilung, ortsname}` bleibt unverändert.

## Datenfluss (Ausgabe-Fall)

1. `KoordinatenAnzeige` rendert die Koordinate sofort (lokal).
2. `OrtZeile` startet `useOrtVorschau` (debounce 0). Parallel liest die `['ort-name', key]`-Query
   den persistenten Local-Store → zeigt einen früher gesehenen Ortsnamen ggf. sofort.
3. Live-Antwort: Peilung (immer) + Ortsname (best-effort). Bei Ortsname≠null → in den Local-Store
   geschrieben; angezeigt wird `live.ortsname ?? localStore`.
4. Server: Cache-Hit sofort; bei Alter > 90 Tagen Hintergrund-Refresh (nicht-blockierend).

## Fehlerbehandlung & Edge-Cases

- **Offline (Client→Server):** Query schlägt fehl → Peilung fehlt, aber der persistente
  Ortsname-Fallback zeigt einen früher gesehenen Ort. Additiv, kein Fehler.
- **Offline (Server→Geocoder):** ortsname=null aus der Live-Antwort → Local-Store-Fallback greift;
  Peilung kommt trotzdem.
- **idb nicht verfügbar / Fehler:** `holeOrt`→null, `setzeOrt`→no-op (geloggt). Feature degradiert
  auf reines Server-Verhalten.
- **Kein `einsatzId`:** `KoordinatenAnzeige` zeigt nur die Koordinate (kein Hook).
- **Liste (LagemeldungenPage):** je Eintrag eine Query; Rate-Limit/Cache/Local-Store bremsen die
  Geocoder-Last, Peilung ist lokal. Batch später falls nötig.

## Teststrategie

- **ortCache (vitest + fake-indexeddb, bereits im Setup):** set→get-Roundtrip; Miss→null;
  idb-Fehler → null/no-op; Key-Rundung teilt Nachbarn.
- **useOrtVorschau:** staleTime kurz (Peilung refetcht); Ortsname wird persistiert; Fallback aus
  Store wenn Live-Ortsname null; debounceMs 0 vs. 700.
- **OrtZeile / KoordinatenAnzeige:** rendert Koordinate immer; Ort-Zeile nur mit einsatzId; volle
  Zeile (Ortsname · Distanz Richtung von Bezug); kein Layout-Sprung.
- **KoordinatenEingabe:** bestehende Tests bleiben grün (OrtZeile-Extraktion verhaltensneutral).
- **Verdrahtungs-Tests:** je Site mind. ein Test, dass `einsatzId`/`exclude` korrekt durchgereicht
  werden (Sidebar typ-mapping, Inspector marker-typ, Lagemeldung-Liste).
- **Server SWR (Rust):** frischer Cache → kein Refresh; Eintrag > TTL → alter Wert sofort +
  Refresh angestoßen (inflight zählt 1); Refresh-Fehlschlag → alter Wert bleibt; inflight-Dedup.
- Gates: `cargo test`, `tsc --noEmit`, `vitest run --no-file-parallelism`.

## Scope-Abgrenzung (bewusst außerhalb)

- **Batch-Endpoint** für Listen — aufgeschoben (YAGNI), bei großen Listen nachrüstbar.
- **Karten-Pins** (MapLibre-Marker) bekommen keine Ort-Zeile; nur der Inspector beim Klick.
- **Forward-Geocoding** — weiterhin außerhalb.
- **Peilung-Cache** — bewusst NICHT (Marker ändern sich).

## Betroffene Dateien

| Datei | Änderung |
|---|---|
| `frontend/src/anzeige/OrtZeile.tsx` | **neu** — extrahierte Ort-Zeile (aus KoordinatenEingabe) |
| `frontend/src/anzeige/KoordinatenAnzeige.tsx` | **neu** — Output-Komponente (Koordinate + OrtZeile) |
| `frontend/src/anzeige/ortCache.ts` | **neu** — persistenter idb-Ortsnamen-Store |
| `frontend/src/anzeige/useOrtVorschau.ts` | staleTime kurz; Persistenz schreiben + Fallback lesen; debounceMs |
| `frontend/src/anzeige/KoordinatenEingabe.tsx` | nutzt extrahierte `OrtZeile` |
| `frontend/src/pages/lagekarte/Sidebar.tsx` | `einsatzId`-Prop + `exclude` aus Platzierungsziel |
| `frontend/src/pages/lagekarte/LagekartePage.tsx` (o.ä. Parent) | `einsatzId` an Sidebar durchreichen |
| `frontend/src/meldungen/LagerelevantModal.tsx` | `einsatzId` an KoordinatenEingabe |
| `frontend/src/pages/EinsatzdatenPage.tsx` | Detail-Koordinate → `KoordinatenAnzeige` |
| `frontend/src/pages/lagekarte/Inspector.tsx` | Marker-Koordinate → `KoordinatenAnzeige` (exclude) |
| `frontend/src/pages/LagemeldungenPage.tsx` | Listen-Koordinate → `KoordinatenAnzeige` |
| `src/geocoding/mod.rs` | SWR-Refresh (TTL 90 d, inflight-Set in Statics, reverse_mit erweitert) |
| `src/geocoding/cache.rs` | `lese_mit_alter` (Alter in Sekunden) |
