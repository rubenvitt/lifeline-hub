import { describe, expect, it } from 'vitest';
import type { FuehrungsfunktionEintrag, Sachgebiet } from '../api/types';
import {
  mitBesetzung,
  anVorbelegung,
  besetzungAusStab,
  etbStabVorschlaege,
  besetzungText,
  dekodiere,
  funktionsOptionen,
  kodiere,
  optionsWert,
  type FunktionsVorschlaege,
} from './funktionsOptionenKern';

function e(
  funktion: FuehrungsfunktionEintrag['funktion'],
  label: string,
  kuerzel?: string,
): FuehrungsfunktionEintrag {
  const pflicht = kuerzel === undefined;
  return {
    funktion,
    label,
    standard_label: label,
    kuerzel,
    art: pflicht ? (funktion as 'fachberater') : funktion === 'el' ? 'leitung' : 'sachgebiet',
    bezeichnung_pflicht: pflicht,
  };
}

const KATALOG: FuehrungsfunktionEintrag[] = [
  e('el', 'Einsatzleitung', 'EL'),
  e('s2', 'Lage', 'S2'),
  e('s3', 'Einsatz', 'S3'),
  e('fuehrungshilfspersonal', 'Führungshilfspersonal'),
  e('fachberater', 'Fachberater'),
];

const MIT_MUELLER: FunktionsVorschlaege = {
  katalog: KATALOG,
  besetzung: new Map<Sachgebiet, string>([['s2', 'Müller']]),
};

describe('funktionsOptionen', () => {
  it('ohne Tipptext nur die Einträge ohne Pflicht-Bezeichnung, mit Besetzung im Label', () => {
    expect(funktionsOptionen(MIT_MUELLER)).toEqual([
      { value: 'funktion:el', label: 'Einsatzleitung' },
      { value: 'funktion:s2', label: 'S2 – Lage (Müller)' },
      { value: 'funktion:s3', label: 'S3 – Einsatz' },
    ]);
  });

  it('mit Tipptext zusätzlich Führungshilfspersonal und Fachberater als ausdrückliche Wahl', () => {
    const optionen = funktionsOptionen(MIT_MUELLER, ' THW ');
    expect(optionen.slice(-2)).toEqual([
      { value: 'funktion:fuehrungshilfspersonal:THW', label: 'Führungshilfspersonal: THW' },
      { value: 'funktion:fachberater:THW', label: 'Fachberater: THW' },
    ]);
  });
});

describe('dekodiere', () => {
  it('Katalogwahl mit und ohne Bezeichnung', () => {
    expect(dekodiere('funktion:s3', KATALOG)).toEqual({ funktion: 's3' });
    expect(dekodiere('funktion:fachberater:THW', KATALOG)).toEqual({
      funktion: 'fachberater',
      text: 'THW',
    });
  });

  it('Rohtext „S3“ bleibt Freitext — kein Rückschluss auf den Code', () => {
    expect(dekodiere(' S3 ', KATALOG)).toEqual({ text: 'S3' });
  });

  it('Präfix mit unbekanntem Code ist Freitext', () => {
    expect(dekodiere('funktion:s9', KATALOG)).toEqual({ text: 'funktion:s9' });
  });

  it('leer ist nichts', () => {
    expect(dekodiere('  ', KATALOG)).toEqual({});
  });

  it('kodiere ist die Umkehr', () => {
    for (const w of ['funktion:s3', 'funktion:fachberater:THW', 'S3']) {
      expect(kodiere(dekodiere(w, KATALOG))).toBe(w);
    }
    expect(optionsWert('s2')).toBe('funktion:s2');
  });
});

describe('Besetzung', () => {
  it('Zustandswort statt Name, wo kein Name da ist', () => {
    expect(besetzungText({ zustand: 'nicht_vergeben' })).toBe('nicht vergeben');
    expect(besetzungText({ zustand: 'einsatzleitung' })).toBe('bei der Einsatzleitung');
    expect(besetzungText({ zustand: 'extern', name: 'Müller' })).toBe('Müller');
    // Nach der Schwärzung fehlt der Name: nichts erfinden.
    expect(besetzungText({ zustand: 'personal' })).toBeUndefined();
    expect(besetzungText(undefined)).toBeUndefined();
  });

  it('besetzungAusStab kennt nur belegte Zeilen', () => {
    const karte = besetzungAusStab({
      besetzung: [
        {
          sachgebiet: 's2',
          besetzung_art: 'extern',
          name: 'Müller',
          personal_noch_disponiert: true,
          gesetzt_von_id: 1,
          gesetzt_at: 'x',
        },
        {
          sachgebiet: 's4',
          besetzung_art: 'einsatzleitung',
          personal_noch_disponiert: true,
          gesetzt_von_id: 1,
          gesetzt_at: 'x',
        },
      ],
      anzahl_lagebesprechungen: 0,
    });
    expect([...karte]).toEqual([
      ['s2', 'Müller'],
      ['s4', 'bei der Einsatzleitung'],
    ]);
  });
});

describe('ETB (Nachzug LFH-545)', () => {
  it('schlägt Sachgebiete mit Besetzung vor und übernimmt das Kürzel', () => {
    expect(etbStabVorschlaege(MIT_MUELLER)).toEqual([
      { value: 'S2', label: 'S2 – Lage (Müller)' },
      { value: 'S3', label: 'S3 – Einsatz' },
    ]);
  });

  it('Vorbelegung: Führungsstelle gewinnt gegen die Besetzung', () => {
    expect(
      anVorbelegung({ meine_fuehrungsstelle: 'Fachberater: THW', meine_sachgebiete: ['s2'] }),
    ).toBe('Fachberater: THW');
  });

  it('Vorbelegung: sonst das erste eigene Sachgebiet in S1–S6-Folge', () => {
    expect(anVorbelegung({ meine_sachgebiete: ['s3', 's2'] })).toBe('S2');
  });

  it('Vorbelegung: weder noch bleibt leer', () => {
    expect(anVorbelegung({ meine_fuehrungsstelle: '  ', meine_sachgebiete: [] })).toBeUndefined();
  });
});

describe('mitBesetzung', () => {
  it('hängt die Auflösung an den Snapshot, ohne sie steht er allein', () => {
    expect(mitBesetzung('S3 Einsatz', { zustand: 'extern', name: 'Schulz' })).toBe(
      'S3 Einsatz · Schulz',
    );
    expect(mitBesetzung('S4 Versorgung', { zustand: 'nicht_vergeben' })).toBe(
      'S4 Versorgung · nicht vergeben',
    );
    expect(mitBesetzung('S3', undefined)).toBe('S3');
    expect(mitBesetzung('S3 Einsatz', null)).toBe('S3 Einsatz');
  });
});
