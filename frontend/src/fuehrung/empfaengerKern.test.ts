import { describe, expect, it } from 'vitest';
import type { NeuerEmpfaenger } from '../api/types';
import { TEST_VORSCHLAEGE } from '../test/fuehrungsfunktionen';
import {
  abschnittTag,
  buildEmpfaenger,
  einheitTag,
  empfaengerTag,
  empfaengerTagsAus,
} from './empfaengerKern';

const KATALOG = TEST_VORSCHLAEGE.katalog;

/** Gespeicherte Empfänger wie der Server sie liefert: nicht gesetzte Felder als `null`. */
const gespeichert = (e: NeuerEmpfaenger) => ({
  abschnitt_id: null,
  einheit_id: null,
  funktion: null,
  funktion_text: null,
  ...e,
});

describe('empfaengerKern: Tag-Werte hin und zurück (kz5udbog D7)', () => {
  const faelle: { name: string; tag: string; empfaenger: NeuerEmpfaenger }[] = [
    {
      name: 'Einsatzabschnitt',
      tag: 'abschnitt:3',
      empfaenger: { empfaenger_typ: 'abschnitt', abschnitt_id: 3 },
    },
    {
      name: 'Einheit',
      tag: 'einheit:9',
      empfaenger: { empfaenger_typ: 'einheit', einheit_id: 9 },
    },
    {
      name: 'Katalogfunktion mit Bezeichnung (Fachberater)',
      tag: 'funktion:fachberater:THW',
      empfaenger: { empfaenger_typ: 'funktion', funktion: 'fachberater', funktion_text: 'THW' },
    },
    {
      name: 'Katalogfunktion ohne Bezeichnung (S3)',
      tag: 'funktion:s3',
      empfaenger: { empfaenger_typ: 'funktion', funktion: 's3' },
    },
    {
      name: 'Freitext',
      tag: 'Logistiktrupp',
      empfaenger: { empfaenger_typ: 'funktion', funktion_text: 'Logistiktrupp' },
    },
  ];

  for (const { name, tag, empfaenger } of faelle) {
    it(`${name}: der Tag wird zum Empfänger und der gespeicherte Empfänger wieder zum Tag`, () => {
      expect(buildEmpfaenger([tag], KATALOG)).toEqual([empfaenger]);
      expect(empfaengerTagsAus([gespeichert(empfaenger)])).toEqual([tag]);
    });
  }

  it('hält die Reihenfolge über mehrere Empfänger', () => {
    const tags = ['funktion:s3', 'abschnitt:3', 'Logistiktrupp', 'einheit:9'];
    const empfaenger = buildEmpfaenger(tags, KATALOG);
    expect(empfaengerTagsAus(empfaenger.map(gespeichert))).toEqual(tags);
  });

  it('baut die Tags von Abschnitt und Einheit über eigene Helfer', () => {
    expect(abschnittTag(3)).toBe('abschnitt:3');
    expect(einheitTag(9)).toBe('einheit:9');
  });

  it('übergeht externe Stellen, Personen und Fahrzeuge: sie haben keinen Tag', () => {
    expect(
      empfaengerTagsAus([
        { empfaenger_typ: 'extern' },
        { empfaenger_typ: 'person' },
        { empfaenger_typ: 'fahrzeug' },
        gespeichert({ empfaenger_typ: 'abschnitt', abschnitt_id: 1 }),
      ]),
    ).toEqual(['abschnitt:1']);
    expect(empfaengerTag({ empfaenger_typ: 'extern' })).toBeUndefined();
  });

  it('macht aus „S3“ als Freitext keinen Katalogcode', () => {
    expect(buildEmpfaenger(['S3'], KATALOG)).toEqual([
      { empfaenger_typ: 'funktion', funktion_text: 'S3' },
    ]);
  });

  it('lässt einen leeren Freitext weg', () => {
    expect(buildEmpfaenger(['  '], KATALOG)).toEqual([]);
    expect(empfaengerTagsAus([gespeichert({ empfaenger_typ: 'funktion' })])).toEqual([]);
  });
});
