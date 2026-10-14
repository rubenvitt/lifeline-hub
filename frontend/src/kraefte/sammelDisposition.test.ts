import { describe, expect, it } from 'vitest';
import { ApiError } from '../api/client';
import type { Einheit, EinsatzFahrzeug, Fahrzeug, Personal } from '../api/types';
import {
  aktiveEinheiten,
  erfolgText,
  fahrzeugLabel,
  fahrzeugPasstZurEinheit,
  fahrzeugSuchtext,
  fahrzeugeDerEinheit,
  gruendeJeKraft,
  personalLabel,
  personalSuchtext,
} from './sammelDisposition';

const person = (felder: Partial<Personal>): Personal =>
  ({
    id: 1,
    name: 'Anna Berg',
    ist_demo: false,
    qualifikationen: [],
    dienststatus: 'im_dienst',
    angelegt_at: '2026-10-01T08:00:00Z',
    ...felder,
  }) as Personal;

const fahrzeug = (felder: Partial<Fahrzeug>): Fahrzeug =>
  ({
    id: 1,
    funkrufname: 'Rotkreuz Musterstadt 83-1',
    ist_demo: false,
    sondersignal: true,
    dienststatus: 'im_dienst',
    angelegt_at: '2026-10-01T08:00:00Z',
    ...felder,
  }) as Fahrzeug;

const ef = (id: number, einheit_id: number | null): EinsatzFahrzeug =>
  ({ id, einheit_id, funkrufname: `83-${id}` }) as EinsatzFahrzeug;

describe('Suchtext und Label der Auswahl', () => {
  it('durchsucht eine Person über Name, Personalnummer, Träger und Qualifikation', () => {
    const p = person({
      personalnummer: 'P-17',
      traegerorganisation: 'DRK Musterstadt',
      qualifikationen: [
        { id: 1, label: 'Notfallsanitäter' },
        { id: 2, label: 'Gruppenführer' },
      ] as Personal['qualifikationen'],
    });
    const text = personalSuchtext(p);
    for (const teil of [
      'Anna Berg',
      'P-17',
      'DRK Musterstadt',
      'Notfallsanitäter',
      'Gruppenführer',
    ])
      expect(text).toContain(teil);
  });

  it('lässt fehlende Angaben weg statt „null“ zu durchsuchen', () => {
    expect(personalSuchtext(person({ personalnummer: null, traegerorganisation: null }))).toBe(
      'Anna Berg',
    );
  });

  it('beschriftet eine Person wie bisher mit Personalnummer in Klammern', () => {
    expect(personalLabel(person({ personalnummer: 'P-17' }))).toBe('Anna Berg (P-17)');
    expect(personalLabel(person({}))).toBe('Anna Berg');
  });

  it('durchsucht ein Fahrzeug über Funkrufname, Typ, Kennzeichen und Träger', () => {
    const f = fahrzeug({
      fahrzeugtyp: 'RTW',
      kennzeichen: 'MS-RK 831',
      traegerorganisation: 'DRK Musterstadt',
    });
    const text = fahrzeugSuchtext(f);
    for (const teil of ['83-1', 'RTW', 'MS-RK 831', 'DRK Musterstadt'])
      expect(text).toContain(teil);
    expect(fahrzeugLabel(f)).toBe('Rotkreuz Musterstadt 83-1 (RTW)');
  });
});

describe('Ziele: Einheit und Fahrzeug', () => {
  const fahrzeuge = [ef(1, 10), ef(2, 20), ef(3, null)];

  it('bietet zu einer Einheit nur ihre Fahrzeuge an, ohne Einheit alle', () => {
    expect(fahrzeugeDerEinheit(fahrzeuge, 10).map((f) => f.id)).toEqual([1]);
    expect(fahrzeugeDerEinheit(fahrzeuge, null).map((f) => f.id)).toEqual([1, 2, 3]);
    expect(fahrzeugeDerEinheit(fahrzeuge, undefined).map((f) => f.id)).toEqual([1, 2, 3]);
  });

  it('prüft, ob ein gewähltes Fahrzeug nach einem Einheitswechsel noch passt', () => {
    expect(fahrzeugPasstZurEinheit(fahrzeuge, 1, 10)).toBe(true);
    expect(fahrzeugPasstZurEinheit(fahrzeuge, 1, 20)).toBe(false);
    expect(fahrzeugPasstZurEinheit(fahrzeuge, 2, null)).toBe(true);
    expect(fahrzeugPasstZurEinheit(fahrzeuge, undefined, 20)).toBe(true);
    // Ein Fahrzeug, das die Liste nicht mehr kennt, passt nicht.
    expect(fahrzeugPasstZurEinheit(fahrzeuge, 99, null)).toBe(false);
  });

  it('bietet aufgelöste Einheiten nicht als Ziel an', () => {
    const einheiten = [
      { id: 1, name: 'Rettungsstaffel', aufgeloest_at: null },
      { id: 2, name: 'Alter Zug', aufgeloest_at: '2026-10-13T10:00:00Z' },
    ] as Einheit[];
    expect(aktiveEinheiten(einheiten).map((e) => e.id)).toEqual([1]);
  });
});

describe('Gründe je Kraft aus der Ablehnung', () => {
  const fehler = new ApiError(422, 'Nicht alle Kräfte lassen sich disponieren', {
    vomAnwendungsserver: true,
  });
  fehler.zeilen = [
    { art: 'personal', id: 7, grund: 'außer Dienst' },
    { art: 'personal', id: 9, grund: 'schon disponiert' },
    { art: 'fahrzeug', id: 7, grund: 'entlassen' },
  ];

  it('ordnet jeder abgelehnten Kraft ihren Grund zu, getrennt nach Art', () => {
    expect([...gruendeJeKraft(fehler, 'personal')]).toEqual([
      [7, 'außer Dienst'],
      [9, 'schon disponiert'],
    ]);
    expect([...gruendeJeKraft(fehler, 'fahrzeug')]).toEqual([[7, 'entlassen']]);
  });

  it('liefert ohne Zeilen oder bei fremden Fehlern nichts', () => {
    expect(gruendeJeKraft(new ApiError(409, 'Konflikt'), 'personal').size).toBe(0);
    expect(gruendeJeKraft(new Error('boom'), 'personal').size).toBe(0);
    expect(gruendeJeKraft(null, 'personal').size).toBe(0);
  });
});

describe('Erfolgsmeldung', () => {
  it('nennt eine Kraft wie bisher und eine Gruppe mit Zahl', () => {
    expect(erfolgText(1, 'personal')).toBe('Personal disponiert');
    expect(erfolgText(9, 'personal')).toBe('9 Kräfte disponiert');
    expect(erfolgText(1, 'fahrzeug')).toBe('Fahrzeug disponiert');
    expect(erfolgText(2, 'fahrzeug')).toBe('2 Fahrzeuge disponiert');
  });
});
