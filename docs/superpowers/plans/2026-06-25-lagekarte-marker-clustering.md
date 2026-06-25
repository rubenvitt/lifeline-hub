# Lagekarte Marker-Clustering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Das Lagekarten-Marker-Rendering von einzelnen `maplibregl.Marker`-DOM-Elementen auf GeoJSON-/WebGL-Layer migrieren und darauf natives, selbstauflösendes Clustering aktivieren.

**Architecture:** Pure, jsdom-testbare Daten-/Layer-Builder in neuen Modulen `markerIcons.ts` (`tzIconKey`) und `markerLayer.ts` (FeatureCollection-Builder + idempotente Layer-Anlage), nach dem bestehenden `kartenLayer.ts`-Muster. `Kartenflaeche.tsx` spielt die Daten über `wendeKartenDatenAn` ein, lädt taktische Zeichen lazy als Karten-Icons via `styleimagemissing` und hängt die Marker in die `planeReAnlegenNachStyle`-Sequenz ein. Taktische Zeichen werden Symbol-Icons, FMS-Status-Ring und Lagemeldung werden Circle-Layer. Der Einsatzort liegt in einer eigenen, ungeclusterten Source.

**Tech Stack:** React 19, TypeScript, maplibre-gl 5.24, taktische-zeichen-react 0.10, Vitest 4 (jsdom), pnpm 11 (via mise).

## Global Constraints

- `pnpm lint` läuft mit `--max-warnings 0` — Warnings brechen das Gate (keine pauschalen `eslint-disable`).
- Typecheck ist ein eigenes Gate: `tsc --noEmit`. Frontend `tsconfig` zielt auf **ES2020** — keine ES2022-APIs (`.at()`, `.findLast()`, `Object.hasOwn`).
- `Kartenflaeche` bleibt die **einzige** Stelle mit MapLibre-Laufzeitimport. Alle anderen Module nur `import type` von `maplibre-gl`.
- Vitest-Gate der lagekarte-Suite mit `--no-file-parallelism` (Suite sonst flaky unter Last).
- Befehle laufen über mise: `mise exec node pnpm@11.0.9 -- pnpm …` mit absoluten `-C`/cwd-Pfaden im Worktree.
- Commits referenzieren `LFH-173` im Body; Spiderfy ist **nicht** Teil dieses Plans (→ LFH-175).
- Keine Page-Änderung: `Kartenflaeche`-Props (`markers: KarteMarker[]`, `onMarkerKlick`) bleiben unverändert.

**Worktree-Pfad (cwd für alle Befehle):**
`/Users/rubeen/dev/personal/lifeline-hub/.claude/worktrees/feat+lfh-173-lagekarte-marker-clustering/frontend`

**Test-Abkürzung** (im Plan als `VITEST` referenziert):
`mise exec node pnpm@11.0.9 -- pnpm exec vitest run <pfad> --no-file-parallelism`

---

### Task 1: `markerIcons.ts` — Icon-Key-Ableitung (pure)

**Files:**
- Create: `frontend/src/pages/lagekarte/markerIcons.ts`
- Test: `frontend/src/pages/lagekarte/markerIcons.test.ts`

**Interfaces:**
- Consumes: `TzProps` aus `./taktischesZeichen`
- Produces: `tzIconKey(tz: TzProps): string` — deterministischer, eindeutiger MapLibre-Image-Key; Präfix `tz|`. Gleicher TZ → gleicher Key (Icon-Wiederverwendung); abweichende Felder → abweichender Key.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { tzIconKey } from './markerIcons';

