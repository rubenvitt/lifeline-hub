import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import { describe, expect, it } from 'vitest';
import { SCHNELLWAHL_TERMIN, schnellwahlAuswahl, schnellwahlTermin } from './terminSchnellwahl';

dayjs.extend(utc);

describe('SCHNELLWAHL_TERMIN', () => {
  /**
   * Die Beschriftungen sind Bestand der ETB-Wiedervorlage und hängen dort an Tests
   * (`WiedervorlageModal.test.tsx`, `EtbPage.test.tsx`). Als LITERALE gepinnt, nicht aus der
   * Tabelle zurückgelesen — sonst prüfte der Test die Tabelle gegen sich selbst.
   */
  it('trägt genau die vier Bestandseinträge', () => {
    expect(SCHNELLWAHL_TERMIN.map((e) => [e.label, e.minuten])).toEqual([
      ['+15 min', 15],
      ['+30 min', 30],
      ['+1 h', 60],
      ['+2 h', 120],
    ]);
  });
});

describe('schnellwahlAuswahl', () => {
  it('liefert die Teilmenge in Tabellenreihenfolge, unabhängig von der Aufrufreihenfolge', () => {
    expect(schnellwahlAuswahl([120, 30, 60]).map((e) => e.label)).toEqual([
      '+30 min',
      '+1 h',
      '+2 h',
    ]);
  });

  it('wirft bei einer unbekannten Minutenzahl, statt einen Knopf still wegzulassen', () => {
    expect(() => schnellwahlAuswahl([30, 45])).toThrow('45');
  });
});

describe('schnellwahlTermin', () => {
  it('rechnet vom übergebenen Bezug, nicht von der Wanduhr', () => {
    const bezug = dayjs('2026-09-13T08:00:00Z');
    expect(schnellwahlTermin(bezug, 60).valueOf()).toBe(dayjs('2026-09-13T09:00:00Z').valueOf());
  });

  it('rechnet über die Sommerzeitgrenze in echten Minuten', () => {
    // 00:30Z = 01:30 MEZ; zwei echte Stunden später ist 02:30Z = 04:30 MESZ.
    const bezug = dayjs('2026-03-29T00:30:00Z');
    expect(schnellwahlTermin(bezug, 120).valueOf()).toBe(dayjs('2026-03-29T02:30:00Z').valueOf());
  });
});
