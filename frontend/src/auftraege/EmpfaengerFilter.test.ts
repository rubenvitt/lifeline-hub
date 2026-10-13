import { describe, expect, it } from 'vitest';
import { empfaengerFilterZiel, trifftEmpfaenger } from './EmpfaengerFilter';

describe('Empfängerfilter (LLH-1173)', () => {
  const verteiler = [{ abschnitt_id: 3 }, { einheit_id: 9 }, { abschnitt_id: null }];

  it('übersetzt den Filterwert in Abschnitt oder Einheit', () => {
    expect(empfaengerFilterZiel('abschnitt:3')).toEqual({ abschnittId: 3 });
    expect(empfaengerFilterZiel('einheit:9')).toEqual({ einheitId: 9 });
    expect(empfaengerFilterZiel(undefined)).toEqual({});
  });

  it('trifft den genannten Abschnitt und die genannte Einheit', () => {
    expect(trifftEmpfaenger(verteiler, 'abschnitt:3')).toBe(true);
    expect(trifftEmpfaenger(verteiler, 'einheit:9')).toBe(true);
  });

  it('trifft keinen anderen Abschnitt und keine Einheit mit derselben Zahl', () => {
    expect(trifftEmpfaenger(verteiler, 'abschnitt:4')).toBe(false);
    expect(trifftEmpfaenger(verteiler, 'einheit:3')).toBe(false);
  });

  it('eine Funktion oder externe Stelle trifft keinen Filter', () => {
    expect(trifftEmpfaenger([{ abschnitt_id: null, einheit_id: null }], 'abschnitt:3')).toBe(false);
  });

  it('ohne Filter trifft alles, auch ein leerer Verteiler', () => {
    expect(trifftEmpfaenger([], undefined)).toBe(true);
    expect(trifftEmpfaenger([], 'abschnitt:3')).toBe(false);
  });
});
