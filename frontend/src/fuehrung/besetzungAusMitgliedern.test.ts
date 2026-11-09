import { describe, expect, it } from 'vitest';
import type { Fuehrungsfunktion, MitgliedAnzeige } from '../api/types';
import {
  besetzungJeSachgebiet,
  fuehrungsfunktionZeilen,
  namensliste,
  sachgebietZeilen,
  traegerJeFunktion,
} from './besetzungAusMitgliedern';

function mitglied(id: number, name: string, funktion?: Fuehrungsfunktion): MitgliedAnzeige {
  return {
    benutzer_id: id,
    anzeigename: name,
    benutzername: name.toLowerCase(),
    einsatz_rolle: 'fuehrungspersonal',
    zugewiesen_at: '2026-11-08 10:00:00',
    ...(funktion ? { fuehrungsfunktion: funktion } : {}),
  };
}

describe('namensliste', () => {
  // Spec `fuehrungsfunktionen`, „Mehrere Mitglieder mit derselben Führungsfunktion“; dieselbe
  // Folge wie `fuehrung::aufloesung::namensliste` im Server.
  it('nennt alle Namen alphabetisch, getrennt durch „, “', () => {
    expect(namensliste(['Schulz', 'Müller'])).toBe('Müller, Schulz');
    expect(namensliste(['Mzyk', 'Müller', 'albers'])).toBe('albers, Müller, Mzyk');
    expect(namensliste(['Weber'])).toBe('Weber');
  });
});

describe('traegerJeFunktion', () => {
  it('sammelt je Funktion des ganzen Katalogs ihre Träger, Mitglieder ohne Funktion fehlen', () => {
    const karte = traegerJeFunktion([
      mitglied(1, 'Schulz', 's3'),
      mitglied(2, 'Müller', 's3'),
      mitglied(3, 'Weber', 'el'),
      mitglied(4, 'Ohne'),
      mitglied(5, 'Kraus', 'fachberater'),
    ]);
    expect(karte.get('s3')).toBe('Müller, Schulz');
    expect(karte.get('el')).toBe('Weber');
    expect(karte.get('fachberater')).toBe('Kraus');
    expect(karte.has('s1')).toBe(false);
    expect([...karte.values()]).not.toContain('Ohne');
  });

  it('ist ohne Mitglieder leer, nicht undefiniert', () => {
    expect(traegerJeFunktion(undefined).size).toBe(0);
  });
});

describe('besetzungJeSachgebiet', () => {
  it('trägt nur S1–S6, nicht EL, S7 oder Fachberater', () => {
    const karte = besetzungJeSachgebiet([
      mitglied(1, 'Schulz', 's2'),
      mitglied(2, 'Weber', 'el'),
      mitglied(3, 'Kraus', 's7'),
    ]);
    expect([...karte.entries()]).toEqual([['s2', 'Schulz']]);
  });
});

describe('sachgebietZeilen', () => {
  // Spec `fuehrungsorganisation`, „Einsatzleitung und Stab“: leere Sachgebiete fehlen.
  it('liefert die geführten Sachgebiete in S-Folge mit Kürzel und Namen', () => {
    expect(
      sachgebietZeilen([
        mitglied(1, 'Schulz', 's3'),
        mitglied(2, 'Müller', 's2'),
        mitglied(3, 'Albers', 's2'),
      ]),
    ).toEqual([
      { sachgebiet: 's2', kuerzel: 'S2', namen: 'Albers, Müller' },
      { sachgebiet: 's3', kuerzel: 'S3', namen: 'Schulz' },
    ]);
    expect(sachgebietZeilen([mitglied(1, 'Weber', 'el')])).toEqual([]);
  });
});

describe('fuehrungsfunktionZeilen', () => {
  const mitglieder = [
    mitglied(1, 'Weber', 's4'),
    mitglied(2, 'Schulz', 's2'),
    mitglied(3, 'Müller', 's2'),
    mitglied(4, 'Lea', 'el'),
    mitglied(5, 'Kraus', 'fachberater'),
  ];

  // Design D7: Eigene Lage und Einsatzbericht nennen EL und S1–S7 aus der Mitgliedschaft.
  it('nennt EL und S1–S7 in Katalogfolge, nur mit Trägern', () => {
    expect(fuehrungsfunktionZeilen(mitglieder)).toEqual([
      { funktion: 'el', kuerzel: 'EL', namen: 'Lea' },
      { funktion: 's2', kuerzel: 'S2', namen: 'Müller, Schulz' },
      { funktion: 's4', kuerzel: 'S4', namen: 'Weber' },
    ]);
  });

  it('nennt mit `alle` auch EL und S1–S6 ohne Träger, S7 nur mit Träger', () => {
    expect(fuehrungsfunktionZeilen(mitglieder, true).map((z) => z.kuerzel)).toEqual([
      'EL',
      'S1',
      'S2',
      'S3',
      'S4',
      'S5',
      'S6',
    ]);
    expect(
      fuehrungsfunktionZeilen([mitglied(1, 'Paula', 's7')], true).map((z) => z.kuerzel),
    ).toContain('S7');
  });
});
