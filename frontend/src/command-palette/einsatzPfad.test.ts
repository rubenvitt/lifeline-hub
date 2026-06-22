import { describe, it, expect } from 'vitest';
import { einsatzIdAusPfad } from './einsatzPfad';

describe('einsatzIdAusPfad', () => {
  it('liest die ID aus einer Modul-Route', () => {
    expect(einsatzIdAusPfad('/einsaetze/5/etb')).toBe(5);
  });
  it('liest die ID auch ohne Modul-Segment', () => {
    expect(einsatzIdAusPfad('/einsaetze/12')).toBe(12);
  });
  it('liefert null auf der Einsatz-Liste', () => {
    expect(einsatzIdAusPfad('/einsaetze')).toBeNull();
  });
  it('liefert null außerhalb des Einsatz-Bereichs', () => {
    expect(einsatzIdAusPfad('/profil')).toBeNull();
    expect(einsatzIdAusPfad('/')).toBeNull();
  });
  it('liefert null bei nicht-numerischer ID', () => {
    expect(einsatzIdAusPfad('/einsaetze/abc/etb')).toBeNull();
  });
});
