import { describe, expect, it } from 'vitest';
import type { KarteMarker } from './marker';
import { geortetEintraege } from './geortet';

const marker = (schluessel: string, label: string, extra: Partial<KarteMarker> = {}) =>
  ({
    schluessel,
    label,
    typ: 'fahrzeug',
    id: 1,
    lat: 52,
    lon: 9,
    farbe: '#555',
    ...extra,
  }) as KarteMarker;

describe('Liste „Geortet“ (Helfer-App)', () => {
  it('nennt nur automatisch geortete Ziele, nach Namen, mit Quelle, Alter und Veraltet', () => {
    const eintraege = geortetEintraege([
      marker('fahrzeug-1', 'RK 1/83-1', { untertitel: 'Helfer-App · vor 6 min', deckkraft: 0.5 }),
      marker('einheit-2', 'Zug 1'),
      marker('einheit-3', 'Bereitschaft', { untertitel: 'Ortung · vor 1 min' }),
    ]);
    expect(eintraege).toEqual([
      {
        schluessel: 'einheit-3',
        label: 'Bereitschaft',
        quelle: 'Ortung · vor 1 min',
        veraltet: false,
      },
      {
        schluessel: 'fahrzeug-1',
        label: 'RK 1/83-1',
        quelle: 'Helfer-App · vor 6 min',
        veraltet: true,
      },
    ]);
  });
});
