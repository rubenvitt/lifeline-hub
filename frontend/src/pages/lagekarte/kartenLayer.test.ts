import { describe, it, expect, vi } from 'vitest';
import {
  baueFlaechenFc,
  baueZonenFc,
  planeReAnlegenNachStyle,
  plakettenBild,
  plakettenBildId,
  reAnlegenAlles,
  sorgeFuerZonenLayer,
  zonenPlakette,
  type ZoneFeature,
} from './kartenLayer';
import { farbenDunkel, farbenHell } from '../../theme/tokens';
import { FACHEBENEN } from './fachebenen';
import { MARKER_CLUSTER_QUELLE } from './markerLayer';

const leereFlaechen = baueFlaechenFc([]);
const leereZonen = baueZonenFc([]);

/**
 * Regressionsschutz für „alle Zeichnungen verschwinden beim Basemap-/Theme-Wechsel,
 * erst nach dem Zeichnen einer neuen erscheinen sie wieder".
 *
 * Root Cause: Die Re-Anlage der Custom-Layer nach `setStyle` hing am `styledata`-Event
 * mit `isStyleLoaded()`-Gate. Beim Wechsel auf einen Online-Style (Tiles laden noch)
 * feuert kein `styledata` mit geladenem Style → keine Re-Anlage. Erst ein Daten-Update
 * (= neue Zone zeichnen) lief über den zuverlässigen render-Frame-Poller.
 *
 * Der Fix verdrahtet den Style-Wechsel an genau diesen Poller. Geprüft wird hier das
 * *Wann*: keine vorzeitige Anlage, aber zuverlässige Anlage beim ersten Frame mit
 * geladenem Style.
 */

/** Fake-Map mit Source-Registry; protokolliert addSource/addLayer und treibt render-Frames. */
function fakeMap(istGeladen: () => boolean) {
  const sources = new Set<string>();
  const layers = new Set<string>();
  const handler: Record<string, Array<() => void>> = {};
  const setData = vi.fn();
  const map = {
    isStyleLoaded: istGeladen,
    on: vi.fn((ev: string, cb: () => void) => {
      (handler[ev] ??= []).push(cb);
    }),
    off: vi.fn((ev: string, cb: () => void) => {
      handler[ev] = (handler[ev] ?? []).filter((h) => h !== cb);
    }),
    getSource: vi.fn((id: string) => (sources.has(id) ? { setData } : undefined)),
    addSource: vi.fn((id: string) => {
      sources.add(id);
    }),
    getLayer: vi.fn((id: string) => (layers.has(id) ? {} : undefined)),
    addLayer: vi.fn((spec: { id: string }) => {
      layers.add(spec.id);
    }),
    moveLayer: vi.fn(),
    feuere: (ev: string) => (handler[ev] ?? []).slice().forEach((h) => h()),
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { map: map as any, addSource: map.addSource, setData };
}

/** Erweiterte Fake-Map mit image-source-Support (setCoordinates) und setPaintProperty. */
function fakeMapMitBild() {
  const sources = new Map<
    string,
    { setData: ReturnType<typeof vi.fn>; setCoordinates: ReturnType<typeof vi.fn> }
  >();
  const layers = new Set<string>();
  return {
    isStyleLoaded: () => true,
    on: vi.fn(),
    off: vi.fn(),
    getSource: vi.fn((id: string) => sources.get(id)),
    addSource: vi.fn((id: string) => {
      sources.set(id, { setData: vi.fn(), setCoordinates: vi.fn() });
    }),
    removeSource: vi.fn((id: string) => {
      sources.delete(id);
    }),
    getLayer: vi.fn((id: string) => (layers.has(id) ? {} : undefined)),
    addLayer: vi.fn((spec: { id: string }) => {
      layers.add(spec.id);
    }),
    removeLayer: vi.fn((id: string) => {
      layers.delete(id);
    }),
    setPaintProperty: vi.fn(),
    _layers: layers,
  };
}

const ZONE: ZoneFeature = {
  id: 1,
  geometrie: {
    type: 'Polygon',
    coordinates: [
      [
        [8.6, 50.1],
        [8.7, 50.1],
        [8.7, 50.2],
        [8.6, 50.1],
      ],
    ],
  },
  label: 'Sperrzone',
  stil: { fillColor: '#f00', fillOpacity: 0.2, lineColor: '#f00', lineWidth: 2 },
};

describe('reAnlegenAlles', () => {
  it('legt Abschnitts- und Zonen-Source idempotent an und spielt die Daten ein', () => {
    const { map, addSource, setData } = fakeMap(() => true);
    const zonen = baueZonenFc([ZONE]);
    reAnlegenAlles(map, baueZonenFc([]) as never, zonen);

    expect(addSource).toHaveBeenCalledWith('abschnitte', expect.anything());
    expect(addSource).toHaveBeenCalledWith('zonen', expect.anything());
    expect(setData).toHaveBeenCalledWith(zonen);
  });

  it('reAnlegenAlles legt aktive Fachebenen mit an', () => {
    const { map } = fakeMap(() => true);
    const aktive = [
      { def: FACHEBENEN.dwd, daten: { type: 'FeatureCollection' as const, features: [] } },
    ];
    reAnlegenAlles(map, baueFlaechenFc([]), baueZonenFc([]), aktive as never);
    expect(map.getLayer('fachebene-dwd-fill')).toBeTruthy();
  });

  it('reAnlegenAlles legt Bild-Layer mit an', () => {
    const map = fakeMapMitBild();
    reAnlegenAlles(
      map as never,
      leereFlaechen,
      leereZonen,
      [],
      [
        {
          id: 5,
          blobUrl: 'blob:x',
          ecken: [
            [9, 50],
            [9.1, 50],
            [9.1, 49.9],
            [9, 49.9],
          ],
          opazitaet: 100,
          sichtbar: true,
        },
      ],
    );
    expect(map._layers.has('bild-5-raster')).toBe(true);
  });
});

describe('Luftqualitätsebene nach Stilwechsel (LFH-79)', () => {
  it('steht nach einem Basemap-/Theme-Wechsel samt Daten wieder auf der Karte', () => {
    // `reAnlegenAlles` ist generisch über die aktiven Ebenen — dieser Test belegt, dass das
    // für die Luftqualitätsebene auch gilt: Source, Kreis-Layer und die zuletzt bekannten
    // Stationen kommen über den render-Frame-Poller zurück.
    let geladen = false;
    const { map, addSource, setData } = fakeMap(() => geladen);
    const stationen = {
      type: 'FeatureCollection' as const,
      features: [
        {
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [13.06, 52.39] },
          properties: { klasse: 'maessig', farbe: '#faad14', radius: 6 },
        },
      ],
    };
    planeReAnlegenNachStyle(
      map,
      () => leereFlaechen,
      () => leereZonen,
      () => [{ def: FACHEBENEN.luftqualitaet, daten: stationen }] as never,
    );
    map.feuere('render');
    expect(addSource).not.toHaveBeenCalledWith('fachebene-luftqualitaet', expect.anything());

    geladen = true;
    map.feuere('render');
    expect(addSource).toHaveBeenCalledWith('fachebene-luftqualitaet', expect.anything());
    expect(map.getLayer('fachebene-luftqualitaet-circle')).toBeTruthy();
    expect(setData).toHaveBeenCalledWith(stationen);
  });
});

