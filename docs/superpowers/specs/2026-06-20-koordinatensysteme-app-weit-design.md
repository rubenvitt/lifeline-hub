# Koordinatensysteme app-weit (Anzeige · Eingabe · Umschalten) — Design

> Das in der Verwaltung gewählte Koordinatenformat soll **app-weit** gelten — für
> Datendarstellung **und** Eingabefelder, nicht nur in der Karten-Inspector-Anzeige.
> Orte sollen im gewählten System **angelegt** werden können, und der Anwender soll
> **spontan zwischen Systemen wechseln** können (live umgerechnet). Neu hinzu kommen
> die Systeme **WGS84-DMS** und **Gauß-Krüger**.

## Kontext & Problem

Seit LFH-136 existiert eine zentrale Anzeige-Konventionen-Infrastruktur:

- `frontend/src/anzeige/format.ts` — `formatKoordinate(lat, lon, konv)` (WGS84-dezimal / MGRS / UTM)
- `frontend/src/anzeige/koordinaten.ts` — schlanke **Vorwärts**-Eigenimplementierung (WGS84 → UTM/MGRS), bewusst ohne proj4
- `frontend/src/anzeige/AnzeigeKonventionenContext.tsx` — `useAnzeigeKonventionen()`-Hook, einsatz-gebunden
- Konfiguriert wird das Format als **Org-Default** (`GlobalEinstellungenPage`) mit optionalem **Einsatz-Override** (`EinsatzEinstellungenPage`); Effektivwert via `src/einsatz/effektiv.rs::effektive_koordinatenformat` (Zeile 73): **Einsatz-Override ?? Org-Default ?? Fallback (wgs84)**.

**Drei Lücken:**

1. **Anzeige nicht durchgängig.** Nur der Karten-`Inspector` nutzt `formatKoordinate`. Zwei weitere Stellen rendern roh und ignorieren die Konvention:
   - `EinsatzdatenPage.tsx:232-236` → `${einsatz.einsatzort_lat}, ${einsatzort_lon}` (volle Float-Präzision, kein `toFixed`)
   - `LagemeldungenPage.tsx:52-54` → `Geo: {l.lat.toFixed(5)}, {l.lon.toFixed(5)}`
2. **Keine Eingabe im gewählten System.** Alle 3 Koordinaten-Eingabestellen sind reine WGS84-Dezimal-`InputNumber`. Eine **inverse** Funktion (String → `{lat,lon}`) fehlt in `format.ts`/`koordinaten.ts` komplett.
3. **Kein Wechsel + neue Systeme.** Kein spontaner Umschalter; DMS und Gauß-Krüger fehlen ganz (die Eigenimpl kann nur vorwärts UTM/MGRS).

## Entscheidungen (Checkpoint mit User)

1. **Wechsel-Art:** Org-Default als Voreinstellung **+ flüchtiger Umschalter** pro Anwender, live umgerechnet.
2. **Systeme (5):** WGS84-dezimal, **WGS84-DMS**, UTM, MGRS, **Gauß-Krüger**.
3. **Eingabe-UX:** **Ein Textfeld** im gewählten Format + Format-Umschalter daneben, Live-Validierung der umgerechneten Position.
4. **Umfang:** Komplett in einem Spec — alle (einsatz-gebundenen) Koordinaten-Stellen.
5. **Engine:** **Single-Engine `proj4` + `mgrs`** (UTM/MGRS/GK beidseitig); WGS84-dezimal/DMS handgerollt-symmetrisch. Die Vorwärts-Eigenimpl wird ersetzt.
6. **Umschalter-Zustand:** **global session-sticky** (localStorage) — wirkt konsistent auf Anzeige **und** Eingabe, nicht pro Feld isoliert.
7. **Persistenz bleibt WGS84** — kein DB-/Backend-Konvertierungs-Eingriff.
8. **Außerhalb Scope:** Stammdaten/Verwaltung (einsatzfreie Bereiche); Architektur macht Nachrüsten trivial.

## Architektur

### Grundprinzip: WGS84 ist die einzige Wahrheit

Persistiert wird durchgängig **WGS84-Dezimalgrad** (`lat`/`lon` als `REAL` / `Option<f64>`; MapLibre WGS84-nativ; Kartenklick liefert WGS84). Alle 5 Systeme sind reine **Frontend-Übersetzungen** für Anzeige und Eingabe. Daraus folgt: kein DB-Migrations-Eingriff an Koordinaten-Spalten, keine Backend-Konvertierung, vollständig reversibel.

