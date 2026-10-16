import { describe, it, expect } from 'vitest';
import { serializeAnySpec } from '@einsatzzeichen/core';
import { freiesZeichen } from '../../zeichen/freiesZeichen';
import { baueZeichenRegistry, kartenPixelRatio, markerIconKey, markerZeichen } from './markerIcons';

// LFH-835/LFH-836 (design.md D8): Fachobjekte und freie Zeichen zeichnet @einsatzzeichen (`ez|`).
// Der Schlüssel entsteht aus der WIRKSAMEN Spec; gleiche Spec heißt gleicher Schlüssel, auch über
// Fachobjekte und freie Zeichen hinweg.
describe('markerIconKey', () => {
  it('nimmt für ein freies Zeichen den Schlüssel des Leseadapters', () => {
    const z = {
      zeichen_spec: serializeAnySpec({ kind: 'pictogram', pictogram: 'capability.lighting' }),
    };
    expect(markerIconKey({ typ: 'freies_zeichen', freiesZeichen: z })).toBe(
      freiesZeichen(z).schluessel,
    );
    expect(markerIconKey({ typ: 'freies_zeichen', freiesZeichen: z })?.startsWith('ez|')).toBe(
      true,
    );
  });

  it('nimmt für ein freies Zeichen im Altformat ebenfalls den ez|-Schlüssel', () => {
    const alt = { grundzeichen: 'stelle', symbol: 'sammeln' };
    expect(markerIconKey({ typ: 'freies_zeichen', freiesZeichen: alt })).toBe(
      freiesZeichen(alt).schluessel,
    );
  });

  it('gibt Fachobjekt und freiem Zeichen mit gleicher Spec denselben Schlüssel', () => {
    const fachobjekt = markerIconKey({ typ: 'einsatzort', tz: { grundzeichen: 'anlass' } });
    const frei = markerIconKey({
      typ: 'freies_zeichen',
      freiesZeichen: { zeichen_spec: serializeAnySpec({ kind: 'event' }) },
    });
    expect(frei).toBe(fachobjekt);
    // Auch das Altformat desselben Zeichens landet auf demselben Bild.
    expect(
      markerIconKey({ typ: 'freies_zeichen', freiesZeichen: { grundzeichen: 'anlass' } }),
    ).toBe(fachobjekt);
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

  it('lässt den Schlüssel ohne Zeichen oder ohne darstellbaren Körper weg (Kreis)', () => {
    expect(markerIconKey({ typ: 'lagemeldung' })).toBeUndefined();
    expect(
      markerIconKey({ typ: 'uhs', tz: { grundzeichen: 'gibt-es-nicht' as 'stelle' } }),
    ).toBeUndefined();
  });

  it('gibt einem nicht darstellbaren freien Zeichen den Platzhalter, nie keinen Schlüssel', () => {
    // Spec `lagekarte-taktische-zeichen`: der Platzhalter bleibt auswählbar und löschbar.
    expect(
      markerIconKey({ typ: 'freies_zeichen', freiesZeichen: { symbol: 'gibt-es-nicht' } }),
    ).toBe('ez|{"v":1,"spec":{"kind":"point"}}');
  });
});

describe('markerZeichen', () => {
  it('liefert Schlüssel und Zeichnung aus derselben Quelle wie markerIconKey', () => {
    const mk = { typ: 'einheit', tz: { grundzeichen: 'taktische-formation' } } as const;
    expect(markerZeichen(mk)?.schluessel).toBe(markerIconKey(mk));
    expect(markerZeichen(mk)?.drawing).toBeDefined();
    expect(markerZeichen({ typ: 'einheit' })).toBeNull();
  });
});

describe('baueZeichenRegistry', () => {
  it('ordnet jedem Bildschlüssel seine Zeichnung zu, gleiche Zeichen einmal', () => {
    const person = { zeichen_spec: serializeAnySpec({ kind: 'person' }) };
    const reg = baueZeichenRegistry([
      { typ: 'einsatzort', tz: { grundzeichen: 'anlass' } },
      { typ: 'schaden', tz: { grundzeichen: 'anlass' } },
      { typ: 'freies_zeichen', freiesZeichen: person },
      { typ: 'freies_zeichen', freiesZeichen: { grundzeichen: 'anlass' } },
      { typ: 'lagemeldung' },
    ]);
    expect([...reg.keys()]).toEqual([
      'ez|{"v":1,"spec":{"kind":"event"}}',
      'ez|{"v":1,"spec":{"kind":"person"}}',
    ]);
    expect(reg.get('ez|{"v":1,"spec":{"kind":"person"}}')).toBe(freiesZeichen(person).drawing);
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
