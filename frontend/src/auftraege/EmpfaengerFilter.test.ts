import { describe, expect, it } from 'vitest';
import { parseEmpfaengerFilter, matchesEmpfaenger } from './EmpfaengerFilter';

describe('Empfängerfilter (LLH-1173)', () => {
  const verteiler = [{ abschnitt_id: 3 }, { einheit_id: 9 }, { abschnitt_id: null }];

  it('übersetzt den Filterwert in Abschnitt oder Einheit', () => {
    expect(parseEmpfaengerFilter('abschnitt:3')).toEqual({ abschnittId: 3 });
    expect(parseEmpfaengerFilter('einheit:9')).toEqual({ einheitId: 9 });
    expect(parseEmpfaengerFilter(undefined)).toEqual({});
  });

  it('trifft den genannten Abschnitt und die genannte Einheit', () => {
    expect(matchesEmpfaenger(verteiler, 'abschnitt:3')).toBe(true);
    expect(matchesEmpfaenger(verteiler, 'einheit:9')).toBe(true);
  });

  it('trifft keinen anderen Abschnitt und keine Einheit mit derselben Zahl', () => {
    expect(matchesEmpfaenger(verteiler, 'abschnitt:4')).toBe(false);
    expect(matchesEmpfaenger(verteiler, 'einheit:3')).toBe(false);
  });

  it('eine Funktion oder externe Stelle trifft keinen Filter', () => {
    expect(matchesEmpfaenger([{ abschnitt_id: null, einheit_id: null }], 'abschnitt:3')).toBe(
      false,
    );
  });

  it('ohne Filter trifft alles, auch ein leerer Verteiler', () => {
    expect(matchesEmpfaenger([], undefined)).toBe(true);
    expect(matchesEmpfaenger([], 'abschnitt:3')).toBe(false);
  });
});
