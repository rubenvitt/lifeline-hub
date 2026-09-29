import { describe, expect, it } from 'vitest';
import {
  ABSCHNITT_KLICK_LAYER,
  ZONEN_KLICK_LAYER,
  entscheideKlickziel,
  ordneKlickebene,
} from './klickziel';
import {
  MARKER_KLICK_LAYER,
  PERSONEN_CLUSTER_KLICK_LAYER,
  SPIDER_KLICK_LAYER,
} from './markerLayer';
import { FACHEBENEN } from './fachebenen';
import { fachebeneClickLayerIds } from './fachebenenLayer';

/**
 * Wem ein Tipp auf der Lagekarte gehört (LFH-764): genau einem Ziel. Rangfolge: oberstes
 * gezeichnetes Punktziel, dann Trefferzone (nächster Marker), dann oberste Fläche. Die Merkmale
 * kommen wie aus `queryRenderedFeatures`: oben zuerst.
 */
type M = {
  layer: { id: string };
  properties: Record<string, unknown> | null;
  geometry: { type: string; coordinates?: unknown };
};

const punkt = (layer: string, x: number, props: Record<string, unknown> = {}): M => ({
  layer: { id: layer },
  properties: props,
  geometry: { type: 'Point', coordinates: [x, 0] },
});
const flaeche = (layer: string, id: number): M => ({
  layer: { id: layer },
  properties: { id },
  geometry: { type: 'Polygon', coordinates: [] },
});
// Projektion: lng ist direkt die Pixel-x-Koordinate, lat die y-Koordinate.
const projiziere = ([x, y]: [number, number]) => ({ x, y });
const klick = { x: 0, y: 0 };

const einheit = punkt('marker-symbol', 0, { schluessel: 'einheit-1' });
const zoneVon = (schluessel: string, x: number, layer = 'marker-treffer') =>
  punkt(layer, x, { schluessel, treffer: 72 });
const kritisBuendel = punkt('fachebene-kritis-buendel', 0, { cluster: true, cluster_id: 4 });
const pegel = punkt('fachebene-pegelonline-circle', 0, { uuid: 'p1' });
const personenCluster = {
  ...punkt('personen-cluster-kreis', 0, { cluster: true, cluster_id: 7, point_count: 3 }),
  geometry: { type: 'Point', coordinates: [11.5, 53.55] },
};

