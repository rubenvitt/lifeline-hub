# Ort-Vorschau in der Koordinaten-Eingabe — Design

> Unter der WGS84-Zeile der Koordinaten-Eingabe (`KoordinatenEingabe`, LFH-Koordinatensysteme)
> einen **ungefähren Ort** zur Plausibilitätsprüfung anzeigen: immer eine offline-fähige
> **Peilung** (Distanz + Himmelsrichtung zum nächsten bekannten Punkt), bei Netz zusätzlich
> einen **Ortsnamen** (Reverse-Geocoding). Additiv, nie netz-blockierend.

## Kontext & Problem

Die `KoordinatenEingabe`-Komponente (`frontend/src/anzeige/KoordinatenEingabe.tsx`) zeigt beim
Tippen einer Koordinate eine Vorschau-Zeile `entspricht 51.16040, 10.45140` (WGS84-dezimal). Diese
bestätigt nur, dass der Wert geparst wurde — nicht, **ob die Position plausibel** ist. Im Einsatz
will der Anwender gegenchecken: „liegt das ungefähr da, wo es soll?".

Heute gibt es **kein Reverse-Geocoding** in der App (die `adress*`-Treffer im Code sind
Nachforderungs-Adressaten wie Leitstelle, nichts Geografisches). Es gibt aber ein erprobtes,
wiederverwendbares **Backend-Proxy-Muster** für externe Geo-Dienste:
`src/karte/quellen.rs` (reqwest-Client mit User-Agent `LifelineHub-Lagekarte/1.0`, SQLite-Cache,
online/offline-Fehlerbehandlung), dispatcht über `GET /api/karte/fachebenen/{quelle}`
(`src/routes/karte.rs`). Wichtig: diese Dienste **ziehen** öffentliche Warndaten (NINA/DWD/Pegel) —
sie senden keine Einsatzdaten nach außen.

**Constraints (BOS):** Im Einsatz oft kein Netz → die Vorschau muss offline funktionieren.
Reverse-Geocoding sendet die Einsatz-Koordinate an einen Dritt-Server → Datenschutz-Abwägung.
Nominatim-Nutzungsrichtlinie (verifiziert) verbietet Autocomplete/Per-Tastenanschlag, verlangt
identifizierenden User-Agent + Caching, max 1 req/s.

## Entscheidungen (Checkpoint mit User)

1. **Hybrid, additiv:** Peilung als **Fundament** (immer, offline), Ortsname als **Anreicherung**
   (online, wenn schnell). Nicht „Name *oder* Peilung".
2. **Peilung nie netz-gekoppelt:** Backend berechnet die Peilung bedingungslos; der Geocoder läuft
   mit hartem kurzem Timeout und liefert den Namen nur, wenn er rechtzeitig/aus dem Cache kommt.
3. **Peilungs-Bezug:** zum **nächstgelegenen bekannten verorteten Punkt** des Einsatzes
   (Einsatzort/UHS/Schaden/Einheit/Fahrzeug/Personal/Lagemeldung), mit Bezeichnung; Selbst-Ausschluss
   beim Bearbeiten einer bestehenden Position.
4. **Geocoder konfigurierbar** (Admin/Org-Einstellung), Default öffentlicher Nominatim.
5. **Wiederverwendbarer Geocoding-Dienst** (konzeptionell beide Richtungen, jetzt nur Reverse).
6. **Backend macht beides** (Peilung + Geocoding); Frontend zeigt nur an.
7. **Trigger debounced/on-blur**, nicht per-Tastenanschlag (Nominatim-ToS).

## Architektur

### Grundprinzip

Die Ort-Zeile ist **rein additiv** zur bestehenden WGS84-Vorschau und **degradiert leer**: fehlt der
Bezugspunkt oder das Netz, verschwindet einfach der jeweilige Teil — nie ein Fehler. Persistenz von
Koordinaten bleibt unberührt (WGS84); dieses Feature liest nur.

