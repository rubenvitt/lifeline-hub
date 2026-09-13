import { describe, expect, it } from 'vitest';
import type { Einheit, EinsatzFahrzeug } from '../../api/types';
import { gruppiereFreieKraefte } from './freieKraefte';

const e = (id: number, name: string, typ_label: string | null): Einheit =>
  ({ id, name, typ_label }) as unknown as Einheit;
const f = (id: number, funkrufname: string, fahrzeugtyp: string | null): EinsatzFahrzeug =>
  ({ id, funkrufname, fahrzeugtyp }) as unknown as EinsatzFahrzeug;

describe('gruppiereFreieKraefte', () => {
  const einheiten = [
    e(1, 'Zug Nord', 'Zug'),
    e(2, 'Trupp A', 'Trupp'),
    e(3, 'Sonder', null),
    e(4, 'Zug Süd', 'Zug'),
  ];
  const fahrzeuge = [f(9, 'Florian 1', 'LF 20')];

  it('gruppiert nach Typ (alphabetisch), Ohne Typ und Fahrzeuge zuletzt', () => {
    expect(gruppiereFreieKraefte(einheiten, fahrzeuge, '').map((g) => g.titel)).toEqual([
      'Trupp',
      'Zug',
      'Ohne Typ',
      'Fahrzeuge ohne Einheit',
    ]);
  });

  it('filtert über Name, Funkrufname und Fahrzeugtyp — leere Gruppen fallen weg', () => {
    expect(gruppiereFreieKraefte(einheiten, fahrzeuge, 'süd').map((g) => g.titel)).toEqual(['Zug']);
    expect(gruppiereFreieKraefte(einheiten, fahrzeuge, 'lf 20').map((g) => g.titel)).toEqual([
      'Fahrzeuge ohne Einheit',
    ]);
  });
});
