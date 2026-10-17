import { describe, expect, it } from 'vitest';
import type { Abloesung } from '../api/types';
import {
  besatzungOptionen,
  besatzungText,
  bisherigeBesatzung,
  type BesatzungEinheit,
  type BesatzungPerson,
} from './besatzung';

const schicht = (over: Partial<Abloesung> = {}): Abloesung => ({
  id: 1,
  einsatz_id: 1,
  einheit_id: 1,
  einheit_name: 'Florian 1',
  beginn_at: '2026-10-17 06:00:00',
  rhythmus_minuten: 360,
  vorwarnung_minuten: 30,
  rhythmus_quelle: 'einheit',
  faellig_at: '2026-10-17 12:00:00',
  status: 'laufend',
  ruecknehmbar: false,
  erbende_einheiten: [{ einheit_id: 2, einheit_name: 'Gruppe 1' }],
  abloeser: [],
  folgeschichten: [],
  uebernommen_bei_vollzug: false,
  art: 'einheit',
  besatzung: [],
  abschnitt_uebergeben: false,
  planung_warnungen: [],
  angelegt_at: '2026-10-17 06:00:00',
  ...over,
});

const mitglied = (ep_id: number, name: string) => ({
  ep_id,
  name,
  ist_fuehrer: false,
});

// Florian 1 (geführt von Anna) mit Gruppe 1, die die Schicht erbt; Florian 2 von Fritz geführt.
const einheiten: BesatzungEinheit[] = [
  { id: 1, name: 'Florian 1', fuehrer_id: 10, personal_mitglieder: [mitglied(10, 'Anna')] },
  { id: 2, name: 'Gruppe 1', personal_mitglieder: [mitglied(11, 'Bernd')] },
  {
    id: 3,
    name: 'Florian 2',
    fuehrer_id: 13,
    personal_mitglieder: [mitglied(13, 'Fritz'), mitglied(14, 'Dirk')],
  },
];

const person = (id: number, name: string, einheit_id?: number, beendet_at?: string) =>
  ({ id, name, einheit_id, beendet_at }) as BesatzungPerson;

describe('besatzung (LLH-1150)', () => {
  it('die bisherige Besatzung: Einheit, dann ihre Erben', () => {
    expect(bisherigeBesatzung(schicht(), einheiten)).toEqual(['Anna', 'Bernd']);
    expect(bisherigeBesatzung(schicht({ erbende_einheiten: [] }), einheiten)).toEqual(['Anna']);
    expect(bisherigeBesatzung(schicht(), undefined)).toBeNull();
  });

  it('wählbar ist jede aktive Person außerhalb der bisherigen Besatzung, Führer anderer gesperrt', () => {
    const personal = [
      person(10, 'Anna', 1),
      person(11, 'Bernd', 2),
      person(12, 'Cora'),
      person(13, 'Fritz', 3),
      person(14, 'Dirk', 3),
      person(15, 'Erik', undefined, '2026-10-17 07:00:00'),
    ];
    expect(besatzungOptionen(personal, einheiten, schicht())).toEqual([
      { value: 12, label: 'Cora' },
      { value: 13, label: 'Fritz · führt Florian 2', disabled: true },
      { value: 14, label: 'Dirk · Florian 2' },
    ]);
  });

  it('nach dem Vollzug nennt die Schicht beide Besatzungen', () => {
    const s = schicht({
      status: 'abgeloest',
      art: 'besatzung',
      besatzung: [
        { personal_id: 10, name: 'Anna', rolle: 'alt' },
        { personal_id: 12, name: 'Cora', rolle: 'neu' },
        { personal_id: 14, name: 'Dirk', rolle: 'neu' },
      ],
    });
    expect(besatzungText(s, 'neu')).toBe('Cora, Dirk');
    expect(besatzungText(s, 'alt')).toBe('Anna');
    expect(besatzungText(schicht(), 'neu')).toBeNull();
  });
});
