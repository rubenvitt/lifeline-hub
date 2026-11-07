import { describe, expect, it } from 'vitest';
import { kurzVerbleib, SK_META, STATUS_META } from './personMeta';

describe('personMeta', () => {
  it('SK_META deckt alle Sichtungskategorien ab', () => {
    expect(Object.keys(SK_META).sort()).toEqual(
      ['sk1', 'sk2', 'sk3', 'sk4', 'tot', 'unverletzt'].sort(),
    );
    expect(SK_META.sk1).toEqual({ label: 'SK I', farbe: 'rot' });
    expect(SK_META.tot).toEqual({ label: 'tot', farbe: 'schwarz' });
  });

  it('STATUS_META deckt alle Personenstatus ab', () => {
    expect(Object.keys(STATUS_META).sort()).toEqual(
      ['abgemeldet', 'betroffen', 'erfasst', 'verstorben', 'vermisst'].sort(),
    );
    expect(STATUS_META.vermisst).toEqual({ label: 'vermisst', rolle: 'achtung' });
    for (const status of ['erfasst', 'betroffen', 'verstorben', 'abgemeldet'] as const) {
      expect(STATUS_META[status].rolle).toBe('neutral');
    }
  });
});

describe('kurzVerbleib (LLH-1332)', () => {
  const t = { art: 'transport' as const, ziel: 'KH Mitte', transportmittel: '1/83-1' };
  it('nennt Eigentransport und quittierte Übergabe wie die Kurzform des Servers', () => {
    expect(kurzVerbleib({ ...t, transport_durch: 'fremd' })).toBe('Transport → KH Mitte (1/83-1)');
    expect(kurzVerbleib({ ...t, transport_durch: 'eigen', status: 'abtransportiert' })).toBe(
      'Eigentransport → KH Mitte (1/83-1)',
    );
    expect(kurzVerbleib({ ...t, transport_durch: 'eigen', status: 'uebergeben' })).toBe(
      'übergeben → KH Mitte (1/83-1)',
    );
  });
});

describe('kurzVerbleib mit Angaben (LLH-1568, Spec `verbleib-angaben`)', () => {
  const e = { art: 'entlassung' as const, ziel: null, transportmittel: null };
  it('nennt, an wen entlassen wurde', () => {
    expect(kurzVerbleib(e)).toBe('entlassen');
    expect(kurzVerbleib({ ...e, entlassen_an: 'polizei' })).toBe('entlassen an Polizei');
    expect(kurzVerbleib({ ...e, entlassen_an: 'begleitung' })).toBe(
      'entlassen an Angehörige / Begleitung',
    );
    expect(kurzVerbleib({ ...e, entlassen_an: 'selbst' })).toBe('entlassen, geht selbst');
  });
  it('hängt gegen Rat mit Unterschrift an', () => {
    expect(kurzVerbleib({ ...e, gegen_rat: 'transport', unterschrift: 'liegt_vor' })).toBe(
      'entlassen · gegen Rat: Transport abgelehnt, Unterschrift liegt vor',
    );
    expect(kurzVerbleib({ ...e, gegen_rat: 'behandlung' })).toBe(
      'entlassen · gegen Rat: Behandlung abgelehnt',
    );
  });
  it('nennt die Einsatznummer der Leitstelle beim Transport', () => {
    expect(
      kurzVerbleib({
        art: 'transport',
        ziel: 'KH Mitte',
        transportmittel: 'RTW 3/83-2',
        transport_durch: 'fremd',
        leitstelle_einsatznummer: '2611-0815',
      }),
    ).toBe('Transport → KH Mitte (RTW 3/83-2) · Einsatznr. 2611-0815');
  });
});
