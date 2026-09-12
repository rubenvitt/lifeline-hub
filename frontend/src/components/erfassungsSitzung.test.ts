import { beforeEach, describe, expect, it } from 'vitest';
import { liesErfassungsSitzungswert, schreibeErfassungsSitzungswert } from './erfassungsSitzung';

const PERSON_1_ORT = 'lfh:erfassung:1:person:antreff_ort';

beforeEach(() => sessionStorage.clear());

function mitSessionStorage(
  storage: Pick<Storage, 'getItem' | 'setItem'> | undefined,
  pruefung: () => void,
): void {
  const vorher = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage');
  Object.defineProperty(globalThis, 'sessionStorage', {
    configurable: true,
    value: storage,
  });
  try {
    pruefung();
  } finally {
    if (vorher) Object.defineProperty(globalThis, 'sessionStorage', vorher);
    else Reflect.deleteProperty(globalThis, 'sessionStorage');
  }
}

describe('erfassungsSitzung', () => {
  it('speichert den String unverändert unter Einsatz, Maske und Feld', () => {
    schreibeErfassungsSitzungswert(1, 'person', 'antreff_ort', 'Sammelstelle Süd');

    expect(sessionStorage.getItem(PERSON_1_ORT)).toBe('Sammelstelle Süd');
    expect(liesErfassungsSitzungswert(1, 'person', 'antreff_ort')).toBe('Sammelstelle Süd');
  });

  it('trennt gleiche Felder nach Einsatz und Maske', () => {
    schreibeErfassungsSitzungswert(1, 'person', 'antreff_ort', 'Person Einsatz 1');
    schreibeErfassungsSitzungswert(2, 'person', 'antreff_ort', 'Person Einsatz 2');
    schreibeErfassungsSitzungswert(1, 'tier', 'antreff_ort', 'Tier Einsatz 1');

    expect(liesErfassungsSitzungswert(1, 'person', 'antreff_ort')).toBe('Person Einsatz 1');
    expect(liesErfassungsSitzungswert(2, 'person', 'antreff_ort')).toBe('Person Einsatz 2');
    expect(liesErfassungsSitzungswert(1, 'tier', 'antreff_ort')).toBe('Tier Einsatz 1');
  });

  it('bleibt bei nicht verfügbarem sessionStorage ohne harten Fehler', () => {
    mitSessionStorage(undefined, () => {
      expect(() => schreibeErfassungsSitzungswert(1, 'person', 'antreff_ort', 'Ort')).not.toThrow();
      expect(liesErfassungsSitzungswert(1, 'person', 'antreff_ort')).toBeUndefined();
    });
  });

  it('fängt werfende Lese- und Schreibzugriffe ab', () => {
    mitSessionStorage(
      {
        getItem: () => {
          throw new Error('SecurityError');
        },
        setItem: () => {
          throw new Error('SecurityError');
        },
      },
      () => {
        expect(() =>
          schreibeErfassungsSitzungswert(1, 'person', 'antreff_ort', 'Ort'),
        ).not.toThrow();
        expect(liesErfassungsSitzungswert(1, 'person', 'antreff_ort')).toBeUndefined();
      },
    );
  });
});
