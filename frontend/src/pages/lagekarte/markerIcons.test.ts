import { describe, it, expect } from 'vitest';
import { baueZeichenRegistry, kartenPixelRatio, markerIconKey, tzIconKey } from './markerIcons';

describe('tzIconKey', () => {
  it('ist deterministisch für gleiche TzProps', () => {
    expect(tzIconKey({ grundzeichen: 'anlass' })).toBe(tzIconKey({ grundzeichen: 'anlass' }));
  });

  it('beginnt mit dem tz|-Präfix (für den styleimagemissing-Filter)', () => {
    expect(tzIconKey({ grundzeichen: 'anlass' }).startsWith('tz|')).toBe(true);
  });

  it('unterscheidet sich bei abweichender farbe', () => {
    expect(tzIconKey({ grundzeichen: 'gefahr', farbe: '#f5222d' })).not.toBe(
      tzIconKey({ grundzeichen: 'gefahr', farbe: '#faad14' }),
    );
  });

  it('unterscheidet sich bei symbol/fachaufgabe/organisation/einheit', () => {
    const base = { grundzeichen: 'stelle' } as const;
    expect(tzIconKey({ ...base, symbol: 'sammeln' })).not.toBe(
      tzIconKey({ ...base, symbol: 'sammelplatz-betroffene' }),
    );
    expect(tzIconKey({ ...base, fachaufgabe: 'fuehrung' })).not.toBe(tzIconKey(base));
    expect(tzIconKey({ grundzeichen: 'taktische-formation', einheit: 'zug' })).not.toBe(
      tzIconKey({ grundzeichen: 'taktische-formation', einheit: 'gruppe' }),
    );
  });

  it('unterscheidet sich bei funktion (LFH-172, sonst Icon-Dedup-Kollision)', () => {
    expect(tzIconKey({ grundzeichen: 'person', funktion: 'fuehrungskraft' })).not.toBe(
      tzIconKey({ grundzeichen: 'person' }),
    );
  });
});

// LFH-835 (design.md D5): Fachobjekte zeichnet @einsatzzeichen (`ez|`), freie Zeichen bis LFH-836
// das Altpaket (`tz|`). Der Schlüssel des Fachobjekts entsteht aus der WIRKSAMEN Spec.
describe('markerIconKey', () => {
  it('nimmt für ein freies Zeichen den Schlüssel des Altpakets', () => {
    expect(
      markerIconKey({ typ: 'freies_zeichen', tz: { grundzeichen: 'stelle', symbol: 'sammeln' } }),
    ).toBe(tzIconKey({ grundzeichen: 'stelle', symbol: 'sammeln' }));
  });

  it('nimmt für ein Fachobjekt den Schlüssel der wirksamen @einsatzzeichen-Spec', () => {
    expect(markerIconKey({ typ: 'einsatzort', tz: { grundzeichen: 'anlass' } })).toBe(
      'ez|{"v":1,"spec":{"kind":"event"}}',
    );
  });

  it('gibt Fachobjekten mit gleicher wirksamer Spec denselben Schlüssel', () => {
    // Die Fachaufgabe „Führung“ bildet auf nichts ab — beide zeichnen dasselbe Kfz.
    expect(
      markerIconKey({
        typ: 'fahrzeug',
        tz: {
          grundzeichen: 'kraftfahrzeug-landgebunden',
          organisation: 'thw',
          fachaufgabe: 'fuehrung',
        },
      }),
    ).toBe(
      markerIconKey({
        typ: 'fahrzeug',
        tz: { grundzeichen: 'kraftfahrzeug-landgebunden', organisation: 'thw' },
      }),
    );
  });

  it('lässt den Schlüssel ohne tz oder ohne darstellbaren Körper weg (Kreis)', () => {
    expect(markerIconKey({ typ: 'lagemeldung' })).toBeUndefined();
    expect(
      markerIconKey({ typ: 'uhs', tz: { grundzeichen: 'gibt-es-nicht' as 'stelle' } }),
    ).toBeUndefined();
  });
});

describe('baueZeichenRegistry', () => {
  it('ordnet jedem Bildschlüssel seine Quelle zu, gleiche Zeichen einmal', () => {
    const reg = baueZeichenRegistry([
      { typ: 'einsatzort', tz: { grundzeichen: 'anlass' } },
      { typ: 'schaden', tz: { grundzeichen: 'anlass' } },
      { typ: 'freies_zeichen', tz: { grundzeichen: 'person' } },
      { typ: 'lagemeldung' },
    ]);
    expect([...reg.keys()]).toEqual([
      'ez|{"v":1,"spec":{"kind":"event"}}',
      tzIconKey({ grundzeichen: 'person' }),
    ]);
    expect(reg.get('ez|{"v":1,"spec":{"kind":"event"}}')?.art).toBe('ez');
    expect(reg.get(tzIconKey({ grundzeichen: 'person' }))).toEqual({
      art: 'tz',
      tz: { grundzeichen: 'person' },
    });
  });
});

describe('kartenPixelRatio', () => {
  it('rundet die Pixeldichte auf eine ganze Zahl auf, mindestens 1', () => {
    // size × pixelRatio muss ganzzahlig sein, sonst wirft @einsatzzeichen/maplibre.
    expect(kartenPixelRatio(1)).toBe(1);
    expect(kartenPixelRatio(1.25)).toBe(2);
    expect(kartenPixelRatio(2)).toBe(2);
    expect(kartenPixelRatio(0.5)).toBe(1);
    expect(kartenPixelRatio(Number.NaN)).toBe(1);
  });
});
