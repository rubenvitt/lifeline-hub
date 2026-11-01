import { describe, expect, it } from 'vitest';
import type { Abloesung } from '../api/types';
import {
  besatzungOptionen,
  besatzungPlanText,
  besatzungText,
  besatzungZiele,
  bisherigeBesatzung,
  gleicheIds,
  gleicherPlan,
  nachBesatzungswechselText,
  planVorbelegung,
  verteilungKopf,
  verteilungZiele,
  type BesatzungEinheit,
  type BesatzungOption,
  type BesatzungPerson,
  type VerteilungEinheit,
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
  besatzung_plan: [],
  nach_besatzungswechsel: [],
  verbleib: 'ruhe' as const,
  beginn_quelle: 'hand' as const,
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
      { value: 12, label: 'Cora', name: 'Cora' },
      { value: 13, label: 'Fritz · führt Florian 2', name: 'Fritz', disabled: true },
      { value: 14, label: 'Dirk · Florian 2', name: 'Dirk' },
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

describe('Verteilung und Planung (LLH-1319)', () => {
  const fahrzeug = (ef_id: number, funkrufname: string) => ({ ef_id, funkrufname });
  // Florian 1 ohne Fahrzeug, Gruppe 1 (erbt) mit „Florian 1-44“, Florian 2 mit „Florian 2-83“.
  const verteilEinheiten: VerteilungEinheit[] = [
    { id: 1, name: 'Florian 1', fahrzeug_mitglieder: [] },
    { id: 2, name: 'Gruppe 1', fahrzeug_mitglieder: [fahrzeug(44, 'Florian 1-44')] },
    { id: 3, name: 'Florian 2', fahrzeug_mitglieder: [fahrzeug(83, 'Florian 2-83')] },
  ];

  it('Ziele: die Einheit, ihre Erben und deren Fahrzeuge; ohne Wahl kein Klappteil', () => {
    expect(verteilungZiele(schicht(), verteilEinheiten)).toEqual({
      einheiten: [
        { value: 1, label: 'Florian 1' },
        { value: 2, label: 'Gruppe 1' },
      ],
      fahrzeuge: [{ value: 44, label: 'Florian 1-44' }],
    });
    // Ohne Erben bleibt das Fahrzeug der Einheit selbst.
    const allein: VerteilungEinheit[] = [
      { id: 1, name: 'Florian 1', fahrzeug_mitglieder: [fahrzeug(45, 'Florian 1-45')] },
    ];
    expect(verteilungZiele(schicht({ erbende_einheiten: [] }), allein)).toEqual({
      einheiten: [{ value: 1, label: 'Florian 1' }],
      fahrzeuge: [{ value: 45, label: 'Florian 1-45' }],
    });
    // Keine Erben, keine Fahrzeuge: nichts zu wählen.
    expect(verteilungZiele(schicht({ erbende_einheiten: [] }), verteilEinheiten)).toBeNull();
    expect(verteilungZiele(schicht(), undefined)).toBeNull();
  });

  it('Kopf nennt die Abweichung, die Ziele lassen die Vorgabe weg', () => {
    const s = schicht();
    expect(verteilungKopf([12, 14], {}, s)).toBe('Verteilen · alle in Florian 1');
    // Die Einheit der Schicht ausdrücklich gewählt ist keine Abweichung.
    expect(verteilungKopf([12], { '12': { einheit_id: 1 } }, s)).toBe(
      'Verteilen · alle in Florian 1',
    );
    const verteilung = { '12': { einheit_id: 2, fahrzeug_id: 44 }, '14': { einheit_id: 1 } };
    expect(verteilungKopf([12, 14], verteilung, s)).toBe('Verteilen · 1 verteilt');
    expect(besatzungZiele([12, 14], verteilung, s)).toEqual([
      { personal_id: 12, einheit_id: 2, fahrzeug_id: 44 },
      { personal_id: 14 },
    ]);
    // Eine abgewählte Person zählt nicht mehr, auch wenn ihr Ziel noch im Formular steht.
    expect(verteilungKopf([14], verteilung, s)).toBe('Verteilen · alle in Florian 1');
  });

  it('gleicher Plan: Reihenfolge und Ziele zählen, die Einheit der Schicht ist kein Ziel', () => {
    const s = schicht({
      besatzung_plan: [
        { personal_id: 12, name: 'Cora', einheit_id: 2, einheit_name: 'Gruppe 1', fahrzeug_id: 44 },
        { personal_id: 14, name: 'Dirk' },
      ],
    });
    const plan = [{ personal_id: 12, einheit_id: 2, fahrzeug_id: 44 }, { personal_id: 14 }];
    expect(gleicherPlan(plan, s)).toBe(true);
    expect(gleicherPlan([plan[0], { personal_id: 14, einheit_id: 1 }], s)).toBe(true);
    expect(gleicherPlan([plan[1], plan[0]], s)).toBe(false);
    expect(gleicherPlan([plan[0], { personal_id: 14, fahrzeug_id: 44 }], s)).toBe(false);
    expect(gleicherPlan([plan[0]], s)).toBe(false);
    expect(gleicherPlan([], schicht())).toBe(true);
    expect(gleicheIds([12, 13], [12, 13])).toBe(true);
    expect(gleicheIds([13, 12], [12, 13])).toBe(false);
  });

  it('Vorbelegung aus der Planung: nur wählbare Personen, nur bestehende Ziele', () => {
    const s = schicht({
      besatzung_plan: [
        { personal_id: 12, name: 'Cora', einheit_id: 2, einheit_name: 'Gruppe 1', fahrzeug_id: 44 },
        { personal_id: 13, name: 'Fritz' },
        { personal_id: 15, name: 'Erik' },
        { personal_id: 14, name: 'Dirk', fahrzeug_id: 99, funkrufname: 'weg' },
      ],
    });
    const personen: BesatzungOption[] = [
      { value: 12, label: 'Cora', name: 'Cora' },
      { value: 13, label: 'Fritz · führt Florian 2', name: 'Fritz', disabled: true },
      { value: 14, label: 'Dirk · Florian 2', name: 'Dirk' },
    ];
    const ziele = verteilungZiele(s, verteilEinheiten);
    expect(planVorbelegung(s, personen, ziele)).toEqual({
      ids: [12, 14],
      verteilung: { '12': { einheit_id: 2, fahrzeug_id: 44 }, '14': {} },
    });
    // Ohne Ziele (kein Klappteil) bleibt nur die Auswahl.
    expect(planVorbelegung(s, personen, null)).toEqual({
      ids: [12, 14],
      verteilung: { '12': {}, '14': {} },
    });
  });

  it('Texte der Planung und der Folgeschicht', () => {
    const s = schicht({
      besatzung_plan: [
        {
          personal_id: 12,
          name: 'Cora',
          einheit_id: 2,
          einheit_name: 'Gruppe 1',
          fahrzeug_id: 44,
          funkrufname: 'Florian 1-44',
        },
        { personal_id: 14, name: 'Dirk' },
      ],
    });
    expect(besatzungPlanText(s)).toEqual({
      kurz: 'Cora, Dirk',
      voll: 'Cora (Gruppe 1, Florian 1-44), Dirk',
    });
    expect(besatzungPlanText(schicht())).toBeNull();
    const folge = schicht({
      nach_besatzungswechsel: [
        { personal_id: 12, name: 'Cora', rolle: 'neu' },
        { personal_id: 14, name: 'Dirk', rolle: 'neu' },
      ],
    });
    expect(nachBesatzungswechselText(folge)).toBe('Cora, Dirk');
    expect(nachBesatzungswechselText(schicht())).toBeNull();
  });
});
