import { describe, expect, it } from 'vitest';
import type { EinsatzFahrzeug, EinsatzPersonal, Staerke } from '../api/types';
import { besatzungKandidaten, besatzungVorschlag } from './besatzungVorschlag';

const person = (id: number, name: string, felder: Partial<EinsatzPersonal> = {}): EinsatzPersonal =>
  ({
    id,
    name,
    einsatz_id: 1,
    disponiert_at: '2026-10-14T08:00:00Z',
    ist_adhoc: true,
    ist_demo: false,
    einheit_id: 7,
    fahrzeug_id: null,
    staerke_position: null,
    ...felder,
  }) as EinsatzPersonal;

const fahrzeug = (felder: Partial<EinsatzFahrzeug> = {}): EinsatzFahrzeug =>
  ({ id: 3, funkrufname: 'RTW 1', einheit_id: 7, ...felder }) as EinsatzFahrzeug;

const soll = (fuehrer: number, unterfuehrer: number, mannschaft: number): Staerke => ({
  fuehrer,
  unterfuehrer,
  mannschaft,
});

const namen = (liste: EinsatzPersonal[]) => liste.map((p) => p.name);

describe('besatzungKandidaten — freie aktive Kräfte der Einheit (LLH-1073, design.md D12)', () => {
  it('nimmt nur Personen der Einheit des Fahrzeugs, die auf keinem Fahrzeug sitzen', () => {
    const personal = [
      person(1, 'Anna'),
      person(2, 'Berta', { fahrzeug_id: 9 }),
      person(3, 'Carl', { einheit_id: 8 }),
      person(4, 'Dora', { einheit_id: null }),
      person(5, 'Emil', { beendet_at: '2026-10-14T09:00:00Z' }),
      person(6, 'Frida', { fahrzeug_id: 3 }),
    ];
    expect(namen(besatzungKandidaten(personal, fahrzeug()))).toEqual(['Anna']);
  });

  it('ist ohne Einheit leer', () => {
    expect(
      besatzungKandidaten(
        [person(1, 'Anna', { einheit_id: null })],
        fahrzeug({ einheit_id: null }),
      ),
    ).toEqual([]);
  });
});

describe('besatzungVorschlag — bis zum Soll je Position', () => {
  it('Spec-Szenario: RTW 0/1/1 und Rettungsstaffel mit Unterführerin und drei ohne Position', () => {
    const kandidaten = [
      person(1, 'Zora'),
      person(2, 'Ulla', { staerke_position: 'unterfuehrer' }),
      person(3, 'Ben'),
      person(4, 'Ali'),
    ];
    const v = besatzungVorschlag({ kandidaten, crew: [], soll: soll(0, 1, 1), fuehrerId: null });
    expect(namen(v.kandidaten)).toEqual(['Ulla', 'Ali', 'Ben', 'Zora']);
    expect(v.vorgewaehlt).toEqual([2, 4]);
  });

  it('ohne Position zählt als Mannschaft, auch in der sitzenden Besatzung', () => {
    const kandidaten = [person(1, 'Anna'), person(2, 'Berta', { staerke_position: 'mannschaft' })];
    const crew = [person(9, 'Sitzt', { fahrzeug_id: 3 })];
    const v = besatzungVorschlag({ kandidaten, crew, soll: soll(0, 0, 2), fuehrerId: null });
    expect(v.vorgewaehlt).toEqual([1]);
  });

  it('zieht die sitzende Besatzung je Position ab', () => {
    const kandidaten = [
      person(1, 'Fritz', { staerke_position: 'fuehrer' }),
      person(2, 'Mia', { staerke_position: 'mannschaft' }),
      person(3, 'Max', { staerke_position: 'mannschaft' }),
    ];
    const crew = [
      person(8, 'Fred', { fahrzeug_id: 3, staerke_position: 'fuehrer' }),
      person(9, 'Moni', { fahrzeug_id: 3, staerke_position: 'mannschaft' }),
    ];
    const v = besatzungVorschlag({ kandidaten, crew, soll: soll(1, 0, 2), fuehrerId: null });
    expect(v.vorgewaehlt).toEqual([3]);
  });

  it('stellt den Führer der Einheit vor alle anderen und wählt ihn zuerst', () => {
    const kandidaten = [
      person(1, 'Anton', { staerke_position: 'unterfuehrer' }),
      person(2, 'Zacharias', { staerke_position: 'unterfuehrer' }),
    ];
    const v = besatzungVorschlag({ kandidaten, crew: [], soll: soll(0, 1, 0), fuehrerId: 2 });
    expect(namen(v.kandidaten)).toEqual(['Zacharias', 'Anton']);
    expect(v.vorgewaehlt).toEqual([2]);
  });

  it('ordnet nach Position, dann Name', () => {
    const kandidaten = [
      person(1, 'Mona'),
      person(2, 'Ute', { staerke_position: 'unterfuehrer' }),
      person(3, 'Fred', { staerke_position: 'fuehrer' }),
      person(4, 'Ärmel', { staerke_position: 'mannschaft' }),
    ];
    const v = besatzungVorschlag({ kandidaten, crew: [], soll: soll(0, 0, 0), fuehrerId: null });
    expect(namen(v.kandidaten)).toEqual(['Fred', 'Ute', 'Ärmel', 'Mona']);
    expect(v.vorgewaehlt).toEqual([]);
  });

  it('ohne Soll sind alle Kandidaten vorgewählt', () => {
    const kandidaten = [person(1, 'Anna'), person(2, 'Berta', { staerke_position: 'fuehrer' })];
    const v = besatzungVorschlag({ kandidaten, crew: [], soll: null, fuehrerId: null });
    expect(v.vorgewaehlt).toEqual([2, 1]);
  });

  it('wählt bei vollem Soll niemanden', () => {
    const v = besatzungVorschlag({
      kandidaten: [person(1, 'Anna')],
      crew: [person(9, 'Sitzt', { fahrzeug_id: 3 })],
      soll: soll(0, 0, 1),
      fuehrerId: null,
    });
    expect(v.vorgewaehlt).toEqual([]);
  });
});
