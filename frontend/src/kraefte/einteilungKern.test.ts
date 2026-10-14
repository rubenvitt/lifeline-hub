import { describe, expect, it } from 'vitest';
import type { Einheit, EinsatzFahrzeug, EinsatzPersonal, Einsatzabschnitt } from '../api/types';
import {
  OHNE_EINHEIT,
  buildEinheitGruppen,
  buildFahrzeugOptions,
  isFremdesFahrzeug,
} from './einteilungKern';

// ── Fixtures (nur die gelesenen Felder zählen) ───────────────────────────────

const einheit = (
  id: number,
  name: string,
  ueber: number | null = null,
  abschnitt: number | null = null,
) =>
  ({
    id,
    name,
    ueber_einheit_id: ueber,
    abschnitt_id: abschnitt,
  }) as Einheit;

const abschnitt = (id: number) =>
  ({ id, einsatz_id: 1, ueber_abschnitt_id: null, name: `A${id}` }) as Einsatzabschnitt;

const person = (id: number, einheit_id: number | null) =>
  ({ id, name: `P${id}`, einheit_id }) as EinsatzPersonal;

const fahrzeug = (id: number, funkrufname: string, einheit_id: number | null, typ?: string) =>
  ({ id, funkrufname, einheit_id, fahrzeugtyp: typ ?? null }) as EinsatzFahrzeug;

// ── Gruppen nach Einheit (D6) ────────────────────────────────────────────────

describe('buildEinheitGruppen', () => {
  const einheiten = [
    einheit(1, 'Rettungsstaffel'),
    einheit(2, 'Zug 1'),
    einheit(3, 'Staffel A', 2),
  ];

  it('stellt „nicht eingeteilt“ vor die Einheiten', () => {
    const g = buildEinheitGruppen(einheiten, [])!;
    expect(g.schluessel(person(1, null))).toBe(OHNE_EINHEIT);
    expect(g.schluessel(person(2, 1))).toBe('einheit:1');
    expect(g.reihenfolge[0]).toBe(OHNE_EINHEIT);
    expect(g.etikett(OHNE_EINHEIT, 3)).toBe('nicht eingeteilt');
    expect(g.etikett('einheit:1', 4)).toBe('Rettungsstaffel');
  });

  it('folgt dem Kräftebaum in Tiefensuche und benennt Untereinheiten mit Pfad', () => {
    const g = buildEinheitGruppen(einheiten, [])!;
    expect(g.reihenfolge).toEqual([OHNE_EINHEIT, 'einheit:1', 'einheit:2', 'einheit:3']);
    expect(g.etikett('einheit:3', 2)).toBe('Zug 1 › Staffel A');
  });

  it('ordnet Geschwister nach dem Rang ihres Abschnitts', () => {
    const g = buildEinheitGruppen(
      [einheit(1, 'Hinten', null, 20), einheit(2, 'Vorn', null, 10)],
      [abschnitt(10), abschnitt(20)],
    )!;
    expect(g.reihenfolge).toEqual([OHNE_EINHEIT, 'einheit:2', 'einheit:1']);
  });

  it('gruppiert ohne geladene Einheitenliste nicht', () => {
    expect(buildEinheitGruppen(undefined, [])).toBeNull();
  });

  it('erfindet kein Etikett für eine Einheit, die nicht in der Liste steht', () => {
    const g = buildEinheitGruppen(einheiten, [])!;
    const schluessel = g.schluessel(person(9, 99));
    expect(schluessel).not.toBe(OHNE_EINHEIT);
    expect(g.etikett(schluessel, 1)).not.toMatch(/99/);
    expect(g.reihenfolge).not.toContain(schluessel);
  });
});

// ── Fahrzeugoptionen (D5) ────────────────────────────────────────────────────

describe('buildFahrzeugOptions', () => {
  const fahrzeuge = [
    fahrzeug(10, 'Musterstadt 83-1', 1, 'RTW'),
    fahrzeug(11, 'Florian 46-1', 2),
    fahrzeug(12, 'Musterstadt 19-1', null, 'MTW'),
  ];

  it('stellt die Fahrzeuge der eigenen Einheit in eine erste Gruppe', () => {
    const optionen = buildFahrzeugOptions(fahrzeuge, { id: 1, name: 'Rettungsstaffel' });
    expect(optionen).toEqual([
      {
        label: 'Einheit «Rettungsstaffel»',
        title: 'Einheit «Rettungsstaffel»',
        options: [{ value: 10, label: 'Musterstadt 83-1 (RTW)' }],
      },
      {
        label: 'Weitere Fahrzeuge',
        title: 'Weitere Fahrzeuge',
        options: [
          { value: 11, label: 'Florian 46-1' },
          { value: 12, label: 'Musterstadt 19-1 (MTW)' },
        ],
      },
    ]);
  });

  it('bleibt flach ohne Einheit oder ohne eigenes Fahrzeug der Einheit', () => {
    const flach = [
      { value: 10, label: 'Musterstadt 83-1 (RTW)' },
      { value: 11, label: 'Florian 46-1' },
      { value: 12, label: 'Musterstadt 19-1 (MTW)' },
    ];
    expect(buildFahrzeugOptions(fahrzeuge, null)).toEqual(flach);
    expect(buildFahrzeugOptions(fahrzeuge, { id: 7, name: 'Leer' })).toEqual(flach);
  });
});

describe('isFremdesFahrzeug', () => {
  it('kennzeichnet nur ein Fahrzeug einer anderen Einheit', () => {
    expect(isFremdesFahrzeug({ einheit_id: 2 }, { einheit_id: 1 })).toBe(true);
    expect(isFremdesFahrzeug({ einheit_id: 2 }, { einheit_id: null })).toBe(true);
    expect(isFremdesFahrzeug({ einheit_id: 1 }, { einheit_id: 1 })).toBe(false);
    // Ein Fahrzeug ohne Einheit gehört keiner anderen.
    expect(isFremdesFahrzeug({ einheit_id: null }, { einheit_id: 1 })).toBe(false);
  });
});
