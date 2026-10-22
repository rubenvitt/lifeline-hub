import { describe, it, expect } from 'vitest';
import { serializeAnySpec } from '@einsatzzeichen/core';
import { freiesZeichen } from '../../zeichen/freiesZeichen';
import {
  baueZeichenRegistry,
  bildMitUnterlage,
  kartenPixelRatio,
  markerIconKey,
  markerZeichen,
} from './markerIcons';

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

  it('zeichnet einen Bereitstellungsraum mit dem Raumzeichen D.2.1, ohne `tz` (LLH-1107)', () => {
    const z = markerZeichen({ typ: 'bereitstellungsraum' });
    expect(z?.schluessel).toBe(
      `ez|${serializeAnySpec({ kind: 'pictogram', pictogram: 'leadership.staging-area' })}`,
    );
    expect(markerIconKey({ typ: 'bereitstellungsraum' })).toBe(z?.schluessel);
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

// LLH-1141: auf dunkler Kartengrundlage trägt jedes Zeichen die helle Unterlage. Das Thema steht
// im Bildschlüssel: ein Wechsel Nacht ↔ Tag gibt jedem Marker ein anderes Bild, das der Resolver
// neu rastert, ohne dass die Seite neu lädt. Am Tag bleibt der Schlüssel, wie er war.
describe('Bildschlüssel nach Kartenthema (LLH-1141)', () => {
  const einheit = { typ: 'einheit', tz: { grundzeichen: 'taktische-formation' } } as const;
  const frei = { typ: 'freies_zeichen', freiesZeichen: { grundzeichen: 'anlass' } } as const;

  it('lässt den Schlüssel am Tag unverändert (ohne Unterlage)', () => {
    expect(markerIconKey(einheit, 'light')).toBe(markerIconKey(einheit));
    expect(markerIconKey(einheit, 'light')).toBe(markerZeichen(einheit)?.schluessel);
    expect(bildMitUnterlage(markerIconKey(einheit, 'light')!)).toBe(false);
  });

  it('gibt nachts jedem Zeichen, auch einem freien, einen eigenen Schlüssel mit Unterlage', () => {
    for (const mk of [einheit, frei, { typ: 'bereitstellungsraum' } as const]) {
      const nacht = markerIconKey(mk, 'dark')!;
      expect(nacht).not.toBe(markerIconKey(mk, 'light'));
      expect(nacht.startsWith('ez|')).toBe(true);
      expect(bildMitUnterlage(nacht)).toBe(true);
    }
  });

  it('baut die Registry nachts unter denselben Schlüsseln wie die Feature-Property', () => {
    const reg = baueZeichenRegistry([einheit, frei, { typ: 'lagemeldung' }], 'dark');
    expect([...reg.keys()]).toEqual([markerIconKey(einheit, 'dark'), markerIconKey(frei, 'dark')]);
    expect(reg.get(markerIconKey(einheit, 'dark')!)).toBe(markerZeichen(einheit)?.drawing);
  });

  it('kennt nur die eigenen Schlüssel als Bilder mit Unterlage', () => {
    expect(bildMitUnterlage('plakette|x')).toBe(false);
    expect(bildMitUnterlage('ez|{"v":1,"spec":{"kind":"event"}}')).toBe(false);
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
