import { describe, expect, it } from 'vitest';
import { theme } from 'antd';
import {
  buildSammelstelleMarker,
  sammelstelleKartenLabel,
  type SammelstelleKartenEintrag,
} from './sammelstelleMarker';
import { rollenFarbe } from '../../theme/statusFarben';
import { markerZeichen } from './markerIcons';

const token = theme.getDesignToken();

function bezirk(teil: Partial<SammelstelleKartenEintrag> = {}): SammelstelleKartenEintrag {
  return {
    id: 4,
    bezeichnung: 'Nord',
    raeumung: 'laeuft',
    sammelstelle: 'Parkplatz Sporthalle',
    ...teil,
  };
}

describe('buildSammelstelleMarker (LLH-1393)', () => {
  it('eine verortete Sammelstelle steht als Marker mit Bezirksnamen, ohne Kurzzeichen', () => {
    const { verortet, nichtVerortet } = buildSammelstelleMarker(
      [bezirk({ sammelstelle_lat: 51.93, sammelstelle_lon: 8.87 })],
      token,
    );
    expect(nichtVerortet).toEqual([]);
    expect(verortet).toEqual([
      {
        schluessel: 'sammelstelle-4',
        typ: 'sammelstelle',
        id: 4,
        lat: 51.93,
        lon: 8.87,
        label: 'Sammelstelle Nord',
        farbe: rollenFarbe('bedien', token),
        trefferDurchmesser: token.controlHeight,
      },
    ]);
  });

  it('mit Freitext, aber ohne Koordinate: „Nicht verortet“', () => {
    const { verortet, nichtVerortet } = buildSammelstelleMarker([bezirk()], token);
    expect(verortet).toEqual([]);
    expect(nichtVerortet).toEqual([{ typ: 'sammelstelle', id: 4, label: 'Sammelstelle Nord' }]);
  });

  it('ohne Freitext und Koordinate erscheint nichts', () => {
    const r = buildSammelstelleMarker(
      [bezirk({ sammelstelle: null }), bezirk({ sammelstelle: '  ' })],
      token,
    );
    expect(r).toEqual({ verortet: [], nichtVerortet: [] });
  });

  it('stornierte und aufgehobene Bezirke fallen heraus, ein geräumter bleibt', () => {
    const punkt = { sammelstelle_lat: 1, sammelstelle_lon: 2 };
    const { verortet } = buildSammelstelleMarker(
      [
        bezirk({ id: 1, ...punkt, storniert_at: '2026-11-02T10:00:00Z' }),
        bezirk({ id: 2, ...punkt, raeumung: 'aufgehoben' }),
        bezirk({ id: 3, ...punkt, raeumung: 'geraeumt' }),
      ],
      token,
    );
    expect(verortet.map((m) => m.id)).toEqual([3]);
  });

  it('das Zeichen ist die Stelle mit „Sammelplatz für Betroffene“ (F.3.12), vermessen', () => {
    const z = markerZeichen({ typ: 'sammelstelle' });
    expect(z?.schluessel).toContain('circle-double-arrow-lower-v');
    expect(z?.schluessel).toContain('circle-12');
    expect(z?.drawing.derivations ?? []).toEqual([]);
  });

  it('Label nennt den Bezirk', () => {
    expect(sammelstelleKartenLabel({ bezeichnung: 'Bezirk 3' })).toBe('Sammelstelle Bezirk 3');
  });
});