### Konvertierungs-Kern — `frontend/src/anzeige/koordinaten.ts` (Neufassung)

Zwei symmetrische Funktionen als **einziger Seam**:

```ts
export type Koordinatenformat = 'wgs84' | 'dms' | 'utm' | 'mgrs' | 'gk';

/** WGS84 → Anzeige-String im Zielsystem (vorwärts). */
export function formatiere(lat: number, lon: number, system: Koordinatenformat): string;

/** Anzeige-String → WGS84 (rückwärts). Wirft KoordinatenParseFehler bei ungültigem Input. */
export function parse(text: string, system: Koordinatenformat): { lat: number; lon: number };
```

| System | Engine | Anzeige-Beispiel | Round-Trip |
|---|---|---|---|
| `wgs84` | handgerollt — Default **byte-exakt** `lat.toFixed(5), lon.toFixed(5)` | `51.16040, 10.45140` | exakt |
| `dms` | handgerollt, symmetrisch | `51°09'36"N 010°27'05"E` | exakt (auf Sekunden-Raster) |
| `utm` | **proj4** (EPSG:326xx eingebaut) | `32U 512345 5667890` | sub-meter |
| `mgrs` | **mgrs**-Paket | `32U NB 12345 67890` | Zellzentrum (≤1 m bei accuracy 5) |
| `gk` | **proj4** (EPSG:31466–31469, selbst registriert) | `R 3513084  H 5404959` | ~3 m (Helmert, s. Risiken) |

**Verifizierte Engine-Fakten** (empirisch geprüft mit `proj4@2.20.9` / `mgrs@2.1.0`):

- **Achsenreihenfolge:** proj4 und mgrs arbeiten überall mit **`[lon, lat]`** (x zuerst) bzw. `[Rechtswert/Easting, Hochwert/Northing]`. Häufigste Fehlerquelle — beim Übergeben an/von unserem `{lat, lon}` immer tauschen.
- **UTM:** kein Setup. Zone aus `lon`: `zone = floor((lon+180)/6)+1`; `proj4('EPSG:4326', 'EPSG:326'+zone, [lon, lat])`. Deutschland = Zone 32 (6–12° O) bzw. 33 (12–18° O).
- **Gauß-Krüger:** EPSG:31466–31469 sind in proj4js **nicht** eingebaut → einmalig beim App-Bootstrap registrieren, **zwingend** mit `+towgs84` (sonst stiller ~136-m-Fehler):

  ```ts
  // Muster: Zone n → lon_0 = 3·n, x_0 = n·1_000_000 + 500_000; gleicher towgs84-Satz (EPSG:1777)
  const TOWGS84 = '+towgs84=598.1,73.7,418.2,0.202,0.045,-2.455,6.7';
  proj4.defs('EPSG:31466', `+proj=tmerc +lat_0=0 +lon_0=6  +k=1 +x_0=2500000 +y_0=0 +ellps=bessel ${TOWGS84} +units=m +no_defs`);
  proj4.defs('EPSG:31467', `+proj=tmerc +lat_0=0 +lon_0=9  +k=1 +x_0=3500000 +y_0=0 +ellps=bessel ${TOWGS84} +units=m +no_defs`);
  proj4.defs('EPSG:31468', `+proj=tmerc +lat_0=0 +lon_0=12 +k=1 +x_0=4500000 +y_0=0 +ellps=bessel ${TOWGS84} +units=m +no_defs`);
  proj4.defs('EPSG:31469', `+proj=tmerc +lat_0=0 +lon_0=15 +k=1 +x_0=5500000 +y_0=0 +ellps=bessel ${TOWGS84} +units=m +no_defs`);
  ```

  - **Zonenwahl beim Formatieren:** aus `lon` → `n = round(lon/3)` (3→Zone3 = 9° O usw.).
  - **Zonenwahl beim Parsen:** aus der **führenden Ziffer des Rechtswerts** (`3_500_000` → Zone 3). proj4 liefert/erwartet den **vollen** Rechtswert inkl. führender Million (`+x_0` bildet das ab) — **nichts** abschneiden; nur die richtige Zonen-Def wählen.
- **MGRS:** `forward([lon, lat], 5) → string`; `toPoint(str) → [lon, lat]` (**Zellzentrum**, nicht Ecke); `inverse(str) → [W,S,E,N]`. **Wirft** bei ungültigem Input (kein `null`) → in `try/catch`.
- **DMS:** kein Paket (Kandidaten verwaist) → handgerollt. BOS-Format: Breite **2-stellige** Grad, Länge **3-stellige** Grad (führende Null!), Minuten/Sekunden je 2-stellig, **Hemisphären-Suffix `N/S` bzw. `E/W` statt Vorzeichen** (keine negativen Zahlen). Parsen toleriert die eigene Ausgabe + gängige Tippvarianten.

