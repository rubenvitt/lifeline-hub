# LFH-175 — Lagekarte: Spiderfy (Auffächern beim Cluster-Klick) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Klick auf eine Cluster-Donut-Bubble fächert die enthaltenen Marker als voll funktionale Einzelsymbole auf (statt nur reinzuzoomen); zuverlässiges Einklappen inkl. bei Live-Daten-Änderung.

**Architecture:** Pure, jsdom-getestete Anordnungs-/FC-Bau-Funktionen (`spiderfy.ts`); die aufgefächerten Symbole + Beinchen leben als eigene **WebGL-Layer** auf zwei ungeclusterten Sources (`spider-leaves`, `spider-legs`) und **wiederverwenden die Single-Marker-Paint-Configs + den bestehenden `styleimagemissing`/`tzIconKey`-Icon-Pfad** (kein DOM-Render-Duplikat dessen, was LFH-173 entfernt hat). Der gesamte Lebenszyklus (Öffnen via `getClusterLeaves`, Einklappen, Klick-Routing, Race-Guard) wird in `Kartenflaeche.tsx` orchestriert — die einzige MapLibre-Stelle.

**Tech Stack:** React 19, MapLibre GL `^5.24.0` (`getClusterLeaves`/`getClusterExpansionZoom` async), TypeScript, Vitest 4 (jsdom 29).

## Global Constraints

- `Kartenflaeche.tsx` bleibt die **einzige** Stelle mit MapLibre-Laufzeitimport. Alle neuen Module (`spiderfy.ts`) und `markerLayer.ts` nutzen ausschließlich `import type` von `maplibre-gl`.
- `pnpm lint` läuft mit `--max-warnings 0` — Warnings brechen das Gate. `eslint-disable` nur zeilengenau + begründet (siehe CLAUDE.md). Bestehende `react-hooks/exhaustive-deps`-Disables für die `[]`-Setup-Effekte mit `mapRef`-Zugriff sind das etablierte Muster.
- Typecheck ist ein **eigenes Gate**: `tsc --noEmit`. `tsconfig` lib = ES2020 → keine ES2022-APIs (`.at()`, `.findLast()`, `Object.hasOwn`).
- Vitest-Gate für die Suite: `pnpm exec vitest run src/pages/lagekarte --no-file-parallelism` (volle Suite ist unter Last flaky).
- pnpm läuft über mise: `mise exec pnpm@11.0.9 -- pnpm -C <abs-pfad> …` bzw. `cd <frontend-abs> && mise exec pnpm@11.0.9 -- pnpm exec …`. Pass/Fail-Gates über `rtk proxy <cmd>` (der rtk-Hook maskiert sonst Exit-Codes).
- **Großcluster (entschieden):** Spiderfy nur bei `point_count ≤ SPIDER_CAP` (= **12**). Darüber: Fallback auf das heutige Verhalten `getClusterExpansionZoom` → `easeTo` (Reinzoomen verkleinert die Cluster, dann erneut auffächerbar).
- Frontend ist via rust-embed ins Binary eingebettet → der visuelle Smoke-Test braucht `pnpm build` + Backend-Neustart.

**Arbeitsverzeichnis (Worktree):** `/Users/rubeen/dev/personal/lifeline-hub/.claude/worktrees/feat+lfh-175-lagekarte-spiderfy` auf Branch `worktree-feat+lfh-175-lagekarte-spiderfy` (re-baselined auf lokales `main` mit LFH-173). Frontend-Root: `<worktree>/frontend`.

---

## File Structure

| Datei | Verantwortung | Aktion |
|---|---|---|
| `frontend/src/pages/lagekarte/spiderfy.ts` | Pure Anordnung (`spiderfyOffsets`) + projektor-injizierter FC-Bau (`baueSpiderFc`) + Konstanten (`SPIDER_CAP`) | Create |
| `frontend/src/pages/lagekarte/spiderfy.test.ts` | Unit-Tests für beide pure Funktionen | Create |
| `frontend/src/pages/lagekarte/markerLayer.ts` | Spider-Sources/Layer (idempotent), geteilte Paint-Configs, `setzeSpiderDaten`, Pin-Reihenfolge, `SPIDER_KLICK_LAYER` | Modify |
| `frontend/src/pages/lagekarte/markerLayer.test.ts` | Spider-Layer-Anlage, Pin-Order, `setzeSpiderDaten` | Modify |
| `frontend/src/pages/lagekarte/Kartenflaeche.tsx` | Spider-Controller (Öffnen/Einklappen/Trigger/Race-Guard), Donut-Klick→Spider, Leaf-Klick-Routing | Modify |

---

## Task 1: Pure Anordnungs-Funktion `spiderfyOffsets`

**Files:**
- Create: `frontend/src/pages/lagekarte/spiderfy.ts`
- Test: `frontend/src/pages/lagekarte/spiderfy.test.ts`

**Interfaces:**
- Produces:
  - `interface SpiderOffset { x: number; y: number }`
  - `function spiderfyOffsets(count: number): SpiderOffset[]` — Pixel-Offsets relativ zum Cluster-Mittelpunkt. `count ≤ 9` → Kreis, sonst Archimedische Spirale. Mindestabstand benachbarter Symbole ≥ Icon-Größe.
  - `const SPIDER_CAP = 12`
  - `const SPIDER_LEAF_ABSTAND = 40` (Pixel; Icon-Zielgröße ist 34px, +Puffer)

