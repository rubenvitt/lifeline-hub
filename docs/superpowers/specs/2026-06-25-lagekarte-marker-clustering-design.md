# LFH-173 — Lagekarte: dezentes Clustering bei vielen Markern

- **Datum:** 2026-06-25
- **Status:** Design freigegeben
- **Branch:** `feat/lfh-173-lagekarte-marker-clustering`
- **Task:** [LFH-173](https://app.clickup.com/t/86cae0f7m) (Epic [LFH-56](https://app.clickup.com/t/86ca33mdd))

## Kontext

Zweite, in der LFH-27-Spec als „optional/folgend" markierte Hälfte; aus LFH-27 herausgelöst.
Marker werden heute als einzelne `maplibregl.Marker`-DOM-Elemente gerendert
(`Kartenflaeche.tsx:259-289`): bei `mk.tz` ein `<img>` mit der DV-102-DataURL (optional umrahmt
vom FMS-Status-Ring), sonst ein CSS-Kreis (Lagemeldung). Jeder Marker trägt einen eigenen
Klick-Handler → `onMarkerKlick(schluessel)`. DOM-Marker leben außerhalb des WebGL-Layer-Raums
und lassen sich daher **nicht** über die GeoJSON-`cluster`-Mechanik von MapLibre bündeln — genau
der „Konflikt", den die Task zu klären verlangt.

Dieses Design migriert das Marker-Rendering vollständig in den **GeoJSON-/WebGL-Layer-Raum**
(taktische Zeichen als Karten-Icons via `addImage`, Status-Ring/Lagemeldung als Circle-Layer)
und aktiviert darauf das native, selbstauflösende Clustering.

## Ziel & Akzeptanzkriterien

- Bei vielen Markern wird **dezent geclustert**; die Einzel-Marker-Funktion
  (Klick → Inspector/Deeplink, FMS-Status, taktisches Zeichen) **bleibt erhalten**.
- `Kartenflaeche` bleibt die **einzige** MapLibre-Stelle (kein WebGL-Import außerhalb).

## Scope-Entscheidung

Bewusst gewählt (priority-low; die LFH-27-Spec hält Clustering bei den heutigen Marker-Zahlen für
„wenig wert"):

- **Volle GeoJSON-Migration** statt Hybrid (DOM-Marker für Einzelpunkte). Begründung: vermeidet
  zwei parallele Render-Pfade und ein Viewport-Resync der DOM-Marker; alles lebt im Layer-Raum,
  `Kartenflaeche` bleibt sauber die einzige MapLibre-Stelle.
- **Selbstauflösendes Clustering** (`cluster:true`, kleiner `clusterRadius`) statt globalem
  Schwellwert. Bei Gedränge bilden sich Cluster, beim Reinzoomen lösen sie sich automatisch auf;
  bei wenigen Markern entstehen praktisch keine. „Dezent" ergibt sich ohne Sonderfall-Code.
- **Einsatzort (id:0) wird nie geclustert** — eigene ungeclusterte Source, immer als Einzelsymbol
  sichtbar.
- **Cluster-Klick zoomt rein** (`getClusterExpansionZoom`). Das **Auffächern (Spiderfy)** wird
  bewusst **ausgegliedert** — es ist von keinem Akzeptanzkriterium verlangt (selbstauflösendes
  Clustering erfüllt „Einzel-Marker-Funktion bleibt erhalten" bereits durchs Reinzoomen) und der
  Eigenbau wäre der größte Einzelaufwand. Siehe „Nicht in diesem Task".

## Architektur

Minimaler Eingriff dem bestehenden Muster folgend. **Kein Backend, keine Migration, keine neuen
DB-Felder** — alle Daten (`KarteMarker[]`) liegen bereits an der `markers`-Prop vor.

Leitbild ist `kartenLayer.ts` (Abschnitte/Zonen): pure, jsdom-testbare Daten-/Layer-Builder mit
nur `import type` von maplibre-gl (kein WebGL-Laufzeitimport), die `Kartenflaeche` über
`wendeKartenDatenAn` einspielt und in die Re-Anlage nach `setStyle` einhängt.

### Neue Datei `frontend/src/pages/lagekarte/markerLayer.ts` (pure, getestet)

- `baueMarkerFc(markers: KarteMarker[]): FeatureCollection` — alle Marker **außer**
  `typ === 'einsatzort'`. Jedes Feature: `Point`-Geometrie + Properties
  `{ schluessel, typ, label, farbe, icon?, statusFarbe? }`.
  - `icon` = `tzIconKey(mk.tz)` für TZ-Marker; **fehlt** bei Lagemeldung (kein `tz`).
  - `statusFarbe` nur bei Fahrzeugen mit gesetztem Status.
- `baueEinsatzortFc(markers: KarteMarker[]): FeatureCollection` — genau der
  `typ === 'einsatzort'`-Marker (0 oder 1 Feature) für die ungeclusterte Source.
- `sorgeFuerMarkerLayer(map, ...)` — **idempotent** (Style-Wechsel entfernt Sources/Layer):
  - Source `marker-cluster` (`type:'geojson'`, `cluster:true`, `clusterRadius:45`,
    `clusterMaxZoom:14`).
  - Source `marker-einsatzort` (ohne `cluster`).
  - Layer (Reihenfolge = Mal-Reihenfolge, von unten):
    - `marker-status-ring` (circle) — Filter `['all',['!',['has','point_count']],['has','statusFarbe']]`;
      `circle-color:['get','statusFarbe']`, etwas größerer Radius als das Symbol → erscheint als Ring.
    - `marker-kreis` (circle) — Filter `['all',['!',['has','point_count']],['!',['has','icon']]]`
      (= Lagemeldung); `circle-color:['get','farbe']`, weißer Rand (heutige Kreis-Optik).
    - `marker-symbol` (symbol) — Filter `['all',['!',['has','point_count']],['has','icon']]`;
      `icon-image:['get','icon']`, `icon-allow-overlap:true`.
    - `cluster-bubble` (circle) — Filter `['has','point_count']`; dezent (gedämpfte Füllung,
      Radius gestuft per `step`-Expression über `point_count`).
    - `cluster-count` (symbol) — Filter `['has','point_count']`;
      `text-field:['get','point_count_abbreviated']`.
    - `einsatzort-symbol` (symbol, Source `marker-einsatzort`) — `icon-image:['get','icon']`,
      `icon-allow-overlap:true`.

### Neue Datei `frontend/src/pages/lagekarte/markerIcons.ts` (pure Key-Ableitung, getestet)

- `tzIconKey(tz: TzProps): string` — deterministischer, eindeutiger Key über die relevanten
  TzProps-Felder (`grundzeichen|organisation|fachaufgabe|einheit|symbol|farbe`). Gleicher TZ →
  gleicher Key (ein Icon mehrfach genutzt); unterschiedlicher TZ → unterschiedlicher Key.

### `frontend/src/pages/lagekarte/Kartenflaeche.tsx`

- Der DOM-Marker-Effekt (`:259-289`) und `markerObjekteRef` **entfallen**. Stattdessen ein Effekt,
  der aus `markers` per `baueMarkerFc`/`baueEinsatzortFc` die FeatureCollections baut und sie über
  `wendeKartenDatenAn` in die Sources spielt (`sorgeFuerMarkerLayer` + `setData`).
- **TZ-Icons lazy via `styleimagemissing`:** `map.on('styleimagemissing', e => …)`. Der Effekt
  pflegt eine `Map<iconKey, TzProps>`-Registry (beim FC-Bau befüllt). Der Handler schlägt
  `e.id` → `TzProps` nach, rendert `erzeugeTaktischesZeichen(tz).dataUrl`, lädt es in ein
  `Image` und ruft `map.addImage(e.id, img, { pixelRatio })` mit der `size` aus dem `Image`.
  **Race-Guard:** ein `inFlight: Set<string>` + `map.hasImage(e.id)`-Check verhindern das doppelte
  `addImage` (sonst wirft MapLibre „image already exists", weil das Event während des async-Loads
  mehrfach feuern kann). MapLibre re-rendert das Symbol automatisch, sobald das Bild vorliegt.
- **Klick/Inspector:** Layer-Klick auf `marker-symbol` / `marker-kreis` / `einsatzort-symbol` →
  `feature.properties.schluessel` → `onMarkerKlick(schluessel)` (Schnittstelle unverändert;
  `markerToUrl` und die Page bleiben gleich). Klick auf `cluster-bubble` →
  `getClusterExpansionZoom(clusterId)` → `easeTo(center, zoom)`.
- **Cursor:** `mouseenter`/`mouseleave` auf den Marker-/Cluster-Layern setzt `cursor:'pointer'`
  (ersetzt das heutige `el.style.cursor`). Hover-`title`-Tooltip: optionaler Popup-Handler auf
  `marker-symbol`/-`kreis` mit `feature.properties.label` (kleine, bewusste Beibehaltung der
  heutigen `el.title`-Funktion; siehe „Offene Detailpunkte").
- **Re-Anlage nach `setStyle`:** Marker-Sources/Layer in `reAnlegenAlles`/`planeReAnlegenNachStyle`
  (`kartenLayer.ts`) einhängen — analog Abschnitte/Zonen. Icons brauchen kein explizites
  Re-Add: `styleimagemissing` greift beim ersten Re-Render nach dem Style-Wechsel erneut.

### `frontend/src/pages/LagekartePage.tsx`

- **Keine Änderung.** `markers={sichtbareMarker}` + `onMarkerKlick` bleiben; der Einsatzort wird
  intern in `markerLayer.ts` per `typ` herausgetrennt.

## Datenfluss

```
LagekartePage  (unverändert: markers: KarteMarker[], onMarkerKlick)
  → <Kartenflaeche markers=… onMarkerKlick=… />
      → baueMarkerFc(markers)      → Source 'marker-cluster' (cluster:true)   // markerLayer.ts (pure)
      → baueEinsatzortFc(markers)  → Source 'marker-einsatzort'               // markerLayer.ts (pure)
      → sorgeFuerMarkerLayer(map)  → circle/symbol-Layer (idempotent)
      → on 'styleimagemissing'     → tzIconKey → erzeugeTaktischesZeichen → addImage  (lazy, guarded)
      → on 'click' marker-symbol/-kreis/einsatzort-symbol → onMarkerKlick(schluessel)
      → on 'click' cluster-bubble  → getClusterExpansionZoom → easeTo
```

## Tests (TDD)

Unit-testbar (jsdom, ohne WebGL — neue/erweiterte Suiten):

- **`markerLayer.test.ts`** (neu): `baueMarkerFc` nimmt den Einsatzort aus; Properties
  (`schluessel/typ/farbe`) korrekt; TZ-Marker tragen `icon`, Lagemeldung **nicht**; Fahrzeuge mit
  Status tragen `statusFarbe`. `baueEinsatzortFc` liefert genau den Einsatzort (bzw. leer).
- **`markerIcons.test.ts`** (neu): `tzIconKey` ist deterministisch (gleicher TZ → gleicher Key)
  und unterscheidet sich für abweichende TzProps (inkl. `farbe`/`einheit`/`symbol`).
- **`kartenLayer.test.ts`** (erweitert): Marker-Sources/Layer werden in der Re-Anlage-Sequenz nach
  `setStyle` (`reAnlegenAlles`) mit angelegt.

**Nicht** jsdom-/unit-testbar (WebGL-Laufzeit): das tatsächliche Clustering, Icon-Loading via
`styleimagemissing`, Klick-Routing über Layer-Events, Cluster-Klick-Zoom. Diese hängen am
**visuellen Smoke-Test** (s. u.). Grüne Unit-Tests bedeuten hier **nicht** „Feature verifiziert".

Page-Tests (`LagekartePage.test.tsx`) bleiben grün: `Kartenflaeche` ist dort gemockt, der Mock
prüft nur die `markers`-Prop + `onMarkerKlick` (beide unverändert). Es gibt bewusst keinen
`Kartenflaeche.test.tsx` (WebGL).

## Verifikation jenseits der Unit-Tests

- `pnpm lint` (`--max-warnings 0`), `tsc --noEmit` (Typecheck-Gate), Vitest der lagekarte-Suite
  (`--no-file-parallelism`).
- **Visueller Smoke-Test** im echten App-Bundle (rust-embed → `pnpm build` + Backend-Neustart;
  jsdom rendert kein WebGL):
  - Bei vielen nahen Markern bildet sich eine dezente Cluster-Bubble; Reinzoomen löst sie auf.
  - Cluster-Klick zoomt auf den Auflösungs-Zoom.
  - Einzel-Marker zeigen ihr taktisches Zeichen; Fahrzeuge den FMS-Status-Ring; Lagemeldungen den
    Kreis. Klick öffnet den Inspector/Deeplink wie bisher.
  - Der Einsatzort bleibt immer sichtbar (nie in einer Bubble).
  - Basemap-/Theme-Wechsel (`setStyle`) lässt Marker + Icons zurückkommen.

## Offene Detailpunkte (im Smoke-Test feinjustieren)

- `clusterRadius`/`clusterMaxZoom` und die Cluster-Bubble-Optik (gedämpfte Farbe, `step`-Stufung)
  sind Startwerte und werden visuell nachgezogen.
- `pixelRatio`/Zielgröße der TZ-Icons für scharfe Darstellung.
- Hover-`title`: heute trägt jeder DOM-Marker `el.title`. Im Layer-Ansatz als optionaler
  Popup-/Tooltip-Handler nachgezogen, sonst entfällt der Hover-Text (bewusste, kleine UX-Notiz).

## Nicht in diesem Task (Folge-Task)

- **Spiderfy (Auffächern beim Cluster-Klick):** Eigenbau (Kreis-/Spiral-Anordnung der
  `getClusterLeaves`, Beinchen-Layer, Einklappen bei Move/Zoom/Klick/ESC **und bei Live-Daten-
  Änderung** via SSE/Query-Invalidation, eigenes Klick-Routing). Von keinem Akzeptanzkriterium
  verlangt; als eigener Folge-Task [LFH-175](https://app.clickup.com/t/86cae4nzn) auf dem
  Entwicklungsboard geführt.
