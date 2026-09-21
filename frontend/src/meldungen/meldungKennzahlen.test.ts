import { describe, expect, it } from 'vitest';
import type { Meldung } from '../api/types';
import { istAlarmiert, meldungKennzahlen } from './meldungKennzahlen';

const m = (over: Partial<Meldung>): Meldung =>
  ({
    id: 1,
    status: 'neu',
    bestaetigung_pflicht: false,
    ist_bestaetigt: false,
    ist_ueberfaellig: false,
    eskaliert: false,
    ...over,
  }) as Meldung;

describe('istAlarmiert — dieselbe Regel wie der Alarmrand der Karte', () => {
  it('nur bestätigungspflichtig, unbestätigt UND überfällig oder eskaliert', () => {
    expect(istAlarmiert(m({ bestaetigung_pflicht: true, ist_ueberfaellig: true }))).toBe(true);
    expect(istAlarmiert(m({ bestaetigung_pflicht: true, eskaliert: true }))).toBe(true);
    // Gegenproben: jede Bedingung einzeln entfernt.
    expect(istAlarmiert(m({ ist_ueberfaellig: true }))).toBe(false);
    expect(
      istAlarmiert(m({ bestaetigung_pflicht: true, ist_bestaetigt: true, ist_ueberfaellig: true })),
    ).toBe(false);
    expect(istAlarmiert(m({ bestaetigung_pflicht: true }))).toBe(false);
  });
});

describe('meldungKennzahlen', () => {
  it('trennt unbearbeitet / in Arbeit / erledigt nach der Phasenachse und zählt Alarm quer', () => {
    const k = meldungKennzahlen([
      m({ id: 1, status: 'neu' }),
      m({ id: 2, status: 'neu', bestaetigung_pflicht: true, eskaliert: true }),
      m({ id: 3, status: 'gesichtet' }),
      m({ id: 4, status: 'in_bearbeitung' }),
      m({ id: 5, status: 'erledigt' }),
    ]);
    expect(k).toEqual({ unbearbeitet: 2, inArbeit: 2, alarmiert: 1, erledigt: 1 });
  });

  it('liefert für eine leere Menge Nullen — eine Null ist ein Wert, kein Zustand', () => {
    expect(meldungKennzahlen([])).toEqual({
      unbearbeitet: 0,
      inArbeit: 0,
      alarmiert: 0,
      erledigt: 0,
    });
  });
});
