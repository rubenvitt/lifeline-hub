import { describe, expect, it } from 'vitest';
import { artOptionen, fruehereArten, GAENGIGE_ARTEN, schnellwahlArten } from './artVorschlaege';

const n = (id: number, art: string, angefordert_at: string) => ({ id, art, angefordert_at });

describe('fruehereArten', () => {
  it('ordnet nach Häufigkeit, bei Gleichstand die jüngste zuerst', () => {
    expect(
      fruehereArten([
        n(1, 'Sandsäcke', '2026-10-21 08:00:00'),
        n(2, 'RTW', '2026-10-21 08:10:00'),
        n(3, 'RTW', '2026-10-21 08:20:00'),
        n(4, 'Tauchpumpe', '2026-10-21 09:00:00'),
      ]),
    ).toEqual(['RTW', 'Tauchpumpe', 'Sandsäcke']);
  });

  it('fasst Schreibweisen zusammen und nimmt die der jüngsten Anforderung', () => {
    expect(
      fruehereArten([
        n(1, 'rtw ', '2026-10-21 08:00:00'),
        n(2, 'RTW', '2026-10-21 08:30:00'),
        n(3, '  ', '2026-10-21 09:00:00'),
      ]),
    ).toEqual(['RTW']);
  });
});

describe('schnellwahlArten', () => {
  it('füllt einen neuen Einsatz aus der festen Liste', () => {
    expect(schnellwahlArten([])).toEqual(['RTW', 'KTW', 'NEF', 'LF 10', 'HLF 20', 'DLK 23-12']);
  });

  it('stellt die häufigsten des Einsatzes vorn und doppelt nichts', () => {
    expect(schnellwahlArten(['Sandsäcke', 'rtw'])).toEqual([
      'Sandsäcke',
      'rtw',
      'KTW',
      'NEF',
      'LF 10',
      'HLF 20',
    ]);
  });

  it('füllt nach dem Einsatz mit den üblichen Arten der Organisation, dann der festen Liste (LLH-1379)', () => {
    expect(schnellwahlArten(['Feldbetten'], ['Sandsäcke', 'feldbetten', 'Tauchpumpe'])).toEqual([
      'Feldbetten',
      'Sandsäcke',
      'Tauchpumpe',
      'RTW',
      'KTW',
      'NEF',
    ]);
  });

  it('ein neuer Einsatz zeigt die in der Organisation üblichen Arten', () => {
    expect(schnellwahlArten([], ['Sandsäcke', 'Tauchpumpe'])).toEqual([
      'Sandsäcke',
      'Tauchpumpe',
      'RTW',
      'KTW',
      'NEF',
      'LF 10',
    ]);
  });
});

describe('artOptionen', () => {
  it('gruppiert frühere Arten, Einheitstypen und die feste Liste, entdoppelt', () => {
    const gruppen = artOptionen(
      ['Sandsäcke', 'Dolmetscher'],
      [
        { label: 'Zug', sortier: 40 },
        { label: 'Gruppe', sortier: 30 },
        { label: 'sandsäcke', sortier: 99 },
      ],
    );
    expect(gruppen.map((g) => g.label)).toEqual([
      'In diesem Einsatz',
      'Einheitstypen',
      'Kräfte und Mittel',
    ]);
    expect(gruppen[0].options.map((o) => o.value)).toEqual(['Sandsäcke', 'Dolmetscher']);
    expect(gruppen[1].options.map((o) => o.value)).toEqual(['Gruppe', 'Zug']);
    expect(gruppen[2].options.map((o) => o.value)).toEqual(
      GAENGIGE_ARTEN.filter((a) => a !== 'Sandsäcke'),
    );
  });

  it('stellt die üblichen Arten der Organisation hinter den Einsatz (LLH-1379)', () => {
    const gruppen = artOptionen(
      ['Feldbetten'],
      [{ label: 'Zug', sortier: 1 }],
      ['feldbetten', 'Notstromaggregat'],
    );
    expect(gruppen.map((g) => g.label)).toEqual([
      'In diesem Einsatz',
      'In der Organisation',
      'Einheitstypen',
      'Kräfte und Mittel',
    ]);
    expect(gruppen[1].options.map((o) => o.value)).toEqual(['Notstromaggregat']);
  });

  it('lässt leere Gruppen weg', () => {
    expect(artOptionen([], []).map((g) => g.label)).toEqual(['Kräfte und Mittel']);
  });
});
