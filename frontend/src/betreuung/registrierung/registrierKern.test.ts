import { describe, expect, it } from 'vitest';
import type { RegistriertePerson } from '../../api/types';
import { KOSTFORMEN } from '../../verpflegung/verpflegungText';
import {
  KOSTFORM_KURZ,
  KOSTFORM_REIHE,
  KOSTFORM_WORT,
  alterText,
  haushaltKennung,
  isDiaetHinweis,
  kostformBand,
  leereZeile,
  personName,
  registrierBody,
} from './registrierKern';

const HEUTE = '2026-11-09';

function person(over: Partial<RegistriertePerson> & { id: number }): RegistriertePerson {
  return { registrier_nr: over.id, erfasst_at: '2026-11-09 08:00:00', ...over };
}

describe('Kostformen der Registrierung (LLH-1612, design.md D4/D8)', () => {
  it('„Normalkost“ zuerst, dann die fünf Sonderkost-Formen der Verpflegung in ihrer Folge', () => {
    expect(KOSTFORM_REIHE).toEqual(['normal', ...KOSTFORMEN]);
    expect(KOSTFORM_WORT.normal).toBe('Normalkost');
    expect(KOSTFORM_WORT.diaet_allergenarm).toBe('Diät/allergenarm');
  });

  it('jedes Kurzwort ist kürzer als sein Wort, das Wort bleibt der zugängliche Name', () => {
    for (const k of KOSTFORM_REIHE) {
      expect(KOSTFORM_KURZ[k].length, k).toBeLessThanOrEqual(KOSTFORM_WORT[k].length);
    }
    expect(KOSTFORM_KURZ).toEqual({
      normal: 'Normal',
      vegetarisch: 'Veg.',
      vegan: 'Vegan',
      ohne_schwein: 'o. Schwein',
      diaet_allergenarm: 'Diät',
      saeugling_kleinkind: 'Kleinkind',
    });
  });
});

describe('registrierBody', () => {
  it('Haushaltsangaben einmal: Adresse und Kontakt gehen an jede Person des Haushalts', () => {
    const body = registrierBody(
      {
        herkunft_adresse: ' Lindenweg 3 ',
        kontakt: '0171 555',
        personen: [
          { ...leereZeile(), name: 'Weber', vorname: 'Anna', kostform: 'vegetarisch' },
          { ...leereZeile('Weber'), vorname: 'Tom' },
          { ...leereZeile('Weber'), vorname: 'Lea', kostform: 'saeugling_kleinkind' },
        ],
      },
      HEUTE,
    );
    expect(body.personen).toHaveLength(3);
    for (const p of body.personen) {
      expect(p.herkunft_adresse).toBe('Lindenweg 3');
      expect(p.kontakt).toBe('0171 555');
      expect(p.name).toBe('Weber');
    }
    expect(body.personen.map((p) => p.kostform)).toEqual([
      'vegetarisch',
      'normal',
      'saeugling_kleinkind',
    ]);
    expect(body).not.toHaveProperty('haushalt_id');
  });

  it('leere Angaben fehlen im Body, das Geburtsdatum geht als Kalenderdatum hinaus', () => {
    const body = registrierBody(
      {
        personen: [
          {
            ...leereZeile(),
            name: 'Weber',
            vorname: '  ',
            geburtsdatum: '3.4.1985',
            geschlecht: 'weiblich',
            unvertraeglichkeiten: ' Erdnüsse ',
          },
        ],
      },
      HEUTE,
      12,
    );
    expect(body).toEqual({
      haushalt_id: 12,
      personen: [
        {
          name: 'Weber',
          geburtsdatum: '1985-04-03',
          geschlecht: 'weiblich',
          kostform: 'normal',
          unvertraeglichkeiten: 'Erdnüsse',
        },
      ],
    });
  });
});

describe('Hinweis „Diät/allergenarm wählen?“', () => {
  it('nur bei gefüllten Unverträglichkeiten UND Normalkost', () => {
    expect(isDiaetHinweis({ ...leereZeile(), unvertraeglichkeiten: 'Erdnüsse' })).toBe(true);
    expect(isDiaetHinweis({ ...leereZeile(), unvertraeglichkeiten: '  ' })).toBe(false);
    expect(
      isDiaetHinweis({ ...leereZeile(), unvertraeglichkeiten: 'Erdnüsse', kostform: 'vegan' }),
    ).toBe(false);
  });
});

describe('kostformBand', () => {
  it('zählt je Kostform, „ohne Angabe“ eingeschlossen, aus Haushalten und Personen ohne Haushalt', () => {
    const band = kostformBand({
      stelle_id: 8,
      haushalte: [
        {
          id: 3,
          nummer: 1,
          personen: [
            person({ id: 1, kostform: 'normal' }),
            person({ id: 2, kostform: 'vegetarisch' }),
            person({ id: 3, kostform: 'saeugling_kleinkind' }),
          ],
        },
      ],
      ohne_haushalt: [person({ id: 4 })],
    });
    expect(band).toEqual({
      normal: 1,
      vegetarisch: 1,
      vegan: 0,
      ohne_schwein: 0,
      diaet_allergenarm: 0,
      saeugling_kleinkind: 1,
      ohne_angabe: 1,
    });
  });
});

describe('Anzeige', () => {
  it('Haushalt „H-n“, Name „Nachname, Vorname“', () => {
    expect(haushaltKennung(7)).toBe('H-7');
    expect(personName({ name: 'Weber', vorname: 'Anna' })).toBe('Weber, Anna');
    expect(personName({ name: 'Weber' })).toBe('Weber');
    expect(personName({})).toBe('ohne Namen');
  });

  it('Alter aus dem Geburtsdatum am Tag der Anzeigezone, sonst geschätzt, sonst leer', () => {
    expect(alterText(person({ id: 1, geburtsdatum: '1985-11-10' }), HEUTE)).toBe('10.11.1985 (40)');
    expect(alterText(person({ id: 1, geburtsdatum: '1985-11-09' }), HEUTE)).toBe('09.11.1985 (41)');
    expect(alterText(person({ id: 1, alter_geschaetzt: 4 }), HEUTE)).toBe('ca. 4 J.');
    expect(alterText(person({ id: 1 }), HEUTE)).toBe('');
  });
});