- [ ] **Step 1: Failing test schreiben**

`frontend/src/pages/lagekarte/spiderfy.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { spiderfyOffsets, SPIDER_LEAF_ABSTAND } from './spiderfy';

// kleinster paarweiser Abstand über alle Offset-Paare
function minAbstand(offs: { x: number; y: number }[]): number {
  let min = Infinity;
  for (let i = 0; i < offs.length; i++) {
    for (let j = i + 1; j < offs.length; j++) {
      const d = Math.hypot(offs[i].x - offs[j].x, offs[i].y - offs[j].y);
      if (d < min) min = d;
    }
  }
  return min;
}

describe('spiderfyOffsets', () => {
  it('liefert keine Offsets für 0 und genau einen (vom Anker abgesetzten) für 1', () => {
    expect(spiderfyOffsets(0)).toEqual([]);
    const eins = spiderfyOffsets(1);
    expect(eins).toHaveLength(1);
    expect(Math.hypot(eins[0].x, eins[0].y)).toBeGreaterThanOrEqual(SPIDER_LEAF_ABSTAND - 0.001);
  });

  it('Kreis bis 9: count stimmt, alle auf gleichem Radius, kein Overlap (≥ Icon-Größe)', () => {
    for (const n of [2, 5, 9]) {
      const offs = spiderfyOffsets(n);
      expect(offs).toHaveLength(n);
      const radien = offs.map((o) => Math.hypot(o.x, o.y));
      const r0 = radien[0];
      for (const r of radien) expect(Math.abs(r - r0)).toBeLessThan(0.001); // exakter Kreis
      expect(minAbstand(offs)).toBeGreaterThanOrEqual(34);
    }
  });

  it('ab 10: Spirale — count stimmt, kein Overlap (≥ Icon-Größe), Radius wächst', () => {
    const offs = spiderfyOffsets(20);
    expect(offs).toHaveLength(20);
    expect(minAbstand(offs)).toBeGreaterThanOrEqual(34);
    const radien = offs.map((o) => Math.hypot(o.x, o.y));
    expect(radien[radien.length - 1]).toBeGreaterThan(radien[0]); // nach außen wachsend
  });

  it('ist deterministisch (gleicher Input → identischer Output)', () => {
    expect(spiderfyOffsets(13)).toEqual(spiderfyOffsets(13));
  });
});
```

- [ ] **Step 2: Test ausführen, Fehlschlag verifizieren**

Run: `cd <worktree>/frontend && rtk proxy mise exec pnpm@11.0.9 -- pnpm exec vitest run src/pages/lagekarte/spiderfy.test.ts`
Expected: FAIL — `Failed to resolve import './spiderfy'`.

- [ ] **Step 3: Minimale Implementierung**

`frontend/src/pages/lagekarte/spiderfy.ts`:

```ts
// Pixel-Offsets zum Auffächern (Spiderfy) der Cluster-Leaves. Pure & jsdom-testbar — nur
// Geometrie, kein MapLibre. Kreis bis SPIDER_KREIS_MAX Leaves, danach Archimedische Spirale.

export interface SpiderOffset {
  x: number;
  y: number;
}

/** Mehr Leaves als das → Zoom-Fallback statt Spider (markerLayer/Kartenflaeche). */
export const SPIDER_CAP = 12;
/** Mindestabstand benachbarter Symbole in Pixeln (Icon-Zielgröße 34px + Puffer). */
export const SPIDER_LEAF_ABSTAND = 40;
const SPIDER_KREIS_MAX = 9;

function kreis(count: number): SpiderOffset[] {
  // Radius so groß, dass die Sehne zwischen Nachbarn ≥ SPIDER_LEAF_ABSTAND ist.
  const r = Math.max(SPIDER_LEAF_ABSTAND, SPIDER_LEAF_ABSTAND / (2 * Math.sin(Math.PI / count)));
  const res: SpiderOffset[] = [];
  for (let i = 0; i < count; i++) {
    const a = (2 * Math.PI * i) / count - Math.PI / 2; // Start oben
    res.push({ x: r * Math.cos(a), y: r * Math.sin(a) });
  }
  return res;
}

function spirale(count: number): SpiderOffset[] {
  // Archimedisch: Windungsabstand 2*pi*b = SPIDER_LEAF_ABSTAND; Schrittwinkel so, dass die
  // Bogenlänge je Schritt ~ SPIDER_LEAF_ABSTAND bleibt → Nachbarn ≥ Icon-Größe auseinander.
  const b = SPIDER_LEAF_ABSTAND / (2 * Math.PI);
  const res: SpiderOffset[] = [];
  let winkel = 0;
  for (let i = 0; i < count; i++) {
    const r = SPIDER_LEAF_ABSTAND + b * winkel;
    res.push({ x: r * Math.cos(winkel - Math.PI / 2), y: r * Math.sin(winkel - Math.PI / 2) });
    winkel += SPIDER_LEAF_ABSTAND / r;
  }
  return res;
}

/** Pixel-Offsets für `count` Leaves relativ zum Cluster-Mittelpunkt. */
export function spiderfyOffsets(count: number): SpiderOffset[] {
  if (count <= 0) return [];
  if (count === 1) return [{ x: 0, y: -SPIDER_LEAF_ABSTAND }];
  if (count <= SPIDER_KREIS_MAX) return kreis(count);
  return spirale(count);
}
```

