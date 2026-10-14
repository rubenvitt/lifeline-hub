import { describe, expect, it } from 'vitest';
import type { EinheitTyp, EinsatzPersonal, Staerke } from '../api/types';
import { besatzungZeile, mitkommendeBesatzung, typVorgabe } from './eigeneEinheit';

const soll = (fuehrer: number, unterfuehrer: number, mannschaft: number): Staerke => ({
  fuehrer,
  unterfuehrer,
  mannschaft,
});
const typ = (id: number, label: string, s: Staerke | null): EinheitTyp => ({
  id,
  label,
  soll: s,
  sortier: id,
});
const person = (id: number, name: string, felder: Partial<EinsatzPersonal>): EinsatzPersonal =>
  ({ id, name, einheit_id: null, fahrzeug_id: 3, ...felder }) as EinsatzPersonal;

describe('typVorgabe — Typ nur bei genau einem passenden Soll (LLH-1073, design.md D9)', () => {
  const typen = [
    typ(1, 'Trupp', soll(0, 1, 2)),
    typ(2, 'Staffel', soll(0, 1, 5)),
    typ(3, 'Rettungstrupp', soll(0, 1, 1)),
    typ(4, 'Ohne Soll', null),
  ];

  it('nimmt den einen Typ mit demselben Soll', () => {
    expect(typVorgabe(typen, soll(0, 1, 5))).toBe(2);
  });

  it('rät nicht bei zwei passenden Typen, keinem oder ohne Soll', () => {
    expect(
      typVorgabe([...typen, typ(5, 'Staffel B', soll(0, 1, 5))], soll(0, 1, 5)),
    ).toBeUndefined();
    expect(typVorgabe(typen, soll(1, 1, 1))).toBeUndefined();
    expect(typVorgabe(typen, null)).toBeUndefined();
  });
});

describe('mitkommendeBesatzung — Besatzung ohne Einheit kommt mit (D10)', () => {
  it('nimmt nur aktive Personen des Fahrzeugs ohne Einheit', () => {
    const personal = [
      person(1, 'Anna', {}),
      person(2, 'Berta', { einheit_id: 7 }),
      person(3, 'Carl', { fahrzeug_id: 9 }),
      person(4, 'Dora', { beendet_at: '2026-10-14T09:00:00Z' }),
      person(5, 'Emil', {}),
    ];
    expect(mitkommendeBesatzung(personal, 3).map((p) => p.name)).toEqual(['Anna', 'Emil']);
  });

  it('nennt sie in der Zeile „Besatzung: …“, ohne Personen keine Zeile', () => {
    expect(besatzungZeile([person(1, 'Anna', {}), person(5, 'Emil', {})])).toBe(
      'Besatzung: Anna, Emil',
    );
    expect(besatzungZeile([])).toBeNull();
  });
});