### Endpoint-Vertrag

```
GET /api/einsaetze/:id/ort-vorschau?lat=<f64>&lon=<f64>&exclude=<typ:id optional>
→ 200 {
    "peilung":  { "distanz_m": 1234.0, "richtung": "NO", "bezug_label": "Einsatzort" } | null,
    "ortsname": "Hauptstr. 5, 12345 Musterstadt" | null
  }
```

- `peilung`: **bedingungslos** berechnet. Backend lädt die verorteten Marker des Einsatzes, ermittelt
  den nächsten zur Anfrage-Koordinate (Haversine), berechnet Distanz + 8-Strich-Richtung (Bearing),
  liefert dessen Bezeichnung. `exclude` (z. B. `uhs:7`) schließt die gerade bearbeitete Entität aus,
  damit nicht „5 m von sich selbst" erscheint. Kein Marker vorhanden → `peilung: null`.
- `ortsname`: parallel versucht über den Geocoding-Dienst mit **hartem Timeout** (1,5 s). Offline,
  Timeout, Rate-Limit-überzählig oder kein Treffer → `ortsname: null`. Die Peilung steht trotzdem.
- Auth/Scope wie andere `/api/einsaetze/:id/*`-Routen (Einsatz-Mitglied).

### Backend-Geocoding-Dienst (wiederverwendbar)

Neues Modul `src/geocoding/` nach dem `quellen.rs`-Muster:
- `reqwest`-Client mit eigenem User-Agent `LifelineHub-Geocoder/1.0 (+<repo>)`.
- **Konfigurierbare Geocoder-URL**: neue Spalte `org_einstellungen.geocoder_url TEXT` (NULL =
  öffentlicher Nominatim `https://nominatim.openstreetmap.org`). Reverse-Aufruf:
  `{{base}}/reverse?lat={lat}&lon={lon}&format=jsonv2&zoom=18&accept-language=de` → `display_name`
  (bzw. kompaktere Zusammensetzung aus `address`).
- **Cache** als eigene Tabelle `geocoding_cache(lat_key, lon_key, ortsname, erstellt_at)`, Key =
  auf ~3 Nachkommastellen (~100 m) **gerundete** Koordinate, **quasi-permanente TTL** (Ergebnis ist
  faktisch unveränderlich). Andere Form als `fachebenen_cache` (das eine periodisch erneuerte
  FeatureCollection hält) — wiederverwendet wird das **reqwest-Proxy-Konzept**, nicht die Tabelle.
  Runden schützt zusätzlich gegen Rate-Limit und Datenschutz (Nachbarpunkte → ein Eintrag).
- **Rate-Limit**: Token-Bucket, max 1 req/s gegen den Geocoder (Nominatim-ToS). Überzählige
  Anfragen geocodieren nicht, sondern liefern `ortsname: null` (Peilung kommt ja sowieso).
- Cache-Treffer umgeht Timeout und Rate-Limit.

### Peilung (reine Mathematik, keine Abhängigkeit)

`src/geocoding/peilung.rs` (oder im Modul): Haversine-Distanz + Initial-Bearing zwischen zwei
WGS84-Punkten; Bearing → 8-Strich (`N, NO, O, SO, S, SW, W, NW`). Marker-Quellen (alle mit
`lat`/`lon != NULL`, Einsatz-scoped): Einsatzort (`einsatz.einsatzort_lat/lon`), `uhs`,
`einsatz_schaden`, `einsatz_einheit`, `einsatz_fahrzeug`, `einsatz_personal`, `lage_meldung`. Je
Quelle Bezeichnung + Typ-Tag für `exclude` und `bezug_label`.

### Frontend

- Hook `useOrtVorschau(einsatzId, koord, exclude?)` (React-Query): ruft den Endpoint **debounced
  ~700 ms** nach der letzten Eingabe (bzw. on-blur / nach Kartenklick) — **nicht** per Tastenanschlag.
  `enabled` nur bei gültiger Koordinate. Query-Key inkl. gerundeter Koordinate (teilt Cache-Treffer).
