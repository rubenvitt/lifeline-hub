import { describe, expect, it } from 'vitest';
import type { EinsatzAnzeige, FuehrungsfunktionEintrag, MitgliedAnzeige, Stab } from '../api/types';
import {
  besetzteFunktionen,
  erwaehnungenAusText,
  erwaehnungsVorschlaege,
  type ErwaehnungVorschlag,
} from './erwaehnung';

function eintrag(
  funktion: FuehrungsfunktionEintrag['funktion'],
  kuerzel: string | null,
  label: string,
): FuehrungsfunktionEintrag {
  return {
    funktion,
    kuerzel,
    label,
    standard_label: label,
    art: kuerzel ? 'sachgebiet' : 'fachberater',
    bezeichnung_pflicht: kuerzel === null,
  } as FuehrungsfunktionEintrag;
}

const KATALOG: FuehrungsfunktionEintrag[] = [
  eintrag('el', 'EL', 'Einsatzleitung'),
  eintrag('s1', 'S1', 'Personal'),
  eintrag('s2', 'S2', 'Lage'),
  eintrag('s4', 'S4', 'Versorgung'),
  eintrag('fachberater', null, 'Fachberater'),
];

function mitglied(
  benutzer_id: number,
  anzeigename: string,
  extra: Partial<MitgliedAnzeige> = {},
): MitgliedAnzeige {
  return {
    benutzer_id,
    anzeigename,
    benutzername: anzeigename.toLowerCase().replace(/\s/g, ''),
    einsatz_rolle: 'fuehrungspersonal',
    zugewiesen_at: '2026-10-15 08:00:00',
    ...extra,
  } as MitgliedAnzeige;
}

describe('besetzteFunktionen', () => {
  it('nimmt Einsatzleiter, Stab-Besetzung und Mitgliedschaft, nicht extern', () => {
    const stab = {
      besetzung: [
        { sachgebiet: 's2', besetzung_art: 'personal' },
        { sachgebiet: 's1', besetzung_art: 'einsatzleitung' },
        { sachgebiet: 's3', besetzung_art: 'extern' },
      ],
    } as unknown as Stab;
    const einsatz = { einsatzleiter: { art: 'personal' } } as unknown as EinsatzAnzeige;
    const mitglieder = [mitglied(1, 'Anna', { fuehrungsfunktion: 's4' })];
    expect([...besetzteFunktionen(mitglieder, stab, einsatz)].sort()).toEqual([
      'el',
      's1',
      's2',
      's4',
    ]);
  });

  it('ohne Stab-Recht und ohne Einsatzleiter zählen nur die Mitgliedschaften', () => {
    expect([...besetzteFunktionen([mitglied(1, 'Anna')], undefined, undefined)]).toEqual([]);
  });
});

describe('erwaehnungsVorschlaege', () => {
  it('besetzte Funktionen mit Kürzel zuerst, dann die anderen Mitglieder', () => {
    const vorschlaege = erwaehnungsVorschlaege(
      KATALOG,
      new Set(['el', 's4', 'fachberater'] as const),
      [
        mitglied(1, 'Anna Albers'),
        mitglied(2, 'Bert Brandt', { fuehrungsstelle_anzeige: 'S2 Lage' }),
      ],
      1,
    );
    expect(vorschlaege).toEqual([
      { wert: 'EL', label: 'Einsatzleitung', erwaehnung: { funktion: 'el' } },
      { wert: 'S4', label: 'S4 – Versorgung', erwaehnung: { funktion: 's4' } },
      { wert: 'Bert Brandt', label: 'Bert Brandt · S2 Lage', erwaehnung: { benutzer_id: 2 } },
    ]);
  });

  it('gleiche Namen bekommen den Benutzernamen dazu', () => {
    const werte = erwaehnungsVorschlaege(
      KATALOG,
      new Set(),
      [mitglied(2, 'Kai'), mitglied(3, 'Kai', { benutzername: 'kai2' })],
      undefined,
    ).map((v) => v.wert);
    expect(werte).toEqual(['Kai (kai)', 'Kai (kai2)']);
  });
});

describe('erwaehnungenAusText', () => {
  const vorschlaege: ErwaehnungVorschlag[] = [
    { wert: 'S4', label: '', erwaehnung: { funktion: 's4' } },
    { wert: 'Anna', label: '', erwaehnung: { benutzer_id: 1 } },
    { wert: 'Anna Albers', label: '', erwaehnung: { benutzer_id: 2 } },
  ];

  it('findet jeden @Wert einmal, in der Reihenfolge des Texts', () => {
    expect(erwaehnungenAusText('@Anna, bitte mit @s4 klären. @Anna?', vorschlaege)).toEqual([
      { benutzer_id: 1 },
      { funktion: 's4' },
    ]);
  });

  it('der längste Wert gewinnt; ein Wort, das nur so anfängt, zählt nicht', () => {
    expect(erwaehnungenAusText('@Anna Albers und @S45 und @Annabell', vorschlaege)).toEqual([
      { benutzer_id: 2 },
    ]);
  });

  it('ohne @ oder mit gelöschtem Namen niemand', () => {
    expect(erwaehnungenAusText('S4 und Anna', vorschlaege)).toEqual([]);
    expect(erwaehnungenAusText('@ bitte', vorschlaege)).toEqual([]);
  });
});