**Bootstrap:** Ein Modul `frontend/src/anzeige/proj4Setup.ts` registriert die GK-Defs **einmalig auf Modul-Top-Level** (nicht pro Render), importiert von `koordinaten.ts`.

### Typ- & Whitelist-Erweiterung (Frontend + Backend)

- **Frontend:** `frontend/src/api/types.ts:69` — `Koordinatenformat = 'wgs84' | 'mgrs' | 'utm'` → `+ 'dms' | 'gk'`. (Der `koordinaten.ts`-Typ ist identisch; eine Quelle re-exportieren.)
- **Backend:** `KOORDINATENFORMATE`-Whitelist in `src/einsatz/einstellungen.rs` (genutzt von `ist_gueltiges_koordinatenformat`, Zeile 39) um `"dms"`, `"gk"` erweitern. DB-Spalten (`einsatz_einstellungen.koordinatenformat`, `org_einstellungen.koordinatenformat`) sind `TEXT` → **keine Migration**. Bestehende Validierungs-Routen (`routes/org_einstellungen.rs`, Einsatz-Einstellungen) und der Resolver `effektive_koordinatenformat` bleiben unverändert (validieren generisch über die Whitelist).

### Anzeige (2 Bypässe umstellen)

- `format.ts::formatKoordinate(lat, lon, konv)` delegiert künftig an `koordinaten.formatiere(lat, lon, konv.koordinatenformat ?? 'wgs84')`. **WGS84-Default bleibt byte-exakt** (`toFixed(5)`) → Bestandstests grün.
- `EinsatzdatenPage.tsx:232-236` und `LagemeldungenPage.tsx:52-54` auf `useAnzeigeKonventionen().formatKoordinate(...)` umstellen. **Provider-Verfügbarkeit verifizieren** (beide müssen unter dem `EinsatzAnzeigeProvider` liegen — sonst greifen Defaults).
- `Inspector.tsx` bleibt unverändert (nutzt es bereits) und dient als Referenz.
- **Keine** weiteren Anzeige-Stellen: kein Cursor-/Statusleisten-Readout, keine Karten-Popups mit Koordinaten (bewusst geprüft).

### Eingabe-Widget — `frontend/src/anzeige/KoordinatenEingabe.tsx` (neu)

Eine wiederverwendbare, **kontext-agnostische** Komponente:

```ts
interface KoordinatenEingabeProps {
  value: { lat: number; lon: number } | null;
  onChange: (wert: { lat: number; lon: number } | null) => void;
  // Startsystem: explizit ODER aus effektiver Konvention (s. Umschalter)
  status?: 'error' | 'warning';
}
```

- **Layout:** ein Text-`Input` + Format-`Select` daneben; darunter Live-Feedback (`✓ entspricht 51.16040° N, 10.45140° E` oder Fehlerhinweis).
- **WGS84 als interne Wahrheit (Round-Trip-Schutz):** Das Widget hält den letzten gültigen `{lat, lon}` als Quelle. Der angezeigte Text ist davon **abgeleitet**.
  - **Bloßes Umschalten** des Systems → `formatiere(wgs84, neuesSystem)` aus der gespeicherten Wahrheit (kein parse-reformat-Zyklus). So bleibt ein per Kartenklick gesetzter exakter Wert beim Umschalten exakt erhalten.
  - **Editieren** des Texts → `parse(text, system)`; bei Erfolg neuer `{lat,lon}` + `onChange`; bei Fehler **Invalid-State** (roter Rand, Hinweis, `onChange(null)` bzw. Form-Validierungsfehler).
- **Leerer Input** → `onChange(null)` (Koordinate optional, wie heute).
- Ersetzt die je 2×`InputNumber` an **3 Stellen**:
  1. `EinsatzdatenPage.tsx:192-198` (Einsatzort) — **Pilot**.
  2. `meldungen/LagerelevantModal.tsx:68-90` (Meldung verorten; Paar-Validator entfällt — ein Feld liefert beide oder keinen Wert).
  3. `lagekarte/Sidebar.tsx:140-164` (manuelle Platzierung; greift für alle platzierbaren Marker).
- **Karten-Klick** (`Kartenflaeche` → `LagekartePage.onKarteKlick`/`onKoordinateEingeben`) bleibt WGS84 und **füllt das Widget-Feld** im aktuellen Format (Echo). Kein Umbau am Klick-Pfad selbst.