- `KoordinatenEingabe.tsx`: zusätzliche **sekundäre Zeile** unter der WGS84-Vorschau. Rendert
  `ortsname` (falls da) + `peilung` (falls da) als `«ortsname» · «distanz» «richtung» von «bezug»`,
  z. B. `Hauptstr. 5, Musterstadt · 1,2 km NO vom Einsatzort`. Distanz über das vorhandene
  `formatDistanz` (`anzeige/format.ts`). Lädt → dezente Lade-/Leeranzeige, kein Layout-Sprung.
- `exclude` wird vom Aufrufer durchgereicht, wo bekannt (z. B. UHS-Verortung → `uhs:<id>`); wo das
  kontext-agnostische Widget die Entität nicht kennt, bleibt `exclude` leer (akzeptabel).

## Datenfluss

1. Anwender tippt/wählt eine Koordinate → Widget hat gültiges `{lat,lon}` (WGS84).
2. WGS84-Zeile erscheint **sofort** (lokal, unverändert).
3. Nach ~700 ms Pause: `useOrtVorschau` ruft `GET /api/einsaetze/:id/ort-vorschau`.
4. Backend: Peilung sofort berechnet; Ortsname aus Cache oder (rate-limitiert, getimeoutet) vom
   Geocoder.
5. Antwort `{peilung, ortsname}` → sekundäre Zeile rendert, was vorhanden ist.

## Fehlerbehandlung & Edge-Cases

- **Offline / Geocoder-Timeout** → `ortsname: null`, Peilung steht. Nie Wartezeit auf das Netz.
- **Kein Referenzpunkt** (neuer Einsatz, erstes Objekt) → `peilung: null`; Zeile zeigt nichts
  Zusätzliches (die Koordinate steht ohnehin in der WGS84-Zeile). Additiv, kein Bug.
- **Selbst-Ausschluss** → `exclude=typ:id`; ohne `exclude` ist der nächste Punkt evtl. die eigene
  alte Position (bewusst akzeptiert, wo die Entität unbekannt ist).
- **Ungültige/leere Koordinate** → Hook disabled, kein Call.
- **Geocoder-URL falsch konfiguriert** → wie offline behandelt (`ortsname: null`), kein Crash.

## ToS & Datenschutz (bewusste Abwägung)

- Nominatim-konform: Backend-Proxy + identifizierender User-Agent + Cache + Rate-Limit (≤1/s) +
  Debounce (kein Autocomplete). Das sind **Pflichten** der Nutzungsrichtlinie, nicht Komfort.
- **Datenschutz:** Der Default-Nominatim **sendet die Einsatz-Koordinate an einen öffentlichen
  Dritt-Server** — anders als die bestehenden *Pulls* öffentlicher Warndaten. Bewusst gewählt (User).
  Admin kann eine eigene Geocoder-URL (eigener Nominatim/Photon) hinterlegen; die Peilung funktioniert
  immer ohne externen Dienst. Im Modul-Header dokumentieren (Stil der GK-~3m-Grenze).

## Scope-Abgrenzung (bewusst außerhalb)

- **Forward-Geocoding** (Adresse → Koordinate, z. B. fürs heute manuelle `einsatzort`-Adressfeld):
  Modul konzeptionell vorgesehen, jetzt nicht implementiert (YAGNI).
- **Ort-Anzeige in reinen Anzeige-Stellen** (Inspector, EinsatzdatenPage-Lesemodus): Hook/Dienst sind
  so geschnitten, dass das ohne Redesign nachrüstbar ist — jetzt nur die Eingabe-Vorschau.
- Persistierung des Ortsnamens (kein Speichern; reine Anzeige).

## Teststrategie