describe('tzIconKey', () => {
  it('ist deterministisch für gleiche TzProps', () => {
    expect(tzIconKey({ grundzeichen: 'anlass' })).toBe(tzIconKey({ grundzeichen: 'anlass' }));
  });

  it('beginnt mit dem tz|-Präfix (für den styleimagemissing-Filter)', () => {
    expect(tzIconKey({ grundzeichen: 'anlass' }).startsWith('tz|')).toBe(true);
  });

  it('unterscheidet sich bei abweichender farbe', () => {
    expect(tzIconKey({ grundzeichen: 'gefahr', farbe: '#f5222d' }))
      .not.toBe(tzIconKey({ grundzeichen: 'gefahr', farbe: '#faad14' }));
  });

  it('unterscheidet sich bei symbol/fachaufgabe/organisation/einheit', () => {
    const base = { grundzeichen: 'stelle' } as const;
    expect(tzIconKey({ ...base, symbol: 'sammeln' }))
      .not.toBe(tzIconKey({ ...base, symbol: 'sammelplatz-betroffene' }));
    expect(tzIconKey({ ...base, fachaufgabe: 'fuehrung' })).not.toBe(tzIconKey(base));
    expect(tzIconKey({ grundzeichen: 'taktische-formation', einheit: 'zug' }))
      .not.toBe(tzIconKey({ grundzeichen: 'taktische-formation', einheit: 'gruppe' }));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `VITEST src/pages/lagekarte/markerIcons.test.ts`
Expected: FAIL — `tzIconKey` not exported / module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
import type { TzProps } from './taktischesZeichen';

/**
 * Deterministischer, eindeutiger MapLibre-Image-Key für ein taktisches Zeichen.
 * Gleicher TZ → gleicher Key (Icon wird genau einmal registriert und mehrfach genutzt).
 * Das `tz|`-Präfix erlaubt dem `styleimagemissing`-Handler, fremde Image-IDs zu ignorieren.
 */
export function tzIconKey(tz: TzProps): string {
  return [
    'tz',
    tz.grundzeichen ?? '',
    tz.organisation ?? '',
    tz.fachaufgabe ?? '',
    tz.einheit ?? '',
    tz.symbol ?? '',
    tz.farbe ?? '',
  ].join('|');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `VITEST src/pages/lagekarte/markerIcons.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/lagekarte/markerIcons.ts frontend/src/pages/lagekarte/markerIcons.test.ts
git commit -m "feat(lfh-173): tzIconKey — deterministischer Image-Key für taktische Zeichen"
```

---

### Task 2: `markerLayer.ts` — FeatureCollection-Builder (pure)

**Files:**
- Create: `frontend/src/pages/lagekarte/markerLayer.ts`
- Test: `frontend/src/pages/lagekarte/markerLayer.test.ts`

**Interfaces:**
- Consumes: `KarteMarker` aus `./marker`; `tzIconKey` aus `./markerIcons`
- Produces:
  - `interface MarkerProps { schluessel: string; typ: string; label: string; farbe: string; icon?: string; statusFarbe?: string }`
  - `type MarkerFeature = { type: 'Feature'; properties: MarkerProps; geometry: { type: 'Point'; coordinates: [number, number] } }`
  - `type MarkerFeatureCollection = { type: 'FeatureCollection'; features: MarkerFeature[] }`
  - `baueMarkerFc(markers: KarteMarker[]): MarkerFeatureCollection` — alle Marker **außer** `typ === 'einsatzort'`
  - `baueEinsatzortFc(markers: KarteMarker[]): MarkerFeatureCollection` — genau der Einsatzort (0/1 Feature)

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { baueMarkerFc, baueEinsatzortFc } from './markerLayer';
import type { KarteMarker } from './marker';

const mk = (p: Partial<KarteMarker>): KarteMarker => ({
  schluessel: 'x', typ: 'uhs', id: 1, lat: 50, lon: 8, label: 'X', farbe: '#000', ...p,
});

describe('baueMarkerFc', () => {
  it('nimmt den Einsatzort aus (wird separat, ungeclustert gerendert)', () => {
    const fc = baueMarkerFc([
      mk({ schluessel: 'einsatzort', typ: 'einsatzort' }),
      mk({ schluessel: 'uhs-5' }),
    ]);
    expect(fc.features.map((f) => f.properties.schluessel)).toEqual(['uhs-5']);
  });

  it('setzt icon für TZ-Marker und statusFarbe für Fahrzeuge', () => {
    const fc = baueMarkerFc([mk({
      schluessel: 'fahrzeug-1', typ: 'fahrzeug',
      tz: { grundzeichen: 'kraftfahrzeug-landgebunden' }, statusFarbe: '#00ff00',
    })]);
    expect(fc.features[0].properties.icon?.startsWith('tz|')).toBe(true);
    expect(fc.features[0].properties.statusFarbe).toBe('#00ff00');
  });

  it('lässt icon bei Lagemeldung (kein tz) weg → wird als Kreis gerendert', () => {
    const fc = baueMarkerFc([mk({ schluessel: 'lagemeldung-4', typ: 'lagemeldung' })]);
    expect(fc.features[0].properties.icon).toBeUndefined();
    expect(fc.features[0].properties.statusFarbe).toBeUndefined();
  });

  it('schreibt Point-Geometrie als [lon, lat]', () => {
    const fc = baueMarkerFc([mk({ lon: 8.6, lat: 50.1 })]);
    expect(fc.features[0].geometry).toEqual({ type: 'Point', coordinates: [8.6, 50.1] });
  });

  it('behält Reihenfolge und propagiert die Schaden-Farbe in die Properties', () => {
    const fc = baueMarkerFc([
      mk({ schluessel: 'uhs-5' }),
      mk({ schluessel: 'schaden-9', typ: 'schaden', farbe: '#f5222d', tz: { grundzeichen: 'gefahr', farbe: '#f5222d' } }),
    ]);
    expect(fc.features.map((f) => f.properties.schluessel)).toEqual(['uhs-5', 'schaden-9']);
    expect(fc.features[1].properties.farbe).toBe('#f5222d');
  });
});

describe('baueEinsatzortFc', () => {
  it('liefert genau den Einsatzort-Marker', () => {
    const fc = baueEinsatzortFc([
      mk({ schluessel: 'einsatzort', typ: 'einsatzort', tz: { grundzeichen: 'anlass' } }),
      mk({ schluessel: 'uhs-5' }),
    ]);
    expect(fc.features.map((f) => f.properties.schluessel)).toEqual(['einsatzort']);
    expect(fc.features[0].properties.icon?.startsWith('tz|')).toBe(true);
  });

  it('ist leer, wenn kein Einsatzort verortet ist', () => {
    expect(baueEinsatzortFc([mk({ schluessel: 'uhs-5' })]).features).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `VITEST src/pages/lagekarte/markerLayer.test.ts`
Expected: FAIL — builders not exported.

- [ ] **Step 3: Write minimal implementation**

```ts
import type { KarteMarker } from './marker';
import { tzIconKey } from './markerIcons';

export interface MarkerProps {
  schluessel: string;
  typ: string;
  label: string;
  farbe: string;
  icon?: string;
  statusFarbe?: string;
}

export type MarkerFeature = {
  type: 'Feature';
  properties: MarkerProps;
  geometry: { type: 'Point'; coordinates: [number, number] };
};

export type MarkerFeatureCollection = {
  type: 'FeatureCollection';
  features: MarkerFeature[];
};

function toFeature(mk: KarteMarker): MarkerFeature {
  const properties: MarkerProps = {
    schluessel: mk.schluessel, typ: mk.typ, label: mk.label, farbe: mk.farbe,
  };
  if (mk.tz) properties.icon = tzIconKey(mk.tz);
  if (mk.statusFarbe) properties.statusFarbe = mk.statusFarbe;
  return { type: 'Feature', properties, geometry: { type: 'Point', coordinates: [mk.lon, mk.lat] } };
}

/** Clusterbare Marker (alle außer dem Einsatzort) als FeatureCollection. */
export function baueMarkerFc(markers: KarteMarker[]): MarkerFeatureCollection {
  return {
    type: 'FeatureCollection',
    features: markers.filter((m) => m.typ !== 'einsatzort').map(toFeature),
  };
}

/** Der Einsatzort-Marker (0 oder 1 Feature) für die eigene, ungeclusterte Source. */
export function baueEinsatzortFc(markers: KarteMarker[]): MarkerFeatureCollection {
  return {
    type: 'FeatureCollection',
    features: markers.filter((m) => m.typ === 'einsatzort').map(toFeature),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `VITEST src/pages/lagekarte/markerLayer.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/lagekarte/markerLayer.ts frontend/src/pages/lagekarte/markerLayer.test.ts
git commit -m "feat(lfh-173): baueMarkerFc/baueEinsatzortFc — Marker als GeoJSON-FeatureCollection"
```

---

### Task 3: `markerLayer.ts` — idempotente Layer-Anlage + Re-Anlage

**Files:**
- Modify: `frontend/src/pages/lagekarte/markerLayer.ts` (anhängen)
- Test: `frontend/src/pages/lagekarte/markerLayer.test.ts` (anhängen)

**Interfaces:**
- Consumes: `Map as MapLibreMap`, `GeoJSONSource` (nur `import type`) aus `maplibre-gl`; die FC-Typen aus Task 2
- Produces:
  - `sorgeFuerMarkerLayer(map: MapLibreMap, marker: MarkerFeatureCollection, einsatzort: MarkerFeatureCollection): void` — idempotent
  - `reAnlegenMarker(map: MapLibreMap, marker: MarkerFeatureCollection, einsatzort: MarkerFeatureCollection): void` — Anlage + `setData`
  - Source-IDs (Konstanten, exportiert für Klick-Handler/Tests): `MARKER_CLUSTER_QUELLE = 'marker-cluster'`, `MARKER_EINSATZORT_QUELLE = 'marker-einsatzort'`
  - Klickbare Layer-IDs (exportiert): `MARKER_KLICK_LAYER = ['marker-symbol', 'marker-kreis', 'marker-status-ring', 'marker-einsatzort-symbol']` (Status-Ring ist klickbar wie früher der DOM-Border-Annulus), `CLUSTER_LAYER = 'marker-cluster-bubble'`

- [ ] **Step 1: Write the failing test** (anhängen an `markerLayer.test.ts`)

```ts
import { vi } from 'vitest';
import {
  sorgeFuerMarkerLayer, reAnlegenMarker,
  MARKER_CLUSTER_QUELLE, MARKER_EINSATZORT_QUELLE,
} from './markerLayer';

function fakeMap() {
  const sources = new Map<string, { spec: unknown; setData: ReturnType<typeof vi.fn> }>();
  const layers = new Map<string, unknown>();
  const moves: string[] = [];
  const map = {
    getSource: vi.fn((id: string) => sources.get(id)),
    addSource: vi.fn((id: string, spec: unknown) => { sources.set(id, { spec, setData: vi.fn() }); }),
    getLayer: vi.fn((id: string) => layers.get(id)),
    addLayer: vi.fn((spec: { id: string }) => { layers.set(spec.id, spec); }),
    moveLayer: vi.fn((id: string) => { moves.push(id); }),
  };
  return { map, sources, layers, moves };
}

const leer = { type: 'FeatureCollection' as const, features: [] };

describe('sorgeFuerMarkerLayer', () => {
  it('legt die Cluster-Source mit cluster:true an', () => {
    const { map, sources } = fakeMap();
    sorgeFuerMarkerLayer(map as never, leer, leer);
    expect((sources.get(MARKER_CLUSTER_QUELLE)!.spec as { cluster: boolean }).cluster).toBe(true);
    expect(sources.has(MARKER_EINSATZORT_QUELLE)).toBe(true);
  });

  it('legt alle Marker- und Cluster-Layer an', () => {
    const { map, layers } = fakeMap();
    sorgeFuerMarkerLayer(map as never, leer, leer);
    for (const id of [
      'marker-status-ring', 'marker-kreis', 'marker-symbol',
      'marker-cluster-bubble', 'marker-cluster-count', 'marker-einsatzort-symbol',
    ]) {
      expect(layers.has(id)).toBe(true);
    }
  });

  it('ist idempotent (zweiter Aufruf legt nichts doppelt an)', () => {
    const { map } = fakeMap();
    sorgeFuerMarkerLayer(map as never, leer, leer);
    const addSourceCalls = map.addSource.mock.calls.length;
    sorgeFuerMarkerLayer(map as never, leer, leer);
    expect(map.addSource.mock.calls.length).toBe(addSourceCalls);
  });

  it('trennt clusterbare Marker per Filter von Cluster-Bubbles (Negation nicht gate-blind)', () => {
    const { map, layers } = fakeMap();
    sorgeFuerMarkerLayer(map as never, leer, leer);
    const symbol = layers.get('marker-symbol') as { filter: unknown };
    const bubble = layers.get('marker-cluster-bubble') as { filter: unknown };
    // Der Symbol-Layer MUSS Cluster ausschließen (Negation '!'); der Bubble-Layer NICHT.
    // (Nur `toContain('point_count')` wäre für beide Filter wahr → gate-blind.)
    expect(JSON.stringify(symbol.filter)).toContain('"!"');
    expect(JSON.stringify(bubble.filter)).not.toContain('"!"');
    expect(symbol.filter).not.toEqual(bubble.filter);
  });

  it('pinnt die Marker-Layer nach oben (über Abschnitten/Zonen/Bildern)', () => {
    const { map, moves } = fakeMap();
    sorgeFuerMarkerLayer(map as never, leer, leer);
    // Jeder Marker-Layer wird per moveLayer (ohne beforeId) ans Ende = nach oben geschoben,
    // in Mal-Reihenfolge (Status-Ring unten … Einsatzort-Symbol oben).
    expect(moves).toEqual([
      'marker-status-ring', 'marker-kreis', 'marker-symbol',
      'marker-cluster-bubble', 'marker-cluster-count', 'marker-einsatzort-symbol',
    ]);
  });
});

describe('reAnlegenMarker', () => {
  it('legt an und spielt die (nicht-leeren) Daten unverändert in beide Sources ein', () => {
    const { map, sources } = fakeMap();
    const marker = baueMarkerFc([mk({ schluessel: 'uhs-5' }), mk({ schluessel: 'schaden-9', typ: 'schaden' })]);
    const einsatzort = baueEinsatzortFc([mk({ schluessel: 'einsatzort', typ: 'einsatzort' })]);
    reAnlegenMarker(map as never, marker, einsatzort);
    expect(sources.get(MARKER_CLUSTER_QUELLE)!.setData).toHaveBeenCalledWith(marker);
    expect(sources.get(MARKER_EINSATZORT_QUELLE)!.setData).toHaveBeenCalledWith(einsatzort);
    expect(marker.features).toHaveLength(2); // Daten unverändert durchgereicht
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `VITEST src/pages/lagekarte/markerLayer.test.ts`
Expected: FAIL — `sorgeFuerMarkerLayer`/`reAnlegenMarker`/Konstanten not exported.

- [ ] **Step 3: Write minimal implementation** (anhängen an `markerLayer.ts`)

```ts
import type { Map as MapLibreMap, GeoJSONSource } from 'maplibre-gl';

export const MARKER_CLUSTER_QUELLE = 'marker-cluster';
export const MARKER_EINSATZORT_QUELLE = 'marker-einsatzort';
export const MARKER_KLICK_LAYER = ['marker-symbol', 'marker-kreis', 'marker-status-ring', 'marker-einsatzort-symbol'] as const;
export const CLUSTER_LAYER = 'marker-cluster-bubble';

/**
 * Idempotent: Sources (Cluster + ungeclusterter Einsatzort) und circle/symbol-Layer für
 * Marker + Clustering. Style-Wechsel entfernt Sources/Layer → bei der Re-Anlage erneut aufrufen.
 * Layer-Reihenfolge (Mal-Reihenfolge von unten): Status-Ring, Kreis (Lagemeldung), TZ-Symbol,
 * Cluster-Bubble, Cluster-Zahl, Einsatzort-Symbol.
 */
export function sorgeFuerMarkerLayer(
  map: MapLibreMap,
  marker: MarkerFeatureCollection,
  einsatzort: MarkerFeatureCollection,
) {
  if (!map.getSource(MARKER_CLUSTER_QUELLE)) {
    map.addSource(MARKER_CLUSTER_QUELLE, {
      type: 'geojson', data: marker as never, cluster: true, clusterRadius: 45, clusterMaxZoom: 14,
    });
  }
  if (!map.getSource(MARKER_EINSATZORT_QUELLE)) {
    map.addSource(MARKER_EINSATZORT_QUELLE, { type: 'geojson', data: einsatzort as never });
  }
  // FMS-Status-Ring (nur Fahrzeuge mit Status) — Kreis HINTER dem Symbol, der über dessen Rand
  // hinausragt → erscheint als farbiger Ring. radius:20 (=40px Durchmesser) > die in Kartenflaeche
  // auf ≤34px normierte Symbolgröße (ZIEL_PX), analog zum früheren 3px-DOM-Border. statusFarbe
  // tragen ausschließlich Fahrzeuge (konstantes TZ) → ein fester Radius genügt.
  if (!map.getLayer('marker-status-ring')) {
    map.addLayer({
      id: 'marker-status-ring', type: 'circle', source: MARKER_CLUSTER_QUELLE,
      filter: ['all', ['!', ['has', 'point_count']], ['has', 'statusFarbe']],
      paint: { 'circle-radius': 20, 'circle-color': ['get', 'statusFarbe'], 'circle-opacity': 0.9 },
    });
  }
  // Lagemeldung (kein TZ) — einfacher Kreis (heutige Optik: farbig, weißer Rand).
  if (!map.getLayer('marker-kreis')) {
    map.addLayer({
      id: 'marker-kreis', type: 'circle', source: MARKER_CLUSTER_QUELLE,
      filter: ['all', ['!', ['has', 'point_count']], ['!', ['has', 'icon']]],
      paint: {
        'circle-radius': 9, 'circle-color': ['get', 'farbe'],
        'circle-stroke-color': '#fff', 'circle-stroke-width': 2,
      },
    });
  }
  // TZ-Marker — Symbol mit lazy via styleimagemissing geladenem Icon.
  if (!map.getLayer('marker-symbol')) {
    map.addLayer({
      id: 'marker-symbol', type: 'symbol', source: MARKER_CLUSTER_QUELLE,
      filter: ['all', ['!', ['has', 'point_count']], ['has', 'icon']],
      layout: { 'icon-image': ['get', 'icon'], 'icon-size': 1, 'icon-allow-overlap': true },
    });
  }
  // Cluster-Bubble (dezent), Radius gestuft nach point_count.
  if (!map.getLayer('marker-cluster-bubble')) {
    map.addLayer({
      id: 'marker-cluster-bubble', type: 'circle', source: MARKER_CLUSTER_QUELLE,
      filter: ['has', 'point_count'],
      paint: {
        'circle-color': '#1f4e79', 'circle-opacity': 0.85,
        'circle-stroke-color': '#ffffff', 'circle-stroke-width': 1.5,
        'circle-radius': ['step', ['get', 'point_count'], 14, 10, 18, 50, 24],
      },
    });
  }
  if (!map.getLayer('marker-cluster-count')) {
    map.addLayer({
      id: 'marker-cluster-count', type: 'symbol', source: MARKER_CLUSTER_QUELLE,
      filter: ['has', 'point_count'],
      layout: { 'text-field': ['get', 'point_count_abbreviated'], 'text-size': 12 },
      paint: { 'text-color': '#ffffff' },
    });
  }
  // Einsatzort (eigene, ungeclusterte Source) — immer als Einzelsymbol sichtbar.
  if (!map.getLayer('marker-einsatzort-symbol')) {
    map.addLayer({
      id: 'marker-einsatzort-symbol', type: 'symbol', source: MARKER_EINSATZORT_QUELLE,
      layout: { 'icon-image': ['get', 'icon'], 'icon-size': 1, 'icon-allow-overlap': true },
    });
  }
  // Marker-Layer verlässlich nach oben pinnen (über Abschnitten/Zonen/Bildern). Die render-Poller
  // der anderen Daten-Layer racen beim Mount mit dem Marker-Poller; ohne explizites Pinnen könnten
  // Marker unter den Flächen landen (DOM-Marker lagen früher immer über dem Canvas). moveLayer ohne
  // beforeId schiebt ans Ende = oben; die Reihenfolge erhält die Mal-Reihenfolge (Ring unten … Einsatzort oben).
  for (const id of [
    'marker-status-ring', 'marker-kreis', 'marker-symbol',
    'marker-cluster-bubble', 'marker-cluster-count', 'marker-einsatzort-symbol',
  ]) {
    if (map.getLayer(id)) map.moveLayer(id);
  }
}

/** Marker-Sources + Layer idempotent anlegen UND die aktuellen Daten einspielen (setData). */
export function reAnlegenMarker(
  map: MapLibreMap,
  marker: MarkerFeatureCollection,
  einsatzort: MarkerFeatureCollection,
) {
  sorgeFuerMarkerLayer(map, marker, einsatzort);
  (map.getSource(MARKER_CLUSTER_QUELLE) as GeoJSONSource | undefined)?.setData(marker as never);
  (map.getSource(MARKER_EINSATZORT_QUELLE) as GeoJSONSource | undefined)?.setData(einsatzort as never);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `VITEST src/pages/lagekarte/markerLayer.test.ts`
Expected: PASS (11 tests gesamt).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/lagekarte/markerLayer.ts frontend/src/pages/lagekarte/markerLayer.test.ts
git commit -m "feat(lfh-173): sorgeFuerMarkerLayer — Cluster-Source + circle/symbol-Layer"
```

---

### Task 4: `kartenLayer.ts` — Marker in die setStyle-Re-Anlage einhängen

**Files:**
- Modify: `frontend/src/pages/lagekarte/kartenLayer.ts:150-189` (`reAnlegenAlles`, `planeReAnlegenNachStyle`)
- Test: `frontend/src/pages/lagekarte/kartenLayer.test.ts` (anhängen)

**Interfaces:**
- Consumes: `reAnlegenMarker`, `MarkerFeatureCollection`, `MARKER_CLUSTER_QUELLE` aus `./markerLayer`
- Produces (erweiterte Signaturen — neue Parameter optional, abwärtskompatibel):
  - `reAnlegenAlles(map, flaechen, zonen, fachebenen?, bilder?, marker?, einsatzort?)`
  - `planeReAnlegenNachStyle(map, getFlaechen, getZonen, getFachebenen?, getBilder?, getMarker?, getEinsatzort?)`

- [ ] **Step 1: Write the failing test** (anhängen an `kartenLayer.test.ts`)

```ts
import { reAnlegenAlles as reAnlegenAllesMitMarker } from './kartenLayer';
import { MARKER_CLUSTER_QUELLE } from './markerLayer';

describe('reAnlegenAlles — Marker', () => {
  it('legt die Marker-Cluster-Source mit an, wenn Marker-Daten übergeben werden', () => {
    const { map } = fakeMap(() => true);
    const marker = { type: 'FeatureCollection' as const, features: [] };
    const einsatzort = { type: 'FeatureCollection' as const, features: [] };
    reAnlegenAllesMitMarker(map, leereFlaechen, leereZonen, [], [], marker as never, einsatzort as never);
    expect(map.getSource(MARKER_CLUSTER_QUELLE)).toBeTruthy();
  });

  it('lässt Marker weg, wenn keine Marker-Daten übergeben werden (abwärtskompatibel)', () => {
    const { map } = fakeMap(() => true);
    reAnlegenAllesMitMarker(map, leereFlaechen, leereZonen);
    expect(map.getSource(MARKER_CLUSTER_QUELLE)).toBeFalsy();
  });
});

describe('planeReAnlegenNachStyle — Marker', () => {
  it('legt Marker beim ersten geladenen Frame mit an', () => {
    let geladen = false;
    const { map } = fakeMap(() => geladen);
    const marker = { type: 'FeatureCollection' as const, features: [] };
    const einsatzort = { type: 'FeatureCollection' as const, features: [] };
    planeReAnlegenNachStyle(
      map, () => leereFlaechen, () => leereZonen, () => [], () => [],
      () => marker as never, () => einsatzort as never,
    );
    geladen = true;
    map.feuere('render');
    expect(map.getSource(MARKER_CLUSTER_QUELLE)).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `VITEST src/pages/lagekarte/kartenLayer.test.ts`
Expected: Genau der erste neue Test ("legt die Marker-Cluster-Source mit an") ist ROT (Source fehlt, weil `reAnlegenAlles` die Marker-Args noch ignoriert). Der Abwärtskompatibilitäts-Test ("lässt Marker weg") ist bereits GRÜN (Regressionswächter — zusätzliche Funktionsargumente sind in TS zur Laufzeit kein Fehler). Der `planeReAnlegenNachStyle`-Marker-Test ist ebenfalls ROT.

- [ ] **Step 3: Write minimal implementation**

In `kartenLayer.ts` oben ergänzen:

```ts
import { reAnlegenMarker, type MarkerFeatureCollection } from './markerLayer';
```

`reAnlegenAlles` erweitern (neue optionale Parameter ans Ende; Marker zuletzt = oberste Layer):

```ts
export function reAnlegenAlles(
  map: MapLibreMap,
  flaechen: FlaechenFeatureCollection,
  zonen: ZonenFeatureCollection,
  fachebenen: AktiveFachebene[] = [],
  bilder: BildOverlay[] = [],
  marker?: MarkerFeatureCollection,
  einsatzort?: MarkerFeatureCollection,
) {
  synchronisiereBildLayer(map, bilder);
  sorgeFuerAbschnittLayer(map, flaechen);
  (map.getSource('abschnitte') as GeoJSONSource | undefined)?.setData(flaechen as never);
  sorgeFuerZonenLayer(map, zonen);
  (map.getSource('zonen') as GeoJSONSource | undefined)?.setData(zonen as never);
  for (const fe of fachebenen) {
    sorgeFuerFachebeneLayer(map, fe.def, fe.daten);
    setzeFachebeneDaten(map, fe.def.key, fe.daten);
  }
  if (marker && einsatzort) reAnlegenMarker(map, marker, einsatzort);
}
```

`planeReAnlegenNachStyle` erweitern:

```ts
export function planeReAnlegenNachStyle(
  map: Pick<MapLibreMap, 'isStyleLoaded' | 'on' | 'off'> & MapLibreMap,
  getFlaechen: () => FlaechenFeatureCollection,
  getZonen: () => ZonenFeatureCollection,
  getFachebenen: () => AktiveFachebene[] = () => [],
  getBilder: () => BildOverlay[] = () => [],
  getMarker?: () => MarkerFeatureCollection,
  getEinsatzort?: () => MarkerFeatureCollection,
) {
  wendeKartenDatenAn(map, () => reAnlegenAlles(
    map, getFlaechen(), getZonen(), getFachebenen(), getBilder(),
    getMarker?.(), getEinsatzort?.(),
  ));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `VITEST src/pages/lagekarte/kartenLayer.test.ts`
Expected: PASS (bestehende + neue Tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/lagekarte/kartenLayer.ts frontend/src/pages/lagekarte/kartenLayer.test.ts
git commit -m "feat(lfh-173): Marker in die setStyle-Re-Anlage-Sequenz einhängen"
```

---

### Task 5: `Kartenflaeche.tsx` — Marker-Rendering auf Layer umstellen (WebGL-Integration)

**Files:**
- Modify: `frontend/src/pages/lagekarte/Kartenflaeche.tsx` (DOM-Marker-Effekt `:259-289` **entfernen**; `markerObjekteRef` entfernen; neuen Marker-Effekt als **letzten** Daten-Effekt einsetzen; `styleimagemissing` im Init-Effekt; Klick-/Cursor-Effekt; setStyle-Effekt `:207-220` um Marker erweitern; Import von `erzeugeTaktischesZeichen` bleibt)

**Interfaces:**
- Consumes: `baueMarkerFc`, `baueEinsatzortFc`, `reAnlegenMarker`, `MARKER_CLUSTER_QUELLE`, `MARKER_KLICK_LAYER`, `CLUSTER_LAYER`, `type MarkerFeatureCollection` aus `./markerLayer`; `erzeugeTaktischesZeichen` aus `taktische-zeichen-react`; `type TzProps` aus `./taktischesZeichen`; `type GeoJSONSource` aus `maplibre-gl`
- Produces: keine neuen Exporte. Props (`markers`, `onMarkerKlick`) unverändert.

**Hinweis:** Kein Unit-Test (WebGL läuft in jsdom nicht). Gate = `tsc --noEmit` + `pnpm lint` + Vitest-Gesamtlauf grün (besonders `LagekartePage.test.tsx`, die `Kartenflaeche` mockt) + visueller Smoke-Test (Task 6). Schritte sind als Implementierungsblöcke statt Test-Zyklen formuliert.

- [ ] **Step 1: Refs + Imports ergänzen**

Importe oben ergänzen:

```ts
import type { GeoJSONSource } from 'maplibre-gl';
import {
  baueMarkerFc, baueEinsatzortFc, reAnlegenMarker,
  MARKER_CLUSTER_QUELLE, MARKER_KLICK_LAYER, CLUSTER_LAYER,
  type MarkerFeatureCollection,
} from './markerLayer';
import { tzIconKey } from './markerIcons';
import type { TzProps } from './taktischesZeichen';
```

`markerObjekteRef` (Zeile 109) **entfernen**. Stattdessen Refs ergänzen (bei den anderen Daten-Refs):

```ts
// Aktuelle Marker-Daten; nach setStyle re-angelegt (analog flaechenDatenRef).
const markerDatenRef = useRef<MarkerFeatureCollection>({ type: 'FeatureCollection', features: [] });
const einsatzortDatenRef = useRef<MarkerFeatureCollection>({ type: 'FeatureCollection', features: [] });
// Image-Key → TzProps; der styleimagemissing-Handler erzeugt daraus lazy die Karten-Icons.
const tzRegistryRef = useRef<Map<string, TzProps>>(new Map());
```

- [ ] **Step 2: `styleimagemissing`-Handler im Init-Effekt registrieren (lazy Icons, Race-guarded)**

Im Karten-Init-Effekt (`useEffect` ab `:165`), nach `map.on('load', …)`, ergänzen:

```ts
    // Taktische Zeichen lazy als Karten-Icons: MapLibre meldet fehlende icon-image-IDs,
    // wir rendern das TZ on-demand und registrieren es. Race-Guard, weil das Event
    // während des async Bild-Ladens mehrfach für dieselbe ID feuern kann.
    const ladendeIcons = new Set<string>();
    map.on('styleimagemissing', (e) => {
      const id = e.id;
      if (!id.startsWith('tz|')) return;             // fremde IDs ignorieren
      if (map.hasImage(id) || ladendeIcons.has(id)) return;
      const tz = tzRegistryRef.current.get(id);
      if (!tz) return;
      ladendeIcons.add(id);
      const { dataUrl, size } = erzeugeTaktischesZeichen(tz);
      const img = new Image(size[0], size[1]);
      img.onload = () => {
        // Auf einheitliche Marker-Größe normieren: pixelRatio so, dass die größere Symboldimension
        // ~ZIEL_PX wird (TZ-SVGs haben je Grundzeichen abweichende `size`). Erst dadurch deckt der
        // feste Status-Ring-Radius (markerLayer.ts, radius:20=40px) das Symbol verlässlich ab.
        const ZIEL_PX = 34;
        const pixelRatio = Math.max(size[0], size[1]) / ZIEL_PX;
        if (!map.hasImage(id)) map.addImage(id, img, { pixelRatio });
        ladendeIcons.delete(id);
      };
      img.onerror = () => { ladendeIcons.delete(id); };
      img.src = dataUrl;
    });
```

- [ ] **Step 3: DOM-Marker-Effekt (`:259-289`) entfernen und Marker-Layer-Effekt als LETZTEN Daten-Effekt registrieren**

**Wichtig (Layer-Reihenfolge):** Den alten DOM-Marker-`useEffect` (`:259-289`) ersatzlos löschen und den neuen Marker-Effekt NICHT an dessen Stelle setzen, sondern als LETZTEN der vertagenden Daten-Effekte — also NACH dem Bild-Overlay-Effekt (`:383`). Begründung: Beim Mount vertagen alle Daten-Effekte (Abschnitte/Zonen/Fachebenen/Bilder/Marker) über `wendeKartenDatenAn`; die render-Poller feuern in Registrierungsreihenfolge (durch `kartenLayer.test.ts` bestätigt). Als letzter registriert, legt der Marker-Poller seine Layer zuletzt an → über den Flächen. Zusätzlich pinnt `sorgeFuerMarkerLayer` die Marker-Layer per `moveLayer` nach oben (Gürtel und Hosenträger; deckt auch den setStyle-Pfad und spätere Layer-Anlagen ab).

```ts
  // Marker als GeoJSON-Layer rendern + Clustering. Ersetzt das frühere DOM-Marker-Rendering.
  // ALS LETZTER Daten-Effekt registriert (nach dem Bild-Effekt) → Marker-Layer liegen oben.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const marker = baueMarkerFc(markers);
    const einsatzort = baueEinsatzortFc(markers);
    markerDatenRef.current = marker;
    einsatzortDatenRef.current = einsatzort;
    // Registry für styleimagemissing füllen (Key → TzProps). tzIconKey ist die EINE Quelle der
    // Key-Bildung (identisch zu dem Key, den baueMarkerFc ins icon-Property schreibt) → DRY.
    const registry = new Map<string, TzProps>();
    for (const mk of markers) {
      if (mk.tz) registry.set(tzIconKey(mk.tz), mk.tz);
    }
    tzRegistryRef.current = registry;
    wendeKartenDatenAn(map, () => reAnlegenMarker(map, markerDatenRef.current, einsatzortDatenRef.current));
  }, [markers]);
```

- [ ] **Step 4: Klick- und Cursor-Handler verdrahten (eigener Effekt)**

Neuer Effekt (z. B. nach dem Marker-Effekt). `onMarkerKlick` als Dependency:

```ts
  // Marker-/Cluster-Klick + Cursor. Marker-Klick → Inspector; Cluster-Klick → reinzoomen.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const klickMarker = (e: maplibregl.MapLayerMouseEvent) => {
      const schluessel = e.features?.[0]?.properties?.schluessel;
      if (typeof schluessel === 'string') onMarkerKlick?.(schluessel);
    };
    const klickCluster = (e: maplibregl.MapLayerMouseEvent) => {
      const f = e.features?.[0];
      const clusterId = f?.properties?.cluster_id;
      if (clusterId == null) return;
      const src = map.getSource(MARKER_CLUSTER_QUELLE) as GeoJSONSource | undefined;
      if (!src) return;
      src.getClusterExpansionZoom(clusterId as number).then((zoom) => {
        const coords = (f!.geometry as GeoJSON.Point).coordinates as [number, number];
        map.easeTo({ center: coords, zoom });
      }).catch(() => { /* Cluster verschwunden (Daten-Update) → ignorieren */ });
    };
    const enter = () => { map.getCanvas().style.cursor = 'pointer'; };
    const leave = () => { map.getCanvas().style.cursor = ''; };
    for (const id of MARKER_KLICK_LAYER) {
      map.on('click', id, klickMarker);
      map.on('mouseenter', id, enter);
      map.on('mouseleave', id, leave);
    }
    map.on('click', CLUSTER_LAYER, klickCluster);
    map.on('mouseenter', CLUSTER_LAYER, enter);
    map.on('mouseleave', CLUSTER_LAYER, leave);
    return () => {
      for (const id of MARKER_KLICK_LAYER) {
        map.off('click', id, klickMarker);
        map.off('mouseenter', id, enter);
        map.off('mouseleave', id, leave);
      }
      map.off('click', CLUSTER_LAYER, klickCluster);
      map.off('mouseenter', CLUSTER_LAYER, enter);
      map.off('mouseleave', CLUSTER_LAYER, leave);
    };
  }, [onMarkerKlick]);
```

- [ ] **Step 5: setStyle-Re-Anlage um Marker erweitern (`:207-220`)**

Im `[style]`-Effekt den `planeReAnlegenNachStyle`-Aufruf um die Marker-Getter ergänzen:

```ts
    planeReAnlegenNachStyle(
      map,
      () => flaechenDatenRef.current,
      () => zonenDatenRef.current,
      () => fachebenenRef.current,
      () => bilderRef.current,
      () => markerDatenRef.current,
      () => einsatzortDatenRef.current,
    );
```

- [ ] **Step 6: Gates — Typecheck, Lint, volle Vitest-Suite**

```bash
mise exec node pnpm@11.0.9 -- pnpm exec tsc --noEmit
mise exec node pnpm@11.0.9 -- pnpm exec eslint . --max-warnings 0
mise exec node pnpm@11.0.9 -- pnpm exec vitest run --no-file-parallelism
```
Expected: tsc 0 Fehler; eslint 0 Warnungen; alle Tests grün (inkl. `LagekartePage.test.tsx`).

- [ ] **Step 7: Commit**

```bash
git add frontend/src/pages/lagekarte/Kartenflaeche.tsx
git commit -m "feat(lfh-173): Marker-Rendering von DOM-Markern auf GeoJSON-Layer + Clustering"
```

---

### Task 6: Visueller Smoke-Test + Politur

**Files:**
- Modify (nur bei Bedarf nach Sichtprüfung): `frontend/src/pages/lagekarte/markerLayer.ts` (clusterRadius/clusterMaxZoom, Bubble-Optik, Status-Ring-Radius), `Kartenflaeche.tsx` (`ZIEL_PX`-Normgröße)

**Hinweis:** Reiner Verifikations-/Politur-Task ohne Unit-Test (WebGL). Frontend ist via rust-embed ins Backend-Binary eingebettet → echtes Bundle bauen und Backend neu starten.

- [ ] **Step 1: Frontend bauen**

```bash
mise exec node pnpm@11.0.9 -- pnpm -C <frontend-abs> build
```

- [ ] **Step 2: Backend mit eingebettetem Bundle starten** (eigenes Terminal; Admin-Passwort für frische DB)

```bash
cargo run -- --admin-password e2e-admin-pw
```

- [ ] **Step 3: Lagekarte mit vielen nahen Markern öffnen und prüfen**

- Bei Gedränge bildet sich eine dezente Cluster-Bubble mit Zahl; Reinzoomen löst sie auf.
- Klick auf eine Cluster-Bubble zoomt auf den Auflösungs-Zoom.
- Einzel-Marker zeigen ihr taktisches Zeichen scharf; Fahrzeuge den FMS-Status-Ring; Lagemeldungen den Kreis.
- Klick auf einen Einzel-Marker öffnet den Inspector/Deeplink wie zuvor; Cursor wird zur Hand.
- Der Einsatzort bleibt immer sichtbar (nie in einer Bubble).
- Basemap-/Theme-Wechsel: Marker + Icons kommen zurück.

- [ ] **Step 4: Politur einarbeiten (falls nötig)**

Falls Marker zu groß/klein: `ZIEL_PX` (Step 2 in Task 5) justieren; ändert sich die Symbolgröße deutlich, den Status-Ring-`circle-radius` in `sorgeFuerMarkerLayer` nachziehen (muss > halbe Symbolbreite bleiben). Falls Clustering zu aggressiv/zu schwach oder Bubbles zu auffällig: `clusterRadius`/`clusterMaxZoom`/Bubble-`paint` in `sorgeFuerMarkerLayer` justieren. Nach Änderung Gates aus Task 5 Step 6 erneut laufen lassen.

- [ ] **Step 5: Commit (falls Politur nötig war)**

```bash
git add frontend/src/pages/lagekarte/markerLayer.ts frontend/src/pages/lagekarte/Kartenflaeche.tsx
git commit -m "fix(lfh-173): Clustering-/Icon-Politur nach Smoke-Test"
```

---

## Self-Review

**Spec coverage:**
- GeoJSON-Migration + Clustering → Tasks 2–5. ✓
- Einsatzort nie geclustert (eigene Source) → Task 3 (`marker-einsatzort`), Task 2 (`baueEinsatzortFc`), Task 5 (Rendering). ✓
- TZ als Karten-Icons (addImage via styleimagemissing, Race-Guard) → Task 5 Step 2. ✓
- FMS-Status-Ring + Lagemeldung-Kreis als Circle-Layer → Task 3. ✓
- Klick/Inspector erhalten (schluessel → onMarkerKlick, markerToUrl unverändert) → Task 5 Step 4. ✓
- Cluster-Klick zoomt rein (getClusterExpansionZoom) → Task 5 Step 4. ✓
- setStyle-Re-Anlage → Task 4 + Task 5 Step 5. ✓
- Kartenflaeche bleibt einzige MapLibre-Stelle (andere Module nur import type) → Tasks 1–4. ✓
- Keine Page-Änderung → Constraints + Task 5 (Props unverändert). ✓
- Cursor/Tooltip-Notiz → Task 5 Step 4 (Cursor); Hover-`title` bewusst entfallen (Spec „Offene Detailpunkte"). ✓
- Spiderfy ausgegliedert → nicht im Plan (LFH-175). ✓

**Placeholder scan:** Keine TBDs. Task 5/6 sind bewusst als Implementierungs-/Verifikationsblöcke statt Test-Zyklen formuliert (WebGL nicht jsdom-testbar) — mit konkretem Code bzw. konkreten Prüfpunkten.

**Type consistency:** `MarkerFeatureCollection`/`MarkerProps`/`MarkerFeature` durchgängig (Tasks 2–5). Source-IDs (`MARKER_CLUSTER_QUELLE`/`MARKER_EINSATZORT_QUELLE`) und Layer-Listen (`MARKER_KLICK_LAYER`/`CLUSTER_LAYER`) als Konstanten aus `markerLayer.ts` in Task 5 wiederverwendet (keine String-Duplikate). `tzIconKey` aus Task 1 wird in Task 2 und Task 5 (Registry) genutzt — in Task 5 als Import, nicht inline.

**Härtung (Multi-Agent-Review gegen Code + MapLibre-v5-API):** eingearbeitete Findings —
- *Layer-Reihenfolge (Mount-Race):* Marker-Effekt als letzter Daten-Effekt + `moveLayer`-Pinning in `sorgeFuerMarkerLayer` (Task 3 + Task 5 Step 3) → Marker garantiert über Abschnitten/Zonen/Bildern.
- *FMS-Status-Ring sichtbar:* einheitliche Symbolgröße via `ZIEL_PX`-normiertem `pixelRatio` (Task 5 Step 2) + fester Ring-`radius:20` (Task 3) — strukturell verankert, nicht erst Politur.
- *Gate-blinder Filter-Test:* Task 3 prüft jetzt die Negation (`'!'` im Symbol-Filter, nicht im Bubble-Filter), nicht nur `toContain('point_count')`.
- *Klick-Parität:* `marker-status-ring` ist klickbar (Ring-Annulus öffnet den Marker wie früher der DOM-Border).
- *Test-Abdeckung:* mehrere Marker (Reihenfolge), Schaden-Farb-Propagation, `reAnlegenMarker` mit nicht-leerer FC, `moveLayer`-Pinning.
- *react-race-Lens (Workflow-Stufe gecrasht, manuell nachgeholt):* Registry-Timing (synchron im Effekt vor dem vertagten setData) ok; `exhaustive-deps` der drei Effekte ok; `styleimagemissing`-Handler braucht keinen eigenen Cleanup, da `map.remove()` im Init-Cleanup alles abräumt (auch StrictMode-Remount).