- [ ] **Step 4: Test ausführen, Erfolg verifizieren**

Run: `cd <worktree>/frontend && rtk proxy mise exec pnpm@11.0.9 -- pnpm exec vitest run src/pages/lagekarte/spiderfy.test.ts`
Expected: PASS (4 Tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/lagekarte/spiderfy.ts frontend/src/pages/lagekarte/spiderfy.test.ts
git commit -m "feat(lfh-175): pure Spider-Anordnung (Kreis/Spirale, Pixel-Offsets)"
```

---

## Task 2: FC-Bau `baueSpiderFc` (Leaves + Beinchen) via injizierbarem Projektor

**Files:**
- Modify: `frontend/src/pages/lagekarte/spiderfy.ts`
- Test: `frontend/src/pages/lagekarte/spiderfy.test.ts`

**Interfaces:**
- Consumes: `spiderfyOffsets` (Task 1); `MarkerProps`, `MarkerFeatureCollection` aus `markerLayer.ts`.
- Produces:
  - `interface SpiderProjektor { project(lngLat: [number, number]): { x: number; y: number }; unproject(px: { x: number; y: number }): { lng: number; lat: number } }` (Teil-Signatur von `maplibregl.Map`).
  - `interface SpiderFcs { leaves: MarkerFeatureCollection; legs: SpiderLegFeatureCollection }`
  - `type SpiderLegFeatureCollection = { type: 'FeatureCollection'; features: Array<{ type: 'Feature'; properties: Record<string, never>; geometry: { type: 'LineString'; coordinates: [number, number][] } }> }`
  - `function baueSpiderFc(leaves: MarkerProps[], anker: [number, number], projektor: SpiderProjektor): SpiderFcs` — projiziert den Anker, addiert die Offsets im Pixelraum, un-projiziert zurück → Leaf-Punkte mit unveränderten `MarkerProps`; je Leaf ein Beinchen (LineString Anker→Leaf).

- [ ] **Step 1: Failing test schreiben** (an `spiderfy.test.ts` anhängen)

```ts
import { baueSpiderFc } from './spiderfy';
import type { MarkerProps } from './markerLayer';

// Identitäts-Projektor: Pixel == Lng/Lat → Offsets erscheinen unverändert in den Koordinaten.
const idProjektor = {
  project: (ll: [number, number]) => ({ x: ll[0], y: ll[1] }),
  unproject: (px: { x: number; y: number }) => ({ lng: px.x, lat: px.y }),
};

const props = (schluessel: string, extra: Partial<MarkerProps> = {}): MarkerProps => ({
  schluessel, typ: 'uhs', farbe: '#000', ...extra,
});

describe('baueSpiderFc', () => {
  it('liefert je Leaf ein Feature mit unveränderten Properties + ein Beinchen vom Anker', () => {
    const leaves = [props('uhs-1'), props('fahrzeug-2', { icon: 'tz|x', statusFarbe: '#0f0' })];
    const { leaves: leafFc, legs } = baueSpiderFc(leaves, [100, 100], idProjektor);

    expect(leafFc.features.map((f) => f.properties.schluessel)).toEqual(['uhs-1', 'fahrzeug-2']);
    expect(leafFc.features[1].properties.icon).toBe('tz|x');
    expect(leafFc.features[1].properties.statusFarbe).toBe('#0f0');
    // Position = Anker + Offset (Identitäts-Projektor)
    expect(leafFc.features).toHaveLength(2);
    expect(legs.features).toHaveLength(2);
    for (const leg of legs.features) {
      expect(leg.geometry.coordinates[0]).toEqual([100, 100]); // Beinchen startet am Anker
    }
    // Beinchen-Ende == zugehörige Leaf-Position
    expect(legs.features[0].geometry.coordinates[1]).toEqual(leafFc.features[0].geometry.coordinates);
  });

  it('ist leer bei keinen Leaves', () => {
    const { leaves, legs } = baueSpiderFc([], [0, 0], idProjektor);
    expect(leaves.features).toHaveLength(0);
    expect(legs.features).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Test ausführen, Fehlschlag verifizieren**

Run: `cd <worktree>/frontend && rtk proxy mise exec pnpm@11.0.9 -- pnpm exec vitest run src/pages/lagekarte/spiderfy.test.ts`
Expected: FAIL — `baueSpiderFc` is not exported.

- [ ] **Step 3: Implementierung** (an `spiderfy.ts` anhängen; Import oben ergänzen)

Oben in `spiderfy.ts` ergänzen:
```ts
import type { MarkerProps, MarkerFeature, MarkerFeatureCollection } from './markerLayer';
```

Am Dateiende ergänzen:
```ts
export interface SpiderProjektor {
  project(lngLat: [number, number]): { x: number; y: number };
  unproject(px: { x: number; y: number }): { lng: number; lat: number };
}

export type SpiderLegFeatureCollection = {
  type: 'FeatureCollection';
  features: Array<{
    type: 'Feature';
    properties: Record<string, never>;
    geometry: { type: 'LineString'; coordinates: [number, number][] };
  }>;
};

export interface SpiderFcs {
  leaves: MarkerFeatureCollection;
  legs: SpiderLegFeatureCollection;
}

/**
 * Baut aus den Cluster-Leaves die aufgefächerten Leaf-Punkte (unveränderte MarkerProps) und die
 * Beinchen-Linien. Der Anker wird in den Pixelraum projiziert, die Offsets addiert und zurück
 * un-projiziert → die Symbole sitzen mit festem Pixelabstand um den Cluster-Mittelpunkt.
 * Der Projektor ist injiziert (= `map.project`/`map.unproject`) → pure & testbar.
 */
export function baueSpiderFc(
  leaves: MarkerProps[],
  anker: [number, number],
  projektor: SpiderProjektor,
): SpiderFcs {
  const offsets = spiderfyOffsets(leaves.length);
  const c = projektor.project(anker);
  const leafFeatures: MarkerFeature[] = [];
  const legFeatures: SpiderLegFeatureCollection['features'] = [];
  leaves.forEach((p, i) => {
    const o = offsets[i];
    const ll = projektor.unproject({ x: c.x + o.x, y: c.y + o.y });
    const pos: [number, number] = [ll.lng, ll.lat];
    leafFeatures.push({ type: 'Feature', properties: { ...p }, geometry: { type: 'Point', coordinates: pos } });
    legFeatures.push({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [anker, pos] } });
  });
  return {
    leaves: { type: 'FeatureCollection', features: leafFeatures },
    legs: { type: 'FeatureCollection', features: legFeatures },
  };
}
```

- [ ] **Step 4: Test ausführen, Erfolg verifizieren**

Run: `cd <worktree>/frontend && rtk proxy mise exec pnpm@11.0.9 -- pnpm exec vitest run src/pages/lagekarte/spiderfy.test.ts`
Expected: PASS (6 Tests gesamt).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/lagekarte/spiderfy.ts frontend/src/pages/lagekarte/spiderfy.test.ts
git commit -m "feat(lfh-175): baueSpiderFc — Leaf- + Beinchen-FCs via injiziertem Projektor"
```

---

## Task 3: Spider-Sources/Layer + geteilte Paint-Configs + `setzeSpiderDaten` + Pin-Order

**Files:**
- Modify: `frontend/src/pages/lagekarte/markerLayer.ts`
- Test: `frontend/src/pages/lagekarte/markerLayer.test.ts`

**Interfaces:**
- Consumes: `MarkerFeatureCollection`, `MarkerProps` (bestehend); `SpiderLegFeatureCollection` (Task 2, nur als Strukturtyp — Import via `import type`).
- Produces:
  - `const SPIDER_LEAVES_QUELLE = 'spider-leaves'`, `const SPIDER_LEGS_QUELLE = 'spider-legs'`
  - `const SPIDER_KLICK_LAYER = ['spider-symbol', 'spider-kreis', 'spider-status-ring'] as const`
  - `function setzeSpiderDaten(map, leaves: MarkerFeatureCollection, legs: { type: 'FeatureCollection'; features: unknown[] }): void` — `setData` auf beide Spider-Sources.
  - `sorgeFuerMarkerLayer` legt zusätzlich Spider-Sources + Layer (`spider-legs-line`, `spider-status-ring`, `spider-kreis`, `spider-symbol`) idempotent an; `pinneMarkerLayerNachOben` schiebt sie mit nach oben (Beinchen unter den Leaf-Symbolen).

- [ ] **Step 1: Failing tests schreiben** (an `markerLayer.test.ts` anhängen + bestehenden Pin-Test anpassen)

Den bestehenden Test (`pinnt die Marker-Layer nach oben …`, aktuell `expect(moves).toEqual([...4 marker layers])`) ersetzen durch:

```ts
  it('pinnt Marker- UND Spider-Layer nach oben (Beinchen unter den Leaf-Symbolen)', () => {
    const { map, moves } = fakeMap();
    sorgeFuerMarkerLayer(map as never, leer, leer);
    expect(moves).toEqual([
      'marker-status-ring', 'marker-kreis', 'marker-symbol', 'marker-einsatzort-symbol',
      'spider-legs-line', 'spider-status-ring', 'spider-kreis', 'spider-symbol',
    ]);
  });
```

Neue Tests anhängen:

```ts
import {
  SPIDER_LEAVES_QUELLE, SPIDER_LEGS_QUELLE, SPIDER_KLICK_LAYER, setzeSpiderDaten,
} from './markerLayer';

describe('Spider-Layer', () => {
  it('legt Spider-Sources (ungeclustert) + Beinchen-Linie + Leaf-Layer an', () => {
    const { map, sources, layers } = fakeMap();
    sorgeFuerMarkerLayer(map as never, leer, leer);
    expect(sources.has(SPIDER_LEAVES_QUELLE)).toBe(true);
    expect(sources.has(SPIDER_LEGS_QUELLE)).toBe(true);
    expect((sources.get(SPIDER_LEAVES_QUELLE)!.spec as { cluster?: boolean }).cluster).toBeUndefined();
    for (const id of ['spider-legs-line', 'spider-status-ring', 'spider-kreis', 'spider-symbol']) {
      expect(layers.has(id)).toBe(true);
    }
  });

  it('alle SPIDER_KLICK_LAYER existieren real (Konstanten-Kopplung)', () => {
    const { map, layers } = fakeMap();
    sorgeFuerMarkerLayer(map as never, leer, leer);
    for (const id of SPIDER_KLICK_LAYER) expect(layers.has(id)).toBe(true);
  });

  it('setzeSpiderDaten spielt Leaves + Beinchen in die Spider-Sources', () => {
    const { map, sources } = fakeMap();
    sorgeFuerMarkerLayer(map as never, leer, leer);
    const leaves = { type: 'FeatureCollection' as const, features: [] };
    const legs = { type: 'FeatureCollection' as const, features: [] };
    setzeSpiderDaten(map as never, leaves, legs);
    expect(sources.get(SPIDER_LEAVES_QUELLE)!.setData).toHaveBeenCalledWith(leaves);
    expect(sources.get(SPIDER_LEGS_QUELLE)!.setData).toHaveBeenCalledWith(legs);
  });
});
```

- [ ] **Step 2: Tests ausführen, Fehlschlag verifizieren**

Run: `cd <worktree>/frontend && rtk proxy mise exec pnpm@11.0.9 -- pnpm exec vitest run src/pages/lagekarte/markerLayer.test.ts`
Expected: FAIL — Exporte fehlen + Pin-Order-Assertion rot.

- [ ] **Step 3: Implementierung in `markerLayer.ts`**

(a) Geteilte Paint/Layout-Konstanten oberhalb von `sorgeFuerMarkerLayer` einführen (DRY — Marker- und Spider-Layer teilen sie):

```ts
// Geteilte Paint/Layout-Configs für Einzelmarker- UND Spider-Leaf-Layer (DRY).
const STATUS_RING_PAINT = {
  'circle-radius': 20, 'circle-color': ['get', 'statusFarbe'], 'circle-opacity': 0.9,
} as const;
const KREIS_PAINT = {
  'circle-radius': 9, 'circle-color': ['get', 'farbe'],
  'circle-stroke-color': '#fff', 'circle-stroke-width': 2,
} as const;
const SYMBOL_LAYOUT = {
  'icon-image': ['get', 'icon'], 'icon-size': 1, 'icon-allow-overlap': true,
} as const;
```

Die bestehenden `marker-status-ring`/`marker-kreis`/`marker-symbol`/`marker-einsatzort-symbol`-`addLayer`-Aufrufe auf diese Konstanten umstellen (Paint/Layout per Spread), z. B.:
```ts
      paint: { ...STATUS_RING_PAINT },
```
```ts
      paint: { ...KREIS_PAINT },
```
```ts
      layout: { ...SYMBOL_LAYOUT },
```

(b) Konstanten + Spider-Anlage. Nach den bestehenden Source-/Konstanten-Definitionen ergänzen:

```ts
export const SPIDER_LEAVES_QUELLE = 'spider-leaves';
export const SPIDER_LEGS_QUELLE = 'spider-legs';
export const SPIDER_KLICK_LAYER = ['spider-symbol', 'spider-kreis', 'spider-status-ring'] as const;
```

Die Pin-Reihenfolge erweitern (Beinchen unter den Leaf-Symbolen, alle über den Markern):
```ts
const MARKER_LAYER_REIHENFOLGE = [
  'marker-status-ring', 'marker-kreis', 'marker-symbol', 'marker-einsatzort-symbol',
  'spider-legs-line', 'spider-status-ring', 'spider-kreis', 'spider-symbol',
] as const;
```

In `sorgeFuerMarkerLayer`, VOR dem abschließenden `pinneMarkerLayerNachOben(map)`, die Spider-Layer anlegen:

```ts
  // Spider-Sources (ungeclustert) — Daten setzt der Controller in Kartenflaeche via setzeSpiderDaten.
  if (!map.getSource(SPIDER_LEAVES_QUELLE)) {
    map.addSource(SPIDER_LEAVES_QUELLE, { type: 'geojson', data: leerFc() as never });
  }
  if (!map.getSource(SPIDER_LEGS_QUELLE)) {
    map.addSource(SPIDER_LEGS_QUELLE, { type: 'geojson', data: leerFc() as never });
  }
  // Beinchen (Linien zum Anker) ZUERST → liegen unter den Leaf-Symbolen.
  if (!map.getLayer('spider-legs-line')) {
    map.addLayer({
      id: 'spider-legs-line', type: 'line', source: SPIDER_LEGS_QUELLE,
      paint: { 'line-color': '#64748b', 'line-width': 1.5, 'line-opacity': 0.7 },
    });
  }
  // Leaf-Layer spiegeln die Einzelmarker-Optik; Filter ohne point_count (Spider-Source ist ungeclustert).
  if (!map.getLayer('spider-status-ring')) {
    map.addLayer({
      id: 'spider-status-ring', type: 'circle', source: SPIDER_LEAVES_QUELLE,
      filter: ['has', 'statusFarbe'], paint: { ...STATUS_RING_PAINT },
    });
  }
  if (!map.getLayer('spider-kreis')) {
    map.addLayer({
      id: 'spider-kreis', type: 'circle', source: SPIDER_LEAVES_QUELLE,
      filter: ['!', ['has', 'icon']], paint: { ...KREIS_PAINT },
    });
  }
  if (!map.getLayer('spider-symbol')) {
    map.addLayer({
      id: 'spider-symbol', type: 'symbol', source: SPIDER_LEAVES_QUELLE,
      filter: ['has', 'icon'], layout: { ...SYMBOL_LAYOUT },
    });
  }
```

Helfer `leerFc` oben in der Datei ergänzen (oder den bestehenden leeren FC nutzen):
```ts
const leerFc = (): MarkerFeatureCollection => ({ type: 'FeatureCollection', features: [] });
```

(c) `setzeSpiderDaten` am Dateiende ergänzen:
```ts
/** Spielt aufgefächerte Leaves + Beinchen in die Spider-Sources (Controller in Kartenflaeche). */
export function setzeSpiderDaten(
  map: MapLibreMap,
  leaves: MarkerFeatureCollection,
  legs: { type: 'FeatureCollection'; features: unknown[] },
) {
  (map.getSource(SPIDER_LEAVES_QUELLE) as GeoJSONSource | undefined)?.setData(leaves as never);
  (map.getSource(SPIDER_LEGS_QUELLE) as GeoJSONSource | undefined)?.setData(legs as never);
}
```

- [ ] **Step 4: Tests ausführen, Erfolg verifizieren**

Run: `cd <worktree>/frontend && rtk proxy mise exec pnpm@11.0.9 -- pnpm exec vitest run src/pages/lagekarte/markerLayer.test.ts`
Expected: PASS (alle, inkl. angepasstem Pin-Test + 3 neue Spider-Tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/lagekarte/markerLayer.ts frontend/src/pages/lagekarte/markerLayer.test.ts
git commit -m "feat(lfh-175): Spider-Sources/Layer + geteilte Paint-Configs + setzeSpiderDaten"
```

---

## Task 4: Spider-Controller in `Kartenflaeche.tsx` verdrahten

**Files:**
- Modify: `frontend/src/pages/lagekarte/Kartenflaeche.tsx`

**Interfaces:**
- Consumes: `baueSpiderFc`, `SPIDER_CAP`, `SpiderProjektor` (spiderfy.ts); `setzeSpiderDaten`, `SPIDER_KLICK_LAYER`, `MARKER_CLUSTER_QUELLE`, `MarkerProps` (markerLayer.ts).
- Kein Unit-Test (WebGL-Laufzeit). Verifikation über Lint/Typecheck + grüne lagekarte-Suite (insb. `LagekartePage.test.tsx`, da `Kartenflaeche` dort gemockt ist) + visuellen Smoke-Test (Task 5). Grüne Unit-Tests bedeuten hier **nicht** „Feature verifiziert".

- [ ] **Step 1: Importe ergänzen**

In den Import aus `./markerLayer` aufnehmen: `setzeSpiderDaten, SPIDER_KLICK_LAYER, type MarkerProps`. Neuer Import:
```ts
import { baueSpiderFc, SPIDER_CAP, type SpiderProjektor } from './spiderfy';
```

- [ ] **Step 2: Refs für den Spider-Lebenszyklus**

Bei den übrigen Refs (nahe `clusterDomRef`) ergänzen:
```ts
  // Offener Spider: cluster_id (String) oder null. spiderTokenRef entwertet in-flight getClusterLeaves
  // (Race-Guard: schneller A→B-Wechsel darf nicht A's Leaves über B malen).
  const spiderOffenRef = useRef<string | null>(null);
  const spiderTokenRef = useRef(0);
  // Controller-Funktionen als Refs, damit der DOM-Donut-Klickhandler + die Daten-/Style-Effekte
  // sie aufrufen können, ohne als Dependency neu zu binden.
  const oeffneSpiderRef = useRef<(clusterId: string, center: [number, number], anzahl: number) => void>(() => {});
  const schliesseSpiderRef = useRef<() => void>(() => {});
```

- [ ] **Step 3: Spider-Controller-Effekt (Öffnen/Einklappen/Trigger/Race-Guard)**

Nach dem bestehenden Cluster-Donut-Effekt (der `map.on('render', aktualisiere)` registriert) einen neuen Effekt einfügen:

```ts
  // Spider-Controller: Cluster-Donut-Klick fächert die Leaves auf (statt reinzuzoomen), klappt
  // zuverlässig ein. WebGL-Laufzeit → lebt hier (einzige MapLibre-Stelle). Setup-once ([]),
  // Map über Ref; Trigger: Move/Zoom, leerer Klick, ESC, erneuter Cluster-Klick (Toggle),
  // Live-Daten-Änderung ([markers]-Effekt) und Style-Wechsel ([style]-Effekt) rufen schliesse().
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const leer = { type: 'FeatureCollection' as const, features: [] };

    const schliesse = () => {
      spiderTokenRef.current++;            // in-flight getClusterLeaves entwerten
      if (spiderOffenRef.current === null) return;
      spiderOffenRef.current = null;
      setzeSpiderDaten(map, leer, leer);
    };

    const oeffne = (clusterId: string, center: [number, number], anzahl: number) => {
      if (spiderOffenRef.current === clusterId) { schliesse(); return; } // Toggle / erneuter Klick
      schliesse();                                                        // A→B: A einklappen
      const src = map.getSource(MARKER_CLUSTER_QUELLE) as GeoJSONSource | undefined;
      if (!src) return;
      // Großcluster → Fallback: reinzoomen (verkleinert Cluster, dann erneut auffächerbar).
      if (anzahl > SPIDER_CAP) {
        src.getClusterExpansionZoom(Number(clusterId))
          .then((zoom) => map.easeTo({ center, zoom }))
          .catch(() => { /* Cluster nach Daten-Update weg → ignorieren */ });
        return;
      }
      const token = ++spiderTokenRef.current;
      src.getClusterLeaves(Number(clusterId), SPIDER_CAP, 0)
        .then((leaves) => {
          if (token !== spiderTokenRef.current) return; // stale (anderer Cluster geklickt / eingeklappt)
          const projektor: SpiderProjektor = {
            project: (ll) => map.project(ll),
            unproject: (px) => map.unproject([px.x, px.y]),
          };
          const props = leaves.map((f) => f.properties as MarkerProps);
          const { leaves: leafFc, legs } = baueSpiderFc(props, center, projektor);
          setzeSpiderDaten(map, leafFc, legs);
          spiderOffenRef.current = clusterId;
        })
        .catch(() => { /* Cluster nach Daten-Update weg → ignorieren */ });
    };

    oeffneSpiderRef.current = oeffne;
    schliesseSpiderRef.current = schliesse;

    // Einklapp-Trigger: jede Kartenbewegung, jeder (leere) Karten-Klick, ESC.
    const aufLeerKlick = () => schliesse();
    const aufKey = (e: KeyboardEvent) => { if (e.key === 'Escape') schliesse(); };
    map.on('movestart', schliesse);
    map.on('click', aufLeerKlick);
    window.addEventListener('keydown', aufKey);
    return () => {
      map.off('movestart', schliesse);
      map.off('click', aufLeerKlick);
      window.removeEventListener('keydown', aufKey);
      schliesse();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
```

> Hinweis Klick-Reihenfolge: Der DOM-Donut-Klick ruft `stopPropagation` → erreicht den allgemeinen `map.on('click', …)` NICHT (Donut ist ein DOM-Element über dem Canvas). Re-Klick/Wechsel läuft daher über `oeffne` (Toggle/A→B), nicht über `aufLeerKlick`. Ein Leaf-Klick erreicht den Canvas → klappt nach dem Routing ein (gewollt). Leerer Klick → einklappen.

- [ ] **Step 4: Donut-Klick auf Spiderfy umstellen**

Im Cluster-Donut-Effekt den bestehenden Klick-Listener (`getClusterExpansionZoom` → `easeTo`) ersetzen durch:

```ts
          el.addEventListener('click', (ev) => {
            ev.stopPropagation();
            oeffneSpiderRef.current?.(id, coords, Number(props.point_count ?? 0));
          });
```

(`id` = `String(props.cluster_id)` ist im Effekt bereits vorhanden; `coords` ebenso.)

- [ ] **Step 5: Leaf-Klick-Routing + Cursor (Spider-Leaves wie Einzelmarker)**

Im bestehenden Einzel-Marker-Klick-Effekt (deps `[onMarkerKlick]`) die Layer-Liste um die Spider-Klick-Layer erweitern — den `for`-Schleifen-Iterator von `MARKER_KLICK_LAYER` auf die Verkettung umstellen:

```ts
    const klickLayer = [...MARKER_KLICK_LAYER, ...SPIDER_KLICK_LAYER];
    for (const id of klickLayer) {
      map.on('click', id, klickMarker);
      map.on('mouseenter', id, enter);
      map.on('mouseleave', id, leave);
    }
    return () => {
      for (const id of klickLayer) {
        map.off('click', id, klickMarker);
        map.off('mouseenter', id, enter);
        map.off('mouseleave', id, leave);
      }
    };
```

- [ ] **Step 6: Einklappen bei Live-Daten-Änderung + Style-Wechsel**

Im `[markers]`-Effekt, direkt nach dem Verwerfen der DOM-Donuts (`clusterDomRef.current = {};`), ergänzen:
```ts
    // Offener Spider hält einen veralteten getClusterLeaves-Snapshot → bei Daten-Änderung einklappen.
    schliesseSpiderRef.current?.();
```

Im `[style]`-Effekt, direkt nach `if (style === angewandterStyleRef.current) return;` und vor `map.setStyle(…)`, ergänzen:
```ts
    schliesseSpiderRef.current?.(); // setStyle wischt Spider-Sources/Layer → Controller-State sonst stale
```

- [ ] **Step 7: Typecheck + Lint + lagekarte-Suite**

```bash
cd <worktree>/frontend
rtk proxy mise exec pnpm@11.0.9 -- pnpm exec tsc --noEmit
rtk proxy mise exec pnpm@11.0.9 -- pnpm lint
rtk proxy mise exec pnpm@11.0.9 -- pnpm exec vitest run src/pages/lagekarte --no-file-parallelism
```
Expected: tsc 0 Fehler; lint 0 Warnings/Errors; Vitest grün (alle lagekarte-Tests inkl. `LagekartePage.test.tsx`).

- [ ] **Step 8: Commit**

```bash
git add frontend/src/pages/lagekarte/Kartenflaeche.tsx
git commit -m "feat(lfh-175): Spider-Controller — Donut-Klick fächert auf, Einklappen + Race-Guard"
```

---

## Task 5: Gates + visueller Smoke-Test (Verifikation)

**REQUIRED SUB-SKILL:** `superpowers:verification-before-completion` vor jeder „fertig"-Aussage.

- [ ] **Step 1: Volle Gates grün**

```bash
cd <worktree>/frontend
rtk proxy mise exec pnpm@11.0.9 -- pnpm exec tsc --noEmit
rtk proxy mise exec pnpm@11.0.9 -- pnpm lint
rtk proxy mise exec pnpm@11.0.9 -- pnpm exec vitest run src/pages/lagekarte --no-file-parallelism
```
Expected: alle grün (tsc 0, lint 0 Warnings, Vitest 0 Fehler).

- [ ] **Step 2: App-Bundle bauen + Backend hochziehen** (rust-embed → Frontend ins Binary)

```bash
cd <worktree>/frontend && rtk proxy mise exec pnpm@11.0.9 -- pnpm build
# danach Backend gegen das frische dist neu starten (siehe e2e-Harness-Muster / dev-seeds)
```

- [ ] **Step 3: Visueller Smoke-Test** (jsdom rendert kein WebGL — diese Kriterien NUR hier prüfbar)

Akzeptanzkriterien gegen die laufende App:
- Cluster-Donut anklicken → Marker fächern sichtbar auf (Kreis bis ~9, sonst Spirale), Beinchen verbinden Symbole mit dem Cluster-Mittelpunkt.
- Aufgefächerte Symbole sind voll funktional: Klick → Inspector/Deeplink (`onMarkerKlick`), taktisches Zeichen sichtbar, FMS-Status-Ring bei Fahrzeugen, Kreis bei Lagemeldungen.
- Spider klappt zuverlässig ein bei: Karte verschieben/zoomen, Klick auf leeren Bereich, ESC, erneutem Klick auf denselben Cluster, Klick auf einen anderen Cluster (A→B), **Live-Daten-Änderung** (SSE/Query-Invalidation), **Basemap-/Theme-Wechsel** (`setStyle`). Keine verwaisten Symbole/Beinchen.
- Großcluster (`> 12`): Klick zoomt rein statt aufzufächern; nach dem Reinzoomen lassen sich die kleineren Cluster auffächern.
- `Kartenflaeche` bleibt die einzige MapLibre-Stelle (kein WebGL-Import in `spiderfy.ts`/`markerLayer.ts` — nur `import type`).

- [ ] **Step 4: Feinjustage (im Smoke-Test)** — falls nötig: `SPIDER_LEAF_ABSTAND`, `SPIDER_CAP`, Beinchen-Optik (`line-color`/`-width`/`-opacity`). Reine Konstanten-Tweaks; Tests bleiben grün.

---

## Self-Review (gegen LFH-175-Spec)

- **„Klick fächert auf (statt reinzuzoomen)"** → Task 4 Step 4 (Donut-Klick → `oeffne`), Großcluster-Fallback Step 3.
- **„Pure Anordnung: Kreis bis ~9, danach Spirale, Pixel-Offsets, unit-testbar"** → Task 1.
- **„getClusterLeaves (async) → Symbole an Offsets, Beinchen-Layer"** → Task 4 Step 3 (`getClusterLeaves`), Task 2 (`baueSpiderFc`), Task 3 (`spider-legs-line` + Leaf-Layer).
- **„Klick-Routing auf aufgefächerte Symbole → onMarkerKlick"** → Task 4 Step 5.
- **„Einklappen bei Move/Zoom, leerem Klick, erneutem Cluster-Klick, ESC, Live-Daten-Änderung"** → Task 4 Step 3 (Move/Klick/ESC/Toggle) + Step 6 (`[markers]` Live-Daten). Zusätzlich Style-Wechsel (Step 6).
- **„Keine verwaisten Symbole/Beinchen"** → Race-Guard (`spiderTokenRef`) + `schliesse()` in allen Triggern + Cleanup; Smoke-Test Step 3.
- **„Kartenflaeche bleibt einzige MapLibre-Stelle"** → `spiderfy.ts`/`markerLayer.ts` nur `import type`; Global Constraints + Smoke-Test Step 3.
- **Typkonsistenz:** `baueSpiderFc(props: MarkerProps[], anker, projektor)` ↔ Aufruf in Kartenflaeche (`leaves.map(f => f.properties as MarkerProps)`); `setzeSpiderDaten(map, leaves, legs)` ↔ Task 3; `spiderfyOffsets`/`SPIDER_CAP`/`SPIDER_LEAF_ABSTAND` konsistent benannt.
