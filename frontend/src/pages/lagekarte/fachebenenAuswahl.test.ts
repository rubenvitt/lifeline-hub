import { describe, it, expect, beforeEach } from 'vitest';
import { liesFachebenenSichtbar, merkeFachebenenSichtbar, type FachebenenSichtbar } from './fachebenenAuswahl';

const leer: FachebenenSichtbar = { nina: false, dwd: false, pegelonline: false, kritis: false };

describe('Fachebenen-Persistenz pro Einsatz', () => {
  beforeEach(() => localStorage.clear());

  it('liefert null ohne gespeicherte Wahl', () => {
    expect(liesFachebenenSichtbar(7)).toBeNull();
  });
  it('merkt und liest pro Einsatz getrennt', () => {
    merkeFachebenenSichtbar(7, { ...leer, dwd: true });
    merkeFachebenenSichtbar(8, { ...leer, nina: true });
    expect(liesFachebenenSichtbar(7)?.dwd).toBe(true);
    expect(liesFachebenenSichtbar(7)?.nina).toBe(false);
    expect(liesFachebenenSichtbar(8)?.nina).toBe(true);
  });
  it('ignoriert kaputten Inhalt', () => {
    localStorage.setItem('fachebenen:sichtbar:9', '{kaputt');
    expect(liesFachebenenSichtbar(9)).toBeNull();
  });
});
