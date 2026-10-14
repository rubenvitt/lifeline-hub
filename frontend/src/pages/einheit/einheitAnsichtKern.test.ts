import { describe, expect, it } from 'vitest';
import type { Einheit, ModulFreigaben } from '../../api/types';
import { buildEinheitRechte, collectNachfahren, type EinheitRechte } from './einheitAnsichtKern';

const einheit = (id: number, ueber: number | null) =>
  ({ id, ueber_einheit_id: ueber }) as unknown as Einheit;

describe('collectNachfahren', () => {
  it('nimmt die Einheit selbst und eine Kette darunter', () => {
    const bestand = [einheit(1, null), einheit(2, 1), einheit(3, 2), einheit(4, null)];
    expect([...collectNachfahren(bestand, 1)].sort()).toEqual([1, 2, 3]);
  });

  it('folgt jeder Verzweigung, nicht den Geschwistern darüber', () => {
    const bestand = [
      einheit(1, null),
      einheit(2, 1),
      einheit(3, 1),
      einheit(4, 3),
      einheit(5, null),
    ];
    expect([...collectNachfahren(bestand, 1)].sort()).toEqual([1, 2, 3, 4]);
    expect([...collectNachfahren(bestand, 3)].sort()).toEqual([3, 4]);
  });

  it('bricht an einem Kreis im Bestand nicht', () => {
    const bestand = [einheit(1, 3), einheit(2, 1), einheit(3, 2)];
    expect([...collectNachfahren(bestand, 1)].sort()).toEqual([1, 2, 3]);
  });
});

/** Freigaben wie `GET …/modul-freigaben`: nur `zugriff` zählt, hier für die vier Module. */
function freigaben(gesperrt: string[] = []): ModulFreigaben {
  return Object.fromEntries(
    ['einheiten', 'personal', 'fahrzeuge', 'material'].map((key) => [
      key,
      { zugriff: !gesperrt.includes(key) },
    ]),
  ) as unknown as ModulFreigaben;
}

const ALLES: EinheitRechte = {
  canEditEinheit: true,
  canZuordnenPersonalEinsatz: true,
  canZuordnenPersonalStamm: true,
  canZuordnenFahrzeugEinsatz: true,
  canZuordnenFahrzeugStamm: true,
  canEditBesatzung: true,
  canZuordnenMaterial: true,
  hasPersonalLink: true,
  hasFahrzeugLink: true,
};

/** Die Tabelle aus design.md D6, Zeile für Zeile. */
describe('buildEinheitRechte (design.md D6)', () => {
  it('mit Schreibrecht und allen Freigaben ist alles offen', () => {
    expect(buildEinheitRechte(true, freigaben())).toEqual(ALLES);
  });

  it('unbekannte Freigaben heißen offen (wie `istSprungGesperrt`)', () => {
    expect(buildEinheitRechte(true, undefined)).toEqual(ALLES);
  });

  it('Beobachter: kein Bedienelement, nur die Links in freigegebene Module', () => {
    expect(buildEinheitRechte(false, freigaben())).toEqual({
      ...Object.fromEntries(Object.keys(ALLES).map((k) => [k, false])),
      hasPersonalLink: true,
      hasFahrzeugLink: true,
    });
  });

  it('Personal gesperrt: kein Zuordnen von Personen, kein Link dorthin, der Rest bleibt', () => {
    expect(buildEinheitRechte(true, freigaben(['personal']))).toEqual({
      ...ALLES,
      canZuordnenPersonalEinsatz: false,
      canZuordnenPersonalStamm: false,
      hasPersonalLink: false,
    });
  });

  it('Fahrzeuge gesperrt: kein Zuordnen von Fahrzeugen, keine Besatzung, kein Link dorthin', () => {
    expect(buildEinheitRechte(true, freigaben(['fahrzeuge']))).toEqual({
      ...ALLES,
      canZuordnenFahrzeugEinsatz: false,
      canZuordnenFahrzeugStamm: false,
      canEditBesatzung: false,
      hasFahrzeugLink: false,
    });
  });

  it('Material gesperrt: nur „Material zuordnen …“ fällt weg', () => {
    expect(buildEinheitRechte(true, freigaben(['material']))).toEqual({
      ...ALLES,
      canZuordnenMaterial: false,
    });
  });

  it('Einheiten gesperrt: alles, was die Einheit schreibt, fällt weg; Besatzung und Links bleiben', () => {
    expect(buildEinheitRechte(true, freigaben(['einheiten']))).toEqual({
      ...Object.fromEntries(Object.keys(ALLES).map((k) => [k, false])),
      canEditBesatzung: true,
      hasPersonalLink: true,
      hasFahrzeugLink: true,
    });
  });
});
