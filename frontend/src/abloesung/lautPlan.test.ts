import { describe, expect, it } from 'vitest';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import { DEFAULT_KONVENTIONEN } from '../anzeige/format';
import type { Abloesung, AbloesungPlanVorlage } from '../api/types';
import {
  folgtPlan,
  lautPlanText,
  planVollzugBody,
  vorlageWechselt,
  vorlageZeilen,
} from './lautPlan';

dayjs.extend(utc);

/** LLH-1555: Texte und Vollzug laut Schichtplan; der Server rechnet, der Client setzt nur zusammen. */
const schicht = (over: Partial<Abloesung> = {}): Abloesung =>
  ({
    id: 3,
    einheit_id: 11,
    status: 'laufend',
    faellig_laut_plan: true,
    plan_folgeblock: null,
    ...over,
  }) as unknown as Abloesung;

const vorlage = (over: Partial<AbloesungPlanVorlage> = {}): AbloesungPlanVorlage => ({
  folgeblock_id: 40,
  wechsel_at: '2026-10-17 14:00:00',
  kommen: [],
  bleiben: [],
  gehen: [],
  fehlen: [],
  ...over,
});

const konv = { ...DEFAULT_KONVENTIONEN, zeitzone: 'UTC' };
const jetzt = dayjs.utc('2026-10-17 12:00:00');

describe('lautPlan (LLH-1555)', () => {
  it('folgt dem Plan nur laufend', () => {
    expect(folgtPlan(schicht())).toBe(true);
    expect(folgtPlan(schicht({ status: 'abgeloest' }))).toBe(false);
    expect(folgtPlan(schicht({ faellig_laut_plan: false }))).toBe(false);
  });

  it('Kartenzeile: Folgeblock mit Personenzahl, sonst „Posten endet“', () => {
    const block = (personen: number) =>
      schicht({
        plan_folgeblock: {
          id: 1,
          von: '2026-10-17 14:00:00',
          bis: '2026-10-17 16:00:00',
          personen,
        },
      });
    expect(lautPlanText(block(3), konv, jetzt)).toBe('Laut Plan · danach 1400–1600 · 3 Personen');
    expect(lautPlanText(block(1), konv, jetzt)).toBe('Laut Plan · danach 1400–1600 · 1 Person');
    expect(lautPlanText(block(0), konv, jetzt)).toBe(
      'Laut Plan · danach 1400–1600 · niemand eingeteilt',
    );
    expect(lautPlanText(schicht(), konv, jetzt)).toBe('Laut Plan · Posten endet');
    expect(lautPlanText(schicht({ faellig_laut_plan: false }), konv, jetzt)).toBeNull();
  });

  it('Zeilen der Vorlage: „keine“ ohne Namen, „Fehlt“ nur mit', () => {
    expect(
      vorlageZeilen(vorlage({ kommen: [{ personal_id: 1, name: 'Cora', einheit_id: 11 }] })),
    ).toEqual([
      { wort: 'Kommt', text: 'Cora' },
      { wort: 'Bleibt', text: 'keine' },
      { wort: 'Geht', text: 'keine' },
    ]);
    expect(vorlageZeilen(vorlage({ fehlen: ['Erik', 'Fred'] }))[3]).toEqual({
      wort: 'Fehlt',
      text: 'Erik, Fred',
    });
  });

  it('ein Wechsel laut Plan braucht Folgeblock und jemanden, der kommt oder bleibt', () => {
    expect(vorlageWechselt(vorlage())).toBe(false);
    expect(vorlageWechselt(vorlage({ bleiben: [{ personal_id: 2, name: 'Dana' }] }))).toBe(true);
    expect(
      vorlageWechselt(
        vorlage({ folgeblock_id: null, bleiben: [{ personal_id: 2, name: 'Dana' }] }),
      ),
    ).toBe(false);
  });

  it('Vollzug: Kräfte in besatzung, Plan-Personen in uebernahme, Ziel nur bei fremder Einheit', () => {
    const body = planVollzugBody(
      schicht(),
      vorlage({
        kommen: [
          { personal_id: 21, name: 'Cora', einheit_id: 12 },
          { stamm_personal_id: 5, name: 'Ben', einheit_id: 11 },
          { plan_helfer_id: 9, name: 'Cem', einheit_id: 12 },
        ],
        bleiben: [{ personal_id: 30, name: 'Dana' }],
      }),
      dayjs.utc('2026-10-17 13:55:00'),
    );
    expect(body).toEqual({
      vollzogen_at: '2026-10-17 13:55:00',
      art: 'besatzung',
      besatzung: [{ personal_id: 21, einheit_id: 12 }],
      uebernahme: [{ stamm_personal_id: 5 }, { plan_helfer_id: 9, einheit_id: 12 }],
      bleiben: [30],
      plan_block_id: 40,
    });
    expect(planVollzugBody(schicht(), vorlage(), null)).toEqual({
      vollzogen_at: undefined,
      art: 'besatzung',
      besatzung: [],
      plan_block_id: 40,
    });
  });
});
