import { describe, expect, it } from 'vitest';
import type { LageZone } from '../api/types';
import { PUNKT_ZOOM } from '../pages/lagekarte/startAnsicht';
import { zoneStil } from '../pages/lagekarte/zonenStil';
import { bezirkFlaechen } from './bezirkFlaechen';

const zone = (over: Partial<LageZone> & { id: number }): LageZone => ({
  einsatz_id: 1,
  typ: 'evakuierungsbezirk',
  geometrie_typ: 'Polygon',
  geometrie: JSON.stringify({
    type: 'Polygon',
    coordinates: [
      [
        [8.6, 50.1],
        [8.62, 50.1],
        [8.62, 50.12],
        [8.6, 50.1],
      ],
    ],
  }),
  erstellt_at: '2026-10-20 08:00:00',
  erstellt_von: 1,
  geaendert_at: '2026-10-20 08:00:00',
  ...over,
});

describe('bezirkFlaechen (LLH-1076)', () => {
  it('nimmt nur Zonen vom Typ Evakuierungsbezirk, die DIESEM Bezirk zugeordnet sind', () => {
    const f = bezirkFlaechen(
      [
        zone({ id: 1, evakuierungsbezirk_id: 5 }),
        zone({ id: 2, evakuierungsbezirk_id: 6 }),
        zone({ id: 3, evakuierungsbezirk_id: null }),
        zone({ id: 4, typ: 'sperrgebiet', evakuierungsbezirk_id: 5 }),
      ],
      5,
    );
    expect(f.anzahl).toBe(1);
    expect(f.zonen.features.map((x) => x.id)).toEqual([1]);
  });

  it('zeichnet im Zonenstil der Lagekarte, ohne Beschriftung', () => {
    const f = bezirkFlaechen([zone({ id: 1, evakuierungsbezirk_id: 5 })], 5);
    const stil = zoneStil('evakuierungsbezirk', null);
    expect(f.zonen.features[0].properties).toMatchObject({
      fillColor: stil.fillColor,
      lineColor: stil.lineColor,
    });
    expect(f.zonen.features[0].properties.label ?? '').toBe('');
  });

  it('rahmt alle Stützpunkte aller Teilflächen', () => {
    const zweite = zone({
      id: 2,
      evakuierungsbezirk_id: 5,
      geometrie: JSON.stringify({
        type: 'Polygon',
        coordinates: [
          [
            [8.7, 50.2],
            [8.71, 50.2],
            [8.71, 50.21],
            [8.7, 50.2],
          ],
        ],
      }),
    });
    const f = bezirkFlaechen([zone({ id: 1, evakuierungsbezirk_id: 5 }), zweite], 5);
    expect(f.anzahl).toBe(2);
    expect(f.ausschnitt).toEqual({ art: 'rahmen', west: 8.6, sued: 50.1, ost: 8.71, nord: 50.21 });
  });

  it('ein einzelner Punkt wird ein Punktausschnitt; ohne lesbare Fläche kein Ausschnitt', () => {
    const punkt = zone({
      id: 1,
      evakuierungsbezirk_id: 5,
      geometrie_typ: 'LineString',
      geometrie: JSON.stringify({ type: 'LineString', coordinates: [[8.6, 50.1]] }),
    });
    expect(bezirkFlaechen([punkt], 5).ausschnitt).toEqual({
      art: 'punkt',
      lon: 8.6,
      lat: 50.1,
      zoom: PUNKT_ZOOM,
    });
    const kaputt = zone({ id: 2, evakuierungsbezirk_id: 5, geometrie: '{nicht json' });
    const f = bezirkFlaechen([kaputt], 5);
    expect(f.anzahl).toBe(0);
    expect(f.ausschnitt).toBeNull();
  });
});