describe('planeReAnlegenNachStyle', () => {
  it('legt NICHT an, solange der neue Style (Online-Tiles) noch lädt', () => {
    const { map, addSource } = fakeMap(() => false);
    planeReAnlegenNachStyle(
      map,
      () => baueZonenFc([]) as never,
      () => baueZonenFc([ZONE]),
    );

    // Frame während des Tile-Ladens → noch nichts angelegt (das ist der Bug-Kern:
    // styledata-Gate hätte hier resigniert und nie wieder re-angelegt).
    map.feuere('render');
    expect(addSource).not.toHaveBeenCalled();
  });

  it('legt beim ersten Frame mit geladenem Style zuverlässig wieder an', () => {
    let geladen = false;
    const { map, addSource, setData } = fakeMap(() => geladen);
    const zonen = baueZonenFc([ZONE]);
    planeReAnlegenNachStyle(
      map,
      () => baueZonenFc([]) as never,
      () => zonen,
    );

    map.feuere('render'); // lädt noch
    expect(addSource).not.toHaveBeenCalled();

    geladen = true;
    map.feuere('render'); // Style fertig → Re-Anlage
    expect(addSource).toHaveBeenCalledWith('zonen', expect.anything());
    expect(addSource).toHaveBeenCalledWith('abschnitte', expect.anything());
    expect(setData).toHaveBeenCalledWith(zonen);
  });

  it('liest die Daten erst im vertagten Lauf → nutzt die aktuellsten Zonen', () => {
    let geladen = false;
    let aktuell = baueZonenFc([]);
    const { map, setData } = fakeMap(() => geladen);
    planeReAnlegenNachStyle(
      map,
      () => baueZonenFc([]) as never,
      () => aktuell,
    );

    // Daten ändern sich, NACHDEM geplant wurde, aber BEVOR der Style fertig ist.
    aktuell = baueZonenFc([ZONE]);
    geladen = true;
    map.feuere('render');

    expect(setData).toHaveBeenCalledWith(aktuell);
  });
});