- **Peilung (Rust-Unit):** Haversine/Bearing gegen bekannte Festwerte (z. B. Nord = 0°→`N`,
  Ost→`O`); nächster-Punkt-Auswahl mit mehreren Markern; `exclude` greift; kein Marker → `None`.
- **Geocoding-Dienst (Rust):** Cache-Hit umgeht HTTP (mit Mock/lokalem Stub); Rate-Limit-überzählig →
  `None`; Timeout → `None`; gerundeter Cache-Key (Nachbarpunkte teilen Eintrag).
- **Route (Rust-Integration):** Antwort-Shape `{peilung, ortsname}`; offline-Stub → Peilung da,
  ortsname null; Auth/Scope.
- **Frontend (vitest):** Hook debounced (kein Call vor Pause / bei ungültiger Koordinate); Widget
  rendert beide/eine/keine Schicht; `formatDistanz`-Nutzung; kein Layout-Sprung.
- Gates wie üblich: `tsc --noEmit`, `vitest run --no-file-parallelism`, `cargo test`.

## Sequenzierung (Peilung = 80/20)

1. **Fundament:** Peilung (Haversine/Bearing + nächster-Punkt-Suche) + Endpoint (nur `peilung`,
   `ortsname` vorerst immer null) + Frontend-Hook + Widget-Zeile. **Eigenständig shippbar** — voller
   Plausibilitäts-Check ohne externen Dienst.
2. **Anreicherung:** Geocoding-Dienst (Modul, `geocoding_cache`, Rate-Limit, konfigurierbare
   `geocoder_url`) → `ortsname` in dieselbe Antwort; Admin-Einstellung erweitern.

## Risiken & bewusste Grenzen

- **Nominatim-Qualität/-Verfügbarkeit:** öffentlicher Dienst, keine SLA; Cache + Peilungs-Fallback
  mildern das. Für Produktivlast eigener Geocoder empfohlen (konfigurierbar).
- **Datenschutz Default-Nominatim** (s. o.) — dokumentiert, Admin-umschaltbar.
- **`exclude` nur wo die Entität bekannt ist** — sonst seltener „nahe der eigenen alten Position";
  akzeptiert.
- **Marker-Last:** nächster-Punkt-Suche lädt die Einsatz-Marker pro Anfrage; durch Debounce + Cache
  selten. Bei sehr vielen Markern ggf. später optimieren (YAGNI).

## Betroffene Dateien

| Datei | Änderung |
|---|---|
| `src/geocoding/mod.rs` | **neu** — Geocoding-Dienst (reqwest, konfigurierbare URL, Rate-Limit, Timeout) |
| `src/geocoding/peilung.rs` | **neu** — Haversine/Bearing + nächster-Punkt-Suche |
| `src/geocoding/cache.rs` | **neu** — `geocoding_cache` lesen/schreiben (gerundeter Key) |
| `migrations/<nächste-freie-Nr>_geocoding.sql` | **neu** — Tabelle `geocoding_cache`; `ALTER TABLE org_einstellungen ADD COLUMN geocoder_url` (letzte Migration war 0070 → nächste freie Nummer ermitteln) |
| `src/routes/einsatz.rs` (o. neue Route-Datei) | **neu** — `GET /api/einsaetze/:id/ort-vorschau` |
| `src/org/einstellungen.rs` | `geocoder_url` in Struct/Load/Save |
| `frontend/src/api/ortVorschau.ts` | **neu** — API-Client + Typen `{peilung, ortsname}` |
| `frontend/src/anzeige/useOrtVorschau.ts` | **neu** — debounced React-Query-Hook |
| `frontend/src/anzeige/KoordinatenEingabe.tsx` | sekundäre Ort-Zeile; `exclude`-Prop |
| `frontend/src/pages/GlobalEinstellungenPage.tsx` | Geocoder-URL-Feld (Admin) |
| `frontend/src/api/types.ts` | `OrgEinstellungen.geocoder_url` |
