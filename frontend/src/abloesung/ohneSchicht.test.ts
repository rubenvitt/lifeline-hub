import { describe, expect, it } from 'vitest';
import type { Abloesung, EinheitPerioden } from '../api/types';
import { findOhneSchicht, ohneSchichtZuflussText, type EinheitKurz } from './ohneSchicht';

const einheit = (id: number, name: string, abschnitt_name: string | null = null): EinheitKurz => ({
  id,
  name,
  abschnitt_name,
});

const offen = (einheit_id: number, beginn_at: string, eintreffen_at?: string): EinheitPerioden => ({
  einheit_id,
  perioden: [
    {
      anker: eintreffen_at === beginn_at ? 'eintreffen' : 'alarmierung',
      beginn_at,
      eintreffen_at: eintreffen_at ?? null,
    },
  ],
});

const schicht = (over: Partial<Abloesung> & { einheit_id: number }): Abloesung => ({
  id: over.einheit_id + 100,
  einsatz_id: 1,
  einheit_name: `Einheit ${over.einheit_id}`,
  beginn_at: '2026-10-17 06:00:00',
  rhythmus_minuten: 360,
  vorwarnung_minuten: 30,
  rhythmus_quelle: 'einsatz',
  faellig_at: '2026-10-17 12:00:00',
  status: 'laufend',
  ruecknehmbar: false,
  erbende_einheiten: [],
  abloeser: [],
  folgeschichten: [],
  uebernommen_bei_vollzug: false,
  abschnitt_uebergeben: false,
  angelegt_at: '2026-10-17 06:00:00',
  ...over,
});

describe('findOhneSchicht (LLH-1128)', () => {
  it('nennt Einheiten mit offener Periode ohne eigene laufende Schicht, längste zuerst', () => {
    const ergebnis = findOhneSchicht(
      [einheit(1, 'Florian 1', 'Deich'), einheit(2, 'Florian 2'), einheit(3, 'Florian 3')],
      [
        offen(1, '2026-10-17 08:00:00', '2026-10-17 08:20:00'),
        offen(2, '2026-10-17 07:00:00'),
        offen(3, '2026-10-17 06:00:00', '2026-10-17 06:00:00'),
      ],
      [schicht({ einheit_id: 3 })],
    );
    expect(ergebnis).toEqual([
      {
        id: 2,
        einheit_name: 'Florian 2',
        abschnitt_name: null,
        beginn_at: '2026-10-17 07:00:00',
        eintreffen_at: null,
        abloeser_fuer: null,
      },
      {
        id: 1,
        einheit_name: 'Florian 1',
        abschnitt_name: 'Deich',
        beginn_at: '2026-10-17 08:00:00',
        eintreffen_at: '2026-10-17 08:20:00',
        abloeser_fuer: null,
      },
    ]);
  });

  it('eine geschlossene letzte Periode zählt nicht, eine offene nach geschlossenen schon', () => {
    const ergebnis = findOhneSchicht(
      [einheit(1, 'Florian 1'), einheit(2, 'Florian 2')],
      [
        {
          einheit_id: 1,
          perioden: [
            {
              anker: 'eintreffen',
              beginn_at: '2026-10-17 06:00:00',
              eintreffen_at: '2026-10-17 06:00:00',
              ende_art: 'entlassung',
              ende_at: '2026-10-17 09:00:00',
            },
          ],
        },
        {
          einheit_id: 2,
          perioden: [
            {
              anker: 'eintreffen',
              beginn_at: '2026-10-17 05:00:00',
              eintreffen_at: '2026-10-17 05:00:00',
              ende_art: 'abloesung',
              ende_at: '2026-10-17 07:00:00',
            },
            { anker: 'alarmierung', beginn_at: '2026-10-17 10:00:00' },
          ],
        },
      ],
      [],
    );
    expect(ergebnis.map((e) => e.id)).toEqual([2]);
    expect(ergebnis[0].beginn_at).toBe('2026-10-17 10:00:00');
  });

  it('wer die Schicht eines Vorfahren erbt, steht nicht ohne Schicht (Knoten-Modell)', () => {
    const ergebnis = findOhneSchicht(
      [einheit(1, 'Zug'), einheit(2, '1. Trupp'), einheit(3, '2. Trupp')],
      [
        offen(1, '2026-10-17 06:00:00'),
        offen(2, '2026-10-17 06:00:00'),
        offen(3, '2026-10-17 06:00:00'),
      ],
      [
        schicht({
          einheit_id: 1,
          erbende_einheiten: [{ einheit_id: 2, einheit_name: '1. Trupp' }],
        }),
      ],
    );
    expect(ergebnis.map((e) => e.einheit_name)).toEqual(['2. Trupp']);
  });

  it('ein geplanter Ablöser steht mit der abzulösenden Einheit', () => {
    const ergebnis = findOhneSchicht(
      [einheit(1, 'Florian 1'), einheit(2, 'Florian 2')],
      [offen(2, '2026-10-17 10:00:00')],
      [schicht({ einheit_id: 1, einheit_name: 'Florian 1', abloesende_einheit_id: 2 })],
    );
    expect(ergebnis).toHaveLength(1);
    expect(ergebnis[0].abloeser_fuer).toBe('Florian 1');
  });

  it('nur Einheiten der Liste: eine aufgelöste mit offener Periode fehlt', () => {
    expect(
      findOhneSchicht([einheit(1, 'Florian 1')], [offen(9, '2026-10-17 06:00:00')], []),
    ).toEqual([]);
  });

  it('gleicher Beginn: Zweitrang ist die Kennung', () => {
    const ergebnis = findOhneSchicht(
      [einheit(5, 'B'), einheit(4, 'A')],
      [offen(5, '2026-10-17 06:00:00'), offen(4, '2026-10-17 06:00:00')],
      [],
    );
    expect(ergebnis.map((e) => e.id)).toEqual([4, 5]);
  });
});

describe('ohneSchichtZuflussText', () => {
  it('zählt Neuzugänge in der Einzahl und Mehrzahl und nennt eine Umordnung', () => {
    expect(ohneSchichtZuflussText(1, false)).toBe('1 neue Einheit ohne Schicht');
    expect(ohneSchichtZuflussText(3, false)).toBe('3 neue Einheiten ohne Schicht');
    expect(ohneSchichtZuflussText(0, true)).toBe('Reihenfolge geändert');
    expect(ohneSchichtZuflussText(2, true)).toBe(
      '2 neue Einheiten ohne Schicht · Reihenfolge geändert',
    );
  });
});