describe('reAnlegenAlles — Marker', () => {
  it('legt die Marker-Cluster-Source mit an, wenn Marker-Daten übergeben werden', () => {
    const { map } = fakeMap(() => true);
    const marker = { type: 'FeatureCollection' as const, features: [] };
    const einsatzort = { type: 'FeatureCollection' as const, features: [] };
    reAnlegenAlles(map, leereFlaechen, leereZonen, [], [], marker as never, einsatzort as never);
    expect(map.getSource(MARKER_CLUSTER_QUELLE)).toBeTruthy();
  });

  it('lässt Marker weg, wenn keine Marker-Daten übergeben werden (abwärtskompatibel)', () => {
    const { map } = fakeMap(() => true);
    reAnlegenAlles(map, leereFlaechen, leereZonen);
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
      map,
      () => leereFlaechen,
      () => leereZonen,
      () => [],
      () => [],
      () => marker as never,
      () => einsatzort as never,
    );
    geladen = true;
    map.feuere('render');
    expect(map.getSource(MARKER_CLUSTER_QUELLE)).toBeTruthy();
  });
});

/**
 * Neuentwurf S5: Zonenbeschriftung als Plakette (dunkler Grund, Rahmen `linieStark`,
 * Versalien) und Gefahrenzonen gestrichelt. Nur Darstellung — keine neue Geometrie.
 */
describe('Zonen im Entwurfsstil', () => {
  it('trägt Strichelung und Plakettenfarben als Feature-Properties', () => {
    const fc = baueZonenFc([
      { ...ZONE, gestrichelt: true, plakette: zonenPlakette(farbenHell) },
      { ...ZONE, id: 2 },
    ]);
    const [gefahr, andere] = fc.features.map((f) => f.properties);
    expect(gefahr.gestrichelt).toBe(true);
    expect(gefahr.textFarbe).toBe(farbenHell.text);
    expect(gefahr.plakette).toBe(
      plakettenBildId({ grund: farbenHell.paneel, rahmen: farbenHell.linieStark }),
    );
    // Ohne Angabe: durchgezogen, Nachtfarben (Vorgabe des Neuentwurfs).
    expect(andere.gestrichelt).toBe(false);
    expect(andere.textFarbe).toBe(farbenDunkel.text);
  });

  it('legt durchgezogene und gestrichelte Linien als zwei gefilterte Layer an', () => {
    const { map } = fakeMap(() => true);
    sorgeFuerZonenLayer(map, baueZonenFc([ZONE]));
    const specs = map.addLayer.mock.calls.map((c: [{ id: string }]) => c[0]) as Array<{
      id: string;
      filter?: unknown;
      paint?: Record<string, unknown>;
      layout?: Record<string, unknown>;
    }>;
    const durch = specs.find((l) => l.id === 'zonen-line')!;
    const strich = specs.find((l) => l.id === 'zonen-line-gestrichelt')!;
    expect(durch.filter).toEqual(['!=', ['get', 'gestrichelt'], true]);
    expect(strich.filter).toEqual(['==', ['get', 'gestrichelt'], true]);
    // Ein konstantes Array, KEIN datengetriebener Ausdruck (Arrays aus Properties lehnt
    // MapLibre ab — der Layer fehlte dann still).
    expect(strich.paint?.['line-dasharray']).toEqual([3, 2]);
    expect(durch.paint?.['line-dasharray']).toBeUndefined();
    const label = specs.find((l) => l.id === 'zonen-label')!;
    expect(label.layout?.['text-transform']).toBe('uppercase');
    expect(label.layout?.['icon-image']).toEqual(['get', 'plakette']);
    expect(label.layout?.['icon-text-fit']).toBe('both');
  });
});

describe('plakettenBild', () => {
  const id = plakettenBildId({ grund: '#0a0c0e', rahmen: '#2e343a' });

  it('zeichnet 1 px Rahmen in der Rahmenfarbe und den Grund innen', () => {
    const bild = plakettenBild(id)!;
    expect(bild.width).toBe(8);
    const px = (x: number, y: number) =>
      Array.from(bild.data.slice((y * 8 + x) * 4, (y * 8 + x) * 4 + 4));
    expect(px(0, 0)).toEqual([0x2e, 0x34, 0x3a, 255]);
    expect(px(3, 3).slice(0, 3)).toEqual([0x0a, 0x0c, 0x0e]);
    // Der dehnbare Bereich spart den Rahmen aus — sonst würde er beim Strecken breiter.
    expect(bild.stretchX).toEqual([[1, 7]]);
    expect(bild.content).toEqual([1, 1, 7, 7]);
  });

  it('liefert für fremde oder unlesbare Ids nichts, statt zu werfen', () => {
    expect(plakettenBild('tz|irgendwas')).toBeNull();
    expect(plakettenBild('plakette|rot|blau')).toBeNull();
  });
});
