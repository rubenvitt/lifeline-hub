import { describe, expect, it } from 'vitest';
import type { Einheit, EinsatzFahrzeug } from '../../api/types';
import { freieKraefteOhneBr, gruppiereFreieKraefte } from './freieKraefte';

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

describe('freieKraefteOhneBr: „Erwartet“ und „Im Einsatz“ (LLH-1075, design.md D14)', () => {
  const eh = (id: number, mehr: Partial<Einheit> = {}) =>
    ({
      id,
      name: `E${id}`,
      abschnitt_id: null,
      abschnitt_name: null,
      ueber_einheit_id: null,
      aktueller_br_id: null,
      ...mehr,
    }) as unknown as Einheit;
  const fz = (id: number, mehr: Partial<EinsatzFahrzeug> = {}) =>
    ({
      id,
      funkrufname: `F${id}`,
      einheit_id: null,
      aktueller_br_id: null,
      ...mehr,
    }) as unknown as EinsatzFahrzeug;
  const ids = (k: { einheiten: Einheit[]; fahrzeuge: EinsatzFahrzeug[] }) => [
    ...k.einheiten.map((x) => `e${x.id}`),
    ...k.fahrzeuge.map((x) => `f${x.id}`),
  ];

  it('Einheit mit Abschnitt steht unter „Im Einsatz“, ohne unter „Erwartet“', () => {
    const r = freieKraefteOhneBr({
      alleEinheiten: [eh(1, { abschnitt_id: 3, abschnitt_name: 'Nord' }), eh(2)],
      alleFahrzeuge: [fz(9)],
      brEinheiten: [],
      brFahrzeuge: [],
    });
    expect(ids(r.erwartet)).toEqual(['e2', 'f9']);
    expect(ids(r.imEinsatz)).toEqual(['e1']);
  });

  it('der geerbte Abschnitt zählt (Lesart des Meldebilds)', () => {
    const r = freieKraefteOhneBr({
      alleEinheiten: [
        eh(1, { abschnitt_id: 3, aktueller_br_id: 7 }),
        eh(2, { ueber_einheit_id: 1 }),
      ],
      alleFahrzeuge: [],
      brEinheiten: [],
      brFahrzeuge: [],
    });
    expect(ids(r.imEinsatz)).toEqual(['e2']);
    expect(ids(r.erwartet)).toEqual([]);
  });

  it('Kräfte in einem Raum und Fahrzeuge einer Einheit fehlen in beiden', () => {
    const r = freieKraefteOhneBr({
      alleEinheiten: [eh(1, { aktueller_br_id: 4 }), eh(2)],
      alleFahrzeuge: [fz(8, { einheit_id: 2 }), fz(9, { aktueller_br_id: 4 }), fz(10)],
      brEinheiten: [{ id: 2 } as never],
      brFahrzeuge: [],
    });
    expect(ids(r.erwartet)).toEqual(['f10']);
    expect(ids(r.imEinsatz)).toEqual([]);
  });
});
