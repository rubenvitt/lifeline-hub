import { describe, expect, it } from 'vitest';
import type { FeatureCollection } from '../../api/fachebenen';
import { dwdGueltigkeit, istAngekuendigt } from './dwdGueltigkeit';

const UM_15 = Date.parse('2026-09-23T15:00:00Z');

function warnung(event: string, p: Record<string, unknown> = {}) {
  return {
    type: 'Feature',
    geometry: { type: 'Polygon', coordinates: [] },
    properties: { EVENT: event, ...p },
  };
}

const fc = (...features: ReturnType<typeof warnung>[]): FeatureCollection => ({
  type: 'FeatureCollection',
  features,
});

const events = (c: FeatureCollection) => c.features.map((f) => f.properties.EVENT);

describe('dwdGueltigkeit (LFH-662)', () => {
  it('entfernt abgelaufene Warnungen, auch genau auf dem Ende', () => {
    const r = dwdGueltigkeit(
      fc(
        warnung('FROST', { EXPIRES: '2026-09-23T14:00:00Z' }),
        warnung('GENAU', { EXPIRES: '2026-09-23T15:00:00Z' }),
        warnung('STURM', { EXPIRES: '2026-09-23T18:00:00Z' }),
      ),
      UM_15,
    );
    expect(events(r)).toEqual(['STURM']);
  });

  it('vergleicht ein Ende mit Offset als Zeitpunkt', () => {
    // 16:30+02:00 = 14:30 UTC → abgelaufen; 17:30+02:00 = 15:30 UTC → gilt.
    const r = dwdGueltigkeit(
      fc(
        warnung('FROST', { EXPIRES: '2026-09-23T16:30:00+02:00' }),
        warnung('STURM', { EXPIRES: '2026-09-23T17:30:00+02:00' }),
      ),
      UM_15,
    );
    expect(events(r)).toEqual(['STURM']);
  });

  it('behält Warnungen ohne oder mit unlesbarem Ende', () => {
    const r = dwdGueltigkeit(
      fc(warnung('FEHLT'), warnung('NULL', { EXPIRES: null }), warnung('KAPUTT', { EXPIRES: 'x' })),
      UM_15,
    );
    expect(events(r)).toEqual(['FEHLT', 'NULL', 'KAPUTT']);
  });

  it('markiert Warnungen mit Beginn in der Zukunft als angekündigt', () => {
    const r = dwdGueltigkeit(
      fc(
        warnung('ABEND', { ONSET: '2026-09-23T18:00:00Z' }),
        warnung('JETZT', { ONSET: '2026-09-23T15:00:00Z' }),
        warnung('SEIT', { ONSET: '2026-09-23T12:00:00Z' }),
        warnung('OHNE'),
        warnung('KAPUTT', { ONSET: 'x' }),
      ),
      UM_15,
    );
    expect(r.features.map((f) => [f.properties.EVENT, f.properties.angekuendigt ?? null])).toEqual([
      ['ABEND', true],
      // Genau auf dem Beginn gilt die Warnung schon.
      ['JETZT', null],
      ['SEIT', null],
      ['OHNE', null],
      ['KAPUTT', null],
    ]);
  });

  it('lässt die Eingabe unverändert', () => {
    const ein = fc(
      warnung('FROST', { EXPIRES: '2026-09-23T14:00:00Z' }),
      warnung('ABEND', { ONSET: '2026-09-23T18:00:00Z' }),
    );
    const kopie = structuredClone(ein);
    dwdGueltigkeit(ein, UM_15);
    expect(ein).toEqual(kopie);
  });

  it('gibt ohne Änderung dieselbe Referenz zurück', () => {
    const ein = fc(warnung('STURM', { EXPIRES: '2026-09-23T18:00:00Z' }));
    expect(dwdGueltigkeit(ein, UM_15)).toBe(ein);
  });

  it('beginnt eine angekündigte Warnung, fällt die Markierung weg', () => {
    const ein = fc(warnung('ABEND', { ONSET: '2026-09-23T18:00:00Z' }));
    expect(dwdGueltigkeit(ein, UM_15).features[0].properties.angekuendigt).toBe(true);
    const spaeter = dwdGueltigkeit(ein, Date.parse('2026-09-23T18:01:00Z'));
    expect(spaeter.features[0].properties.angekuendigt).toBeUndefined();
  });
});

describe('istAngekuendigt', () => {
  it('entscheidet über ONSET > jetzt', () => {
    expect(istAngekuendigt({ ONSET: '2026-09-23T18:00:00Z' }, UM_15)).toBe(true);
    expect(istAngekuendigt({ ONSET: '2026-09-23T15:00:00Z' }, UM_15)).toBe(false);
    expect(istAngekuendigt({}, UM_15)).toBe(false);
    expect(istAngekuendigt({ ONSET: 42 }, UM_15)).toBe(false);
  });
});