### Umschalter — global session-sticky

Ein gemeinsamer Hook bestimmt das **effektive Eingabe-/Anzeige-System**:

```
effektivesSystem = localStorage-Override ?? Einsatz-Override ?? Org-Default ?? 'wgs84'
```

- `useKoordinatenSystem(): [system, setSystem]` — liest/schreibt einen session-stickyen localStorage-Schlüssel; initialer Fallback = effektive Konvention aus `useAnzeigeKonventionen()`.
- Der `Select` im Eingabe-Widget setzt diesen **globalen** Wert → Umschalten wirkt **sofort und konsistent** auf alle Anzeigen und alle Eingabefelder der Session.
- **Anzeige bindet ebenfalls den Override ein:** `useAnzeigeKonventionen().formatKoordinate` honoriert den localStorage-Override (effektiver Wert), damit „wechseln" auch die Datendarstellung umstellt — nicht nur die Eingabe.

### Konfiguration

`GlobalEinstellungenPage.tsx:29-32` und `EinsatzEinstellungenPage.tsx:54-57` — `KOORDINATEN_OPTIONEN` um zwei Einträge erweitern: `{ value: 'dms', label: 'WGS84 (Grad/Min/Sek)' }`, `{ value: 'gk', label: 'Gauß-Krüger' }`.

## Datenfluss (Eingabe, Beispiel MGRS)

1. Anwender tippt `32U NB 12345 67890` im Widget (System = MGRS aus globalem Override).
2. `parse(text, 'mgrs')` → `mgrs.toPoint('32UNB...')` → `[lon, lat]` → `{lat, lon}` (WGS84).
3. Live-Feedback `✓ entspricht …`; `onChange({lat, lon})` → Form-Wert (WGS84).
4. Submit → bestehende API (`einsatzort_lat/lon`, PATCH-Routen) **unverändert** (WGS84).
5. Re-Anzeige → `formatKoordinate` (effektives System) formatiert die persistierten WGS84-Werte zurück.

## Fehlerbehandlung

- proj4/mgrs **werfen** → `parse` kapselt in `try/catch`, wirft typisierten `KoordinatenParseFehler`; Widget fängt → Invalid-State.
- DMS-/WGS84-Parse: eigene Validierung (Wertebereiche lat ∈ [-90,90], lon ∈ [-180,180]).
- Ungültiger/leerer Konventionswert → Fallback `'wgs84'` (defensiv, analog `inZone`-Muster in `format.ts`).
- Bestehende **Backend**-Validierung bleibt; **Hinweis (nicht Scope):** der Einsatzort ist die einzige Geo-Entität *ohne* Paar-/Range-Check im Backend (`routes/einsatz.rs`), `meldung.rs` prüft nur Paar. Separater Härtungs-Task.

## Scope-Abgrenzung (bewusst außerhalb)

- **Backend / DB / Persistenz** — bleibt WGS84.
- **Stammdaten/Verwaltung** (einsatzfreie Bereiche) — *bestätigt außerhalb Scope*. Da Kern-Komponenten kontext-agnostisch sind (System als Prop/Resolver), ist Nachrüsten ein Org-Fallback-Einzeiler.
- **terra-draw Polygone/Linien** (Abschnittsflächen, Zonen-Geometrie) — Flächengeometrie, keine Punkt-Koordinaten.
- **Cursor-/Karten-Koordinaten-Readout** — existiert heute nicht; falls je ergänzt, über `formatKoordinate`.
- **Backend-Validierungs-Asymmetrie** — separater Task.

## Teststrategie

- **Konvertierung (`koordinaten.test.ts`):** je System **Round-Trip** `parse(formatiere(p)) ≈ p` (Toleranz: WGS84/DMS exakt, UTM/GK < 0,01 m, MGRS < 1 m bei accuracy 5) mit Referenzpunkten (Mitte DE, Zone-32/33-Grenze, GK Zone 2–5). Bekannte Festwerte (Stuttgart `9.177/48.782` → GK3 `3513083.51, 5404959.49`). `parse` wirft bei Müll/leerem/außerbereichigem Input.
- **format.ts:** WGS84-Default bleibt **byte-identisch** (Bestands-Snapshots grün); dms/gk neu abgedeckt.
- **Widget (`KoordinatenEingabe.test.tsx`):** Umschalten reformatiert ohne Wertdrift; Editieren parst; Invalid-State bei Müll; leeres Feld → `onChange(null)`; Kartenklick-Echo.
- **Integration:** je eine umgestellte Anzeige- (EinsatzdatenPage) und Eingabestelle.
- Gate: `pnpm test --no-file-parallelism` (Suite unter Last sonst flaky); Frontend ist ins Binary eingebettet → für manuelle Prüfung `pnpm build` + Backend-Neustart.

