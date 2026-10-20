import { describe, expect, it } from 'vitest';
import type { LayerSichtbar } from './Sidebar';
import {
  ebeneMitVorrang,
  EBENE_DES_AUFTRAGS,
  layerMitVorrang,
  rueckwegZiel,
  verortetKennung,
} from './verortungsauftrag';

const ALLE_AUS: LayerSichtbar = {
  einsatzort: false,
  fuehrungsstelle: false,
  uhs: false,
  schaden: false,
  einheit: false,
  fahrzeug: false,
  fuehrung: false,
  abschnitt: false,
  zone: false,
  lagemeldung: false,
  freies_zeichen: false,
  person: false,
  betreuungsstelle: false,
  bereitstellungsraum: false,
  tier: false,
};

describe('Ebenen-Vorrang des Verortungsauftrags (LLH-1125)', () => {
  it('jeder Auftragstyp hat seine Ebene', () => {
    expect(EBENE_DES_AUFTRAGS).toEqual({
      person: 'person',
      schaden: 'schaden',
      uhs: 'uhs',
      betreuungsstelle: 'betreuungsstelle',
      bereitstellungsraum: 'bereitstellungsraum',
      tier: 'tier',
    });
  });

  it('zeichnet die Ebene des Auftrags, ohne die gespeicherte Wahl anzufassen', () => {
    const layer = { ...ALLE_AUS };
    const effektiv = layerMitVorrang(layer, 'person');
    expect(effektiv.person).toBe(true);
    expect(effektiv.schaden).toBe(false);
    // Der Schalter (und damit die Ansicht) bleibt unverändert: kein „geändert“, nichts zu speichern.
    expect(layer.person).toBe(false);
    expect(effektiv).not.toBe(layer);
  });

  it('ohne Auftrag gilt die Wahl unverändert, dieselbe Identität', () => {
    const layer = { ...ALLE_AUS, schaden: true };
    expect(layerMitVorrang(layer, null)).toBe(layer);
  });

  it('„eingeblendet“ heißt nur die Ebene, die der Vorrang gegen den Schalter zeichnet', () => {
    expect(ebeneMitVorrang(ALLE_AUS, 'person')).toBe('person');
    expect(ebeneMitVorrang({ ...ALLE_AUS, person: true }, 'person')).toBeNull();
    expect(ebeneMitVorrang(ALLE_AUS, null)).toBeNull();
  });
});

describe('Rückmeldung nach dem Verorten (LLH-1125)', () => {
  const quellen = {
    personen: [{ id: 11, registrier_nr: 5 }],
    marker: [{ typ: 'schaden', id: 7, label: 'S-007' }],
    nichtVerortet: [{ typ: 'uhs', id: 2, label: 'UHS Nord' }],
  } as const;

  it('nennt die Kennung aus dem Objekt, das die Karte lädt', () => {
    expect(verortetKennung({ typ: 'person', id: 11 }, quellen)).toBe('R-005');
    expect(verortetKennung({ typ: 'schaden', id: 7 }, quellen)).toBe('S-007');
    // Kurz nach dem Verorten steht das Objekt noch in „Nicht verortet“.
    expect(verortetKennung({ typ: 'uhs', id: 2 }, quellen)).toBe('UHS Nord');
    expect(verortetKennung({ typ: 'einsatzort', id: 0 }, quellen)).toBe('Einsatzort');
  });

  it('ohne geladenes Objekt keine Kennung', () => {
    expect(verortetKennung({ typ: 'person', id: 99 }, quellen)).toBeNull();
    expect(verortetKennung({ typ: 'einheit', id: 3 }, quellen)).toBeNull();
  });

  it('der Rückweg folgt allein aus Typ und Kennung, nur mit Herkunft', () => {
    expect(rueckwegZiel(1, { typ: 'person', id: 11, zurueck: true })).toBe(
      '/einsaetze/1/personen/11',
    );
    expect(rueckwegZiel(1, { typ: 'schaden', id: 7, zurueck: true })).toBe(
      '/einsaetze/1/schaeden/7',
    );
    expect(rueckwegZiel(1, { typ: 'person', id: 11, zurueck: false })).toBeNull();
    // Typen ohne äußeren Einstieg haben kein Ziel, auch wenn der Merker gesetzt wäre.
    expect(rueckwegZiel(1, { typ: 'einheit', id: 3, zurueck: true })).toBeNull();
    expect(rueckwegZiel(1, { typ: 'einsatzort', id: 0, zurueck: true })).toBeNull();
    expect(rueckwegZiel(1, { typ: 'uhs', id: 2, zurueck: true })).toBeNull();
  });
});
