import { describe, expect, it } from 'vitest';
import type { Abloesung } from '../api/types';
import { abloeserIds, abloeserOptionen, abloeserText } from './abloeser';

const schicht = (over: Partial<Abloesung> & { id: number; einheit_id: number }): Abloesung => ({
  einsatz_id: 1,
  einheit_name: `Einheit ${over.einheit_id}`,
  beginn_at: '2026-10-17 06:00:00',
  rhythmus_minuten: 360,
  vorwarnung_minuten: 30,
  rhythmus_quelle: 'einheit',
  faellig_at: '2026-10-17 12:00:00',
  status: 'laufend',
  ruecknehmbar: false,
  erbende_einheiten: [],
  abloeser: [],
  folgeschichten: [],
  uebernommen_bei_vollzug: false,
  art: 'einheit',
  besatzung: [],
  verbleib: 'ruhe' as const,
  abschnitt_uebergeben: false,
  planung_warnungen: [],
  angelegt_at: '2026-10-17 06:00:00',
  ...over,
});

const einheiten = [
  { id: 1, name: 'Florian 1' },
  { id: 2, name: 'Florian 2' },
  { id: 3, name: 'Florian 3' },
  { id: 4, name: 'Florian 4' },
];

describe('abloeser (LLH-1132)', () => {
  it('die Liste führt, ohne sie gilt der Spiegel', () => {
    expect(
      abloeserIds(
        schicht({
          id: 1,
          einheit_id: 1,
          abloesende_einheit_id: 3,
          abloeser: [
            { einheit_id: 3, einheit_name: 'Florian 3' },
            { einheit_id: 2, einheit_name: 'Florian 2' },
          ],
        }),
      ),
    ).toEqual([3, 2]);
    expect(abloeserIds(schicht({ id: 1, einheit_id: 1, abloesende_einheit_id: 4 }))).toEqual([4]);
    expect(abloeserIds(schicht({ id: 1, einheit_id: 1 }))).toEqual([]);
  });

  it('der Text nennt alle Ablöser in ihrer Reihenfolge und vermerkt eine übernommene Schicht', () => {
    const s = schicht({
      id: 1,
      einheit_id: 1,
      status: 'abgeloest',
      abloeser: [
        { einheit_id: 2, einheit_name: 'Florian 2' },
        { einheit_id: 3, einheit_name: 'Florian 3' },
      ],
      folgeschichten: [
        { id: 8, einheit_id: 2, einheit_name: 'Florian 2', status: 'laufend', uebernommen: true },
        { id: 9, einheit_id: 3, einheit_name: 'Florian 3', status: 'laufend', uebernommen: false },
      ],
    });
    expect(abloeserText(s)).toBe('Florian 2 (Schicht übernommen), Florian 3');
    expect(abloeserText(schicht({ id: 1, einheit_id: 1 }))).toBeNull();
    expect(
      abloeserText(schicht({ id: 1, einheit_id: 1, abloesende_einheit_name: 'Florian 4' })),
    ).toBe('Florian 4');
  });

  it('wählbar ist jede andere Einheit ohne laufende Folgeschicht; eine eigene Schicht wird genannt', () => {
    const abgeloest = schicht({ id: 1, einheit_id: 1 });
    const laufende = [
      abgeloest,
      // Florian 2 lief ungeplant los: übernehmbar.
      schicht({ id: 2, einheit_id: 2 }),
      // Florian 3 führt schon eine Folgeschicht: nicht wählbar.
      schicht({ id: 3, einheit_id: 3, vorgaenger_id: 99 }),
    ];
    expect(abloeserOptionen(einheiten, laufende, abgeloest)).toEqual([
      { value: 2, label: 'Florian 2 · Schicht läuft' },
      { value: 4, label: 'Florian 4' },
    ]);
  });
});