## Sequenzierung

1. **Fundament:** `proj4` + `mgrs` als Deps; `proj4Setup.ts` (GK-Defs); Typ-/Whitelist-Erweiterung FE+BE (`dms`, `gk`).
2. **Konvertierungs-Kern:** `koordinaten.ts` neu (`formatiere`/`parse`, alle 5) + Round-Trip-Tests. Eigenimpl `wgs84ZuUtm/Mgrs` entfernt, abhängige Tests nachgezogen.
3. **Anzeige:** `format.ts` delegiert; 2 Bypässe umgestellt.
4. **Umschalter:** `useKoordinatenSystem` (localStorage-Override) + Einbindung in Anzeige-Konvention.
5. **Eingabe-Widget:** `KoordinatenEingabe` + Tests.
6. **Ausrollen:** Pilot `EinsatzdatenPage` → `LagerelevantModal` → `Sidebar`; Kartenklick-Echo.
7. **Konfig:** beide `KOORDINATEN_OPTIONEN` erweitert.

## Risiken & bewusste Grenzen

- **GK-Genauigkeit ~3 m** (7-Parameter-Helmert EPSG:1777, **kein** NTv2-Grid). Für taktische Lagekarten ausreichend, **nicht** für Kataster/Vermessung. Im `koordinaten.ts`-Header dokumentieren (Stil der bestehenden „bewusste Grenzen"-Notiz). cm-Genauigkeit ginge via BeTA2007-NTv2-Grid (`proj4.nadgrid`) — bewusst nicht.
- **Stiller GK-Datum-Skip:** niemals blanke epsg.io-Def ohne `+towgs84` übernehmen (~136 m Fehler ohne Fehlermeldung).
- **MGRS-Zellzentrum:** Eingabe per MGRS und Re-Anzeige verschiebt eine ursprünglich exakte (Kartenklick-)Position aufs Zellzentrum (≤ ~0,7 m bei accuracy 5). Vernachlässigbar; der WGS84-Wahrheits-Mechanismus im Widget verhindert Drift beim bloßen Umschalten.
- **Bundle:** proj4 und mgrs sind beide kompakt (mgrs ohne Runtime-Deps, eigene Typen); konkrete Bundle-Auswirkung im Fundament-Schritt prüfen. Kehrt die bewusste „dependency-frei"-Entscheidung aus LFH-136 um — bewusst, weil GK von Hand fahrlässig wäre und Single-Engine Round-Trip-Konsistenz garantiert.

## Betroffene Dateien

| Datei | Änderung |
|---|---|
| `frontend/package.json` | + `proj4`, `mgrs` (+ Typen sind im Paket) |
| `frontend/src/anzeige/proj4Setup.ts` | **neu** — GK-Defs einmalig registrieren |
| `frontend/src/anzeige/koordinaten.ts` | **Neufassung** — `formatiere`/`parse`, 5 Systeme, beidseitig |
| `frontend/src/anzeige/format.ts` | `formatKoordinate` delegiert; dms/gk |
| `frontend/src/anzeige/AnzeigeKonventionenContext.tsx` | localStorage-Override in Effektivwert einbeziehen |
| `frontend/src/anzeige/KoordinatenEingabe.tsx` | **neu** — Eingabe-Widget + Umschalter |
| `frontend/src/anzeige/useKoordinatenSystem.ts` | **neu** — session-sticky Override |
| `frontend/src/api/types.ts` | `Koordinatenformat` + `dms`/`gk` |
| `frontend/src/pages/EinsatzdatenPage.tsx` | Anzeige (232) + Eingabe (192) umstellen |
| `frontend/src/pages/LagemeldungenPage.tsx` | Anzeige (52) umstellen |
| `frontend/src/meldungen/LagerelevantModal.tsx` | Eingabe (68-90) umstellen |
| `frontend/src/pages/lagekarte/Sidebar.tsx` | Eingabe (140-164) umstellen |
| `frontend/src/pages/GlobalEinstellungenPage.tsx` | `KOORDINATEN_OPTIONEN` (29) |
| `frontend/src/pages/EinsatzEinstellungenPage.tsx` | `KOORDINATEN_OPTIONEN` (54) |
| `src/einsatz/einstellungen.rs` | `KOORDINATENFORMATE`-Whitelist + `dms`/`gk` |
