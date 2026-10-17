import { describe, expect, it } from 'vitest';
import type { Abloesung, EinheitPerioden } from '../api/types';
import { abloeserStandText, buildAbloeserStand, hasAbloeserStand } from './abloeserStand';

const konv = { zeitzone: 'Europe/Berlin' };

const schicht = (over: Partial<Abloesung> = {}): Abloesung => ({
  id: 1,
  einsatz_id: 1,
  einheit_id: 11,
  einheit_name: 'Rettungsstaffel',
  beginn_at: '2026-01-05 06:00:00',
  rhythmus_minuten: 480,
  vorwarnung_minuten: 30,
  rhythmus_quelle: 'einsatz',
  faellig_at: '2026-01-05 14:00:00',
  status: 'laufend',
  ruecknehmbar: false,
  erbende_einheiten: [],
  abloeser: [{ einheit_id: 21, einheit_name: '2. Rettungsstaffel' }],
  folgeschichten: [],
  uebernommen_bei_vollzug: false,
  abschnitt_uebergeben: false,
  planung_warnungen: [],
  angelegt_at: '2026-01-05 06:00:00',
  ...over,
});

const perioden = (einheit_id: number, ...p: EinheitPerioden['perioden']): EinheitPerioden => ({
  einheit_id,
  perioden: p,
});

describe('buildAbloeserStand (LLH-1131 Teil II)', () => {
  it('liest Alarmierung und Eintreffen aus der offenen Periode des Ablösers, den Raum aus der Einheit', () => {
    const stand = buildAbloeserStand(schicht(), {
      perioden: [
        perioden(21, {
          anker: 'alarmierung',
          beginn_at: '2026-01-05 12:40:00',
          eintreffen_at: '2026-01-05 13:12:00',
        }),
      ],
      einheiten: [{ id: 21, aktueller_br_id: 4 }],
      brNamen: new Map([[4, 'BR Sportplatz']]),
    });
    expect(stand).toEqual([
      {
        einheit_id: 21,
        einheit_name: '2. Rettungsstaffel',
        alarmiert_at: '2026-01-05 12:40:00',
        eingetroffen_at: '2026-01-05 13:12:00',
        br_name: 'BR Sportplatz',
      },
    ]);
    expect(abloeserStandText(stand!, konv)).toBe(
      'Ablösung: 2. Rettungsstaffel · alarmiert 051340 · eingetroffen 051412 (BR Sportplatz)',
    );
  });

  it('eine Periode, die mit dem Eintreffen begann, kennt keine Alarmierung', () => {
    const stand = buildAbloeserStand(schicht(), {
      perioden: [
        perioden(21, {
          anker: 'eintreffen',
          beginn_at: '2026-01-05 13:12:00',
          eintreffen_at: '2026-01-05 13:12:00',
        }),
      ],
    });
    expect(stand?.[0]).toMatchObject({ alarmiert_at: null, br_name: null });
    expect(abloeserStandText(stand!, konv)).toBe(
      'Ablösung: 2. Rettungsstaffel · eingetroffen 051412',
    );
  });

  it('eine beendete Periode zählt nicht: nur die offene trägt den Stand', () => {
    const stand = buildAbloeserStand(schicht(), {
      perioden: [
        perioden(21, {
          anker: 'alarmierung',
          beginn_at: '2026-01-05 08:00:00',
          eintreffen_at: '2026-01-05 08:30:00',
          ende_at: '2026-01-05 10:00:00',
          ende_art: 'entlassung',
        }),
      ],
    });
    expect(stand).toBeNull();
  });

  it('mehrere Ablöser in der Reihenfolge der Liste; einer ohne Ereignis steht nur mit Namen', () => {
    const stand = buildAbloeserStand(
      schicht({
        abloeser: [
          { einheit_id: 21, einheit_name: '2. Rettungsstaffel' },
          { einheit_id: 22, einheit_name: 'Florian 3' },
        ],
      }),
      {
        perioden: [perioden(21, { anker: 'alarmierung', beginn_at: '2026-01-05 12:40:00' })],
      },
    );
    expect(stand?.map((s) => s.einheit_id)).toEqual([21, 22]);
    expect(abloeserStandText(stand!, konv)).toBe(
      'Ablösung: 2. Rettungsstaffel · alarmiert 051340; Florian 3',
    );
  });

  it('ohne Ereignis bei allen Ablösern kein Stand: die Karte bleibt bei „geplant durch“', () => {
    expect(buildAbloeserStand(schicht(), { perioden: [] })).toBeNull();
    // Der Raum allein ist kein Ereignis der Zeitachse.
    expect(
      buildAbloeserStand(schicht(), {
        perioden: [],
        einheiten: [{ id: 21, aktueller_br_id: 4 }],
        brNamen: new Map([[4, 'BR Sportplatz']]),
      }),
    ).toBeNull();
  });

  it('ohne Namen des Raums (Modul gesperrt) fehlt die Klammer, statt etwas zu erfinden', () => {
    const stand = buildAbloeserStand(schicht(), {
      perioden: [perioden(21, { anker: 'eintreffen', beginn_at: '2026-01-05 13:12:00' })],
      einheiten: [{ id: 21, aktueller_br_id: 4 }],
    });
    expect(stand?.[0].br_name).toBeNull();
  });

  it('nur laufende Schichten: eine abgelöste oder beendete hat keinen Stand des Ablösers', () => {
    const q = {
      perioden: [perioden(21, { anker: 'alarmierung' as const, beginn_at: '2026-01-05 12:40:00' })],
    };
    expect(buildAbloeserStand(schicht({ status: 'abgeloest' }), q)).toBeNull();
    expect(buildAbloeserStand(schicht({ status: 'beendet' }), q)).toBeNull();
  });

  it('ohne Liste gilt der Spiegel der Einzelplanung (Bestand)', () => {
    const stand = buildAbloeserStand(
      schicht({
        abloeser: [],
        abloesende_einheit_id: 21,
        abloesende_einheit_name: '2. Rettungsstaffel',
      }),
      { perioden: [perioden(21, { anker: 'alarmierung', beginn_at: '2026-01-05 12:40:00' })] },
    );
    expect(stand?.[0].einheit_name).toBe('2. Rettungsstaffel');
  });

  it('hasAbloeserStand: Alarmierung oder Eintreffen zählt', () => {
    const leer = {
      einheit_id: 1,
      einheit_name: 'x',
      alarmiert_at: null,
      eingetroffen_at: null,
      br_name: 'BR 1',
    };
    expect(hasAbloeserStand(leer)).toBe(false);
    expect(hasAbloeserStand({ ...leer, alarmiert_at: '2026-01-05 12:40:00' })).toBe(true);
    expect(hasAbloeserStand({ ...leer, eingetroffen_at: '2026-01-05 12:40:00' })).toBe(true);
  });
});
