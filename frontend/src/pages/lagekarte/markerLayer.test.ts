import { describe, it, expect } from 'vitest';
import { baueMarkerFc, baueEinsatzortFc } from './markerLayer';
import type { KarteMarker } from './marker';

const mk = (p: Partial<KarteMarker>): KarteMarker => ({
  schluessel: 'x', typ: 'uhs', id: 1, lat: 50, lon: 8, label: 'X', farbe: '#000', ...p,
});

describe('baueMarkerFc', () => {
  it('nimmt den Einsatzort aus (wird separat, ungeclustert gerendert)', () => {
    const fc = baueMarkerFc([
      mk({ schluessel: 'einsatzort', typ: 'einsatzort' }),
      mk({ schluessel: 'uhs-5' }),
    ]);
    expect(fc.features.map((f) => f.properties.schluessel)).toEqual(['uhs-5']);
  });

  it('setzt icon für TZ-Marker und statusFarbe für Fahrzeuge', () => {
    const fc = baueMarkerFc([mk({
      schluessel: 'fahrzeug-1', typ: 'fahrzeug',
      tz: { grundzeichen: 'kraftfahrzeug-landgebunden' }, statusFarbe: '#00ff00',
    })]);
    expect(fc.features[0].properties.icon?.startsWith('tz|')).toBe(true);
    expect(fc.features[0].properties.statusFarbe).toBe('#00ff00');
  });

  it('lässt icon bei Lagemeldung (kein tz) weg → wird als Kreis gerendert', () => {
    const fc = baueMarkerFc([mk({ schluessel: 'lagemeldung-4', typ: 'lagemeldung' })]);
    expect(fc.features[0].properties.icon).toBeUndefined();
    expect(fc.features[0].properties.statusFarbe).toBeUndefined();
  });

  it('schreibt Point-Geometrie als [lon, lat]', () => {
    const fc = baueMarkerFc([mk({ lon: 8.6, lat: 50.1 })]);
    expect(fc.features[0].geometry).toEqual({ type: 'Point', coordinates: [8.6, 50.1] });
  });

  it('behält Reihenfolge und propagiert die Schaden-Farbe in die Properties', () => {
    const fc = baueMarkerFc([
      mk({ schluessel: 'uhs-5' }),
      mk({ schluessel: 'schaden-9', typ: 'schaden', farbe: '#f5222d', tz: { grundzeichen: 'gefahr', farbe: '#f5222d' } }),
    ]);
    expect(fc.features.map((f) => f.properties.schluessel)).toEqual(['uhs-5', 'schaden-9']);
    expect(fc.features[1].properties.farbe).toBe('#f5222d');
  });
});

describe('baueEinsatzortFc', () => {
  it('liefert genau den Einsatzort-Marker', () => {
    const fc = baueEinsatzortFc([
      mk({ schluessel: 'einsatzort', typ: 'einsatzort', tz: { grundzeichen: 'anlass' } }),
      mk({ schluessel: 'uhs-5' }),
    ]);
    expect(fc.features.map((f) => f.properties.schluessel)).toEqual(['einsatzort']);
    expect(fc.features[0].properties.icon?.startsWith('tz|')).toBe(true);
  });

  it('ist leer, wenn kein Einsatzort verortet ist', () => {
    expect(baueEinsatzortFc([mk({ schluessel: 'uhs-5' })]).features).toHaveLength(0);
  });
});
