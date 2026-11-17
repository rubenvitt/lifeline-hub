import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import { describe, expect, it } from 'vitest';
import type { LagemonitorAnzeige } from '../api/types';
import { alarmAusMonitor } from './alarmAusMonitor';
import { wasBrennt, type WasBrenntQuellen } from './wasBrennt';

dayjs.extend(utc);

const JETZT = dayjs.utc('2026-11-16 14:10:00');

describe('alarmAusMonitor (LLH-1743, D5)', () => {
  it('derselbe Fall über Browser-Quellen und Monitor ergibt dieselbe Zeile (LLH-1929: mit Ausfall)', () => {
    const browser: WasBrenntQuellen = {
      meldungen: {
        zustand: 'daten',
        wert: {
          sofort_offen: 2,
          sofort_aelteste_at: '2026-11-16 14:06:00',
          dringend_offen: 1,
          bestaetigung_ueberfaellig: 1,
        },
      },
      auftraege: { zustand: 'daten', wert: { ueberfaellig: 1 } },
      erinnerungen: { zustand: 'daten', wert: { faellig: 2 } },
      nachforderungen: { zustand: 'daten', wert: { ueberfaellig: 0 } },
      vermisst: { zustand: 'daten', wert: 1 },
      kritisch: { zustand: 'daten', wert: [{ id: 5, name: 'UHS Turnhalle' }] },
      rueckmeldung: {
        zustand: 'daten',
        wert: [
          { id: 10, name: 'Logistiktrupp', seitMin: 47 },
          { id: 11, name: 'Sanitätszug', seitMin: 12 },
        ],
      },
      ausfall: {
        zustand: 'daten',
        wert: [
          { id: 20, name: 'Sanitätszug' },
          { id: 10, name: 'Logistiktrupp' },
          { id: null, name: 'Ohne Einheit' },
        ],
      },
    };
    const monitor = {
      betroffene: { vermisst: 1 },
      alarm: {
        sofort_offen: 2,
        sofort_aelteste_at: '2026-11-16 14:06:00',
        dringend_offen: 1,
        bestaetigung_ueberfaellig: 1,
        auftraege_ueberfaellig: 1,
        erinnerungen_faellig: 2,
        nachforderungen_ueberfaellig: 0,
        rueckmeldung_ueberfaellig: [
          { einheit: 'Logistiktrupp', seit_min: 47 },
          { einheit: 'Sanitätszug', seit_min: 12 },
        ],
        abschnitte_kritisch: ['UHS Turnhalle'],
        ausfall: ['Sanitätszug', 'Logistiktrupp', 'Ohne Einheit'],
      },
    } as unknown as LagemonitorAnzeige;
    const ohneBezug = (q: WasBrenntQuellen) =>
      wasBrennt(q, JETZT).eintraege.map(({ art, rolle, text, voll }) => ({
        art,
        rolle,
        text,
        voll,
      }));
    expect(ohneBezug(alarmAusMonitor(monitor))).toEqual(ohneBezug(browser));
    expect(wasBrennt(alarmAusMonitor(monitor), JETZT).stand).toBe('vollstaendig');
    expect(
      wasBrennt(alarmAusMonitor(monitor), JETZT).eintraege.find((e) => e.art === 'ausfall')?.text,
    ).toBe('Ausfall: Sanitätszug, Logistiktrupp +1');
  });

  it('älterer Server ohne Feld `ausfall`: keine Quelle, kein unvollständiger Stand', () => {
    const lage = {
      betroffene: { vermisst: 0 },
      alarm: {
        sofort_offen: 0,
        dringend_offen: 0,
        bestaetigung_ueberfaellig: 0,
        auftraege_ueberfaellig: 0,
        erinnerungen_faellig: 0,
        nachforderungen_ueberfaellig: 0,
        rueckmeldung_ueberfaellig: [],
        abschnitte_kritisch: [],
      },
    } as unknown as LagemonitorAnzeige;
    expect(alarmAusMonitor(lage).ausfall).toBeNull();
    expect(wasBrennt(alarmAusMonitor(lage), JETZT).stand).toBe('vollstaendig');
  });

  it('ohne Antwort lädt die Zeile', () => {
    expect(wasBrennt(alarmAusMonitor(undefined), JETZT).stand).toBe('laedt');
  });

  it('gescheiterter Abruf ohne Daten: unvollständig statt „lädt“ (Review)', () => {
    expect(wasBrennt(alarmAusMonitor(undefined, true), JETZT).stand).toBe('unvollstaendig');
  });

  it('Antwort ohne Block `alarm`: unvollständig, die Vermissten bleiben', () => {
    const lage = { betroffene: { vermisst: 2 } } as unknown as LagemonitorAnzeige;
    const w = wasBrennt(alarmAusMonitor(lage), JETZT);
    expect(w.stand).toBe('unvollstaendig');
    expect(w.eintraege.map((e) => e.text)).toEqual(['2 vermisst']);
  });
});