describe('entscheideKlickziel', () => {
  it('leerer Klick: kein Ziel', () => {
    expect(entscheideKlickziel([], klick, projiziere)).toBeNull();
  });

  it('ein Markerzeichen gewinnt', () => {
    expect(entscheideKlickziel([einheit], klick, projiziere)).toEqual({
      art: 'marker',
      merkmal: einheit,
    });
  });

  it('unter mehreren Markermerkmalen gewinnt das nächstgelegene, wie bisher', () => {
    const a = punkt('marker-kreis', 5, { schluessel: 'a' });
    const b = punkt('marker-kreis', 30, { schluessel: 'b' });
    expect(entscheideKlickziel([b, a], klick, projiziere)).toEqual({ art: 'marker', merkmal: a });
  });

  it('ein aufgefächertes Zeichen ist ein Marker', () => {
    const leaf = punkt('spider-symbol', 0, { schluessel: 'einheit-2' });
    expect(entscheideKlickziel([leaf], klick, projiziere)).toEqual({
      art: 'marker',
      merkmal: leaf,
    });
  });

  it('KRITIS-Bündel im Ring eines Markers: das Bündel gewinnt, nicht die Trefferzone', () => {
    const z = zoneVon('einheit-1', 20);
    expect(entscheideKlickziel([z, kritisBuendel], klick, projiziere)).toEqual({
      art: 'fachebene',
      merkmal: kritisBuendel,
    });
  });

  it('Pegelpunkt im Ring eines Markers: der Pegel gewinnt', () => {
    for (const id of ['marker-treffer', 'marker-einsatzort-treffer', 'spider-treffer']) {
      expect(entscheideKlickziel([zoneVon('x', 20, id), pegel], klick, projiziere), id).toEqual({
        art: 'fachebene',
        merkmal: pegel,
      });
    }
  });

  it('ein gezeichnetes Zeichen über einem Fachebenen-Punkt gewinnt (oberstes Punktziel)', () => {
    expect(entscheideKlickziel([einheit, pegel], klick, projiziere)).toEqual({
      art: 'marker',
      merkmal: einheit,
    });
  });

  it('Trefferzone schlägt jede Fläche', () => {
    const z = zoneVon('einheit-1', 20);
    for (const f of [
      flaeche('zonen-fill', 3),
      flaeche('zonen-line', 3),
      flaeche('abschnitte-fill', 9),
      flaeche('fachebene-dwd-fill', 1),
    ]) {
      expect(entscheideKlickziel([z, f], klick, projiziere), f.layer.id).toEqual({
        art: 'marker',
        merkmal: z,
      });
    }
  });

  it('unter mehreren Trefferzonen gewinnt die des nächsten Markers', () => {
    const fern = zoneVon('fern', 30);
    const nah = zoneVon('nah', 10);
    expect(entscheideKlickziel([fern, nah], klick, projiziere)).toEqual({
      art: 'marker',
      merkmal: nah,
    });
  });

  it('Markerzeichen über einer Zone: nur der Marker', () => {
    expect(entscheideKlickziel([einheit, flaeche('zonen-fill', 3)], klick, projiziere)).toEqual({
      art: 'marker',
      merkmal: einheit,
    });
  });

  it('ohne Punktziel und Trefferzone gewinnt die oberste Fläche', () => {
    const zone = flaeche('zonen-fill', 3);
    const abschnitt = flaeche('abschnitte-fill', 9);
    expect(entscheideKlickziel([zone, abschnitt], klick, projiziere)).toEqual({
      art: 'zone',
      merkmal: zone,
    });
    expect(entscheideKlickziel([abschnitt, zone], klick, projiziere)).toEqual({
      art: 'abschnitt',
      merkmal: abschnitt,
    });
    const dwd = flaeche('fachebene-dwd-fill', 1);
    expect(entscheideKlickziel([dwd, zone], klick, projiziere)).toEqual({
      art: 'fachebene',
      merkmal: dwd,
    });
  });

  it('unbekannte Ebenen zählen nicht', () => {
    const fremd = punkt('irgendwas', 0);
    expect(entscheideKlickziel([fremd, flaeche('zonen-fill', 3)], klick, projiziere)).toEqual({
      art: 'zone',
      merkmal: flaeche('zonen-fill', 3),
    });
  });

  // Aus `personenClusterTreffer` (LFH-648/711) übernommen: der Vorrang des sichtbaren Clusters.
  describe('Personen-Cluster', () => {
    const erwartet = { art: 'personenCluster', clusterId: 7, center: [11.5, 53.55], anzahl: 3 };

    it('fächert auf, wenn er das oberste Feature ist', () => {
      expect(entscheideKlickziel([personenCluster], klick, projiziere)).toEqual(erwartet);
    });

    it('ein Kräfte-Zeichen über dem Cluster gewinnt', () => {
      expect(entscheideKlickziel([einheit, personenCluster], klick, projiziere)).toEqual({
        art: 'marker',
        merkmal: einheit,
      });
    });

    it('eine bloße Trefferzone über dem Cluster zählt nicht', () => {
      for (const id of ['marker-treffer', 'marker-einsatzort-treffer', 'spider-treffer']) {
        expect(
          entscheideKlickziel([zoneVon('einsatzort', 20, id), personenCluster], klick, projiziere),
          id,
        ).toEqual(erwartet);
      }
    });

    it('ein gezeichnetes Zeichen über dem Cluster gewinnt auch unter einer Zone', () => {
      expect(
        entscheideKlickziel(
          [zoneVon('einheit-1', 20), einheit, personenCluster],
          klick,
          projiziere,
        ),
      ).toEqual({ art: 'marker', merkmal: einheit });
    });
  });
});

describe('ordneKlickebene', () => {
  it('ordnet Punktziele, Trefferzonen und Flächen', () => {
    expect(ordneKlickebene('marker-symbol')).toBe('marker');
    expect(ordneKlickebene('personen-treffer')).toBe('treffer');
    expect(ordneKlickebene('personen-cluster-zahl')).toBe('personenCluster');
    expect(ordneKlickebene('fachebene-kritis-buendel')).toBe('fachebene');
    expect(ordneKlickebene('fachebene-kritis-circle')).toBe('fachebene');
    expect(ordneKlickebene('fachebene-dwd-fill')).toBe('fachebeneFlaeche');
    expect(ordneKlickebene('zonen-line-gestrichelt')).toBe('zone');
    expect(ordneKlickebene('abschnitte-fill')).toBe('abschnitt');
    expect(ordneKlickebene('irgendwas')).toBeNull();
  });
});

/**
 * Eine Klickebene ohne Einordnung wäre still tot: ihr Hörer gälte nie als Gewinner. Deshalb muss
 * jede Ebene, an der ein Klick-Hörer hängt, eine Rolle haben — auch jede künftige Fachebene.
 */
describe('Klickebenen-Guard (LFH-764)', () => {
  it('ordnet jede Klickebene der Lagekarte ein', () => {
    const ebenen = [
      ...MARKER_KLICK_LAYER,
      ...SPIDER_KLICK_LAYER,
      ...PERSONEN_CLUSTER_KLICK_LAYER,
      ...ZONEN_KLICK_LAYER,
      ABSCHNITT_KLICK_LAYER,
      ...Object.values(FACHEBENEN).flatMap((def) => fachebeneClickLayerIds(def)),
    ];
    const ohne = ebenen.filter((id) => ordneKlickebene(id) === null);
    expect(ohne).toEqual([]);
    // Die Fachebenen tragen Punkte UND Flächen — sonst prüfte der Guard nur eine Sorte.
    expect(ebenen.some((id) => ordneKlickebene(id) === 'fachebene')).toBe(true);
    expect(ebenen.some((id) => ordneKlickebene(id) === 'fachebeneFlaeche')).toBe(true);
  });
});
