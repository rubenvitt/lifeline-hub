import dayjs from 'dayjs';
import { describe, expect, it } from 'vitest';
import {
  meterAlsCm,
  prognoseBody,
  prognoseVorbelegung,
  vorhersageAlsWerte,
  vorhersageSatz,
  wiederherstellBody,
} from './pegelPrognoseKern';

const BERLIN = { zeitzone: 'Europe/Berlin' };
const JETZT = Date.UTC(2026, 8, 22, 12, 30, 0);

describe('pegelPrognoseKern (LFH-628)', () => {
  it('Meter → ganze cm, ohne Gleitkommarest', () => {
    expect(meterAlsCm(7.1)).toBe(710);
    expect(meterAlsCm(0.29)).toBe(29);
    expect(meterAlsCm(-0.05)).toBe(-5);
  });

  it('Body: cm und ISO-Zeit; fehlt ein Wert, gibt es keinen Body', () => {
    const zeit = dayjs('2026-09-22T18:00:00+02:00');
    expect(prognoseBody({ hoechststand_m: 7.1, zeitpunkt: zeit })).toEqual({
      hoechststand_cm: 710,
      zeitpunkt: '2026-09-22T16:00:00.000Z',
    });
    expect(prognoseBody({ hoechststand_m: null, zeitpunkt: zeit })).toBeNull();
    expect(prognoseBody({ hoechststand_m: 7.1, zeitpunkt: null })).toBeNull();
  });

  it('Vorbelegung liest die Wire-Zeit als UTC und kommt über den Body unverändert zurück', () => {
    const p = { hoechststand_cm: 710, zeitpunkt: '2026-09-22 16:00:00', gesetzt_at: 'x' };
    const w = prognoseVorbelegung(p);
    expect(w.hoechststand_m).toBe(7.1);
    expect(prognoseBody(w)).toEqual({
      hoechststand_cm: 710,
      zeitpunkt: '2026-09-22T16:00:00.000Z',
    });
    expect(prognoseVorbelegung(undefined)).toEqual({ hoechststand_m: null, zeitpunkt: null });
  });

  it('Rückgängig schickt den gespeicherten Wert unverändert zurück', () => {
    expect(
      wiederherstellBody({
        hoechststand_cm: 710,
        zeitpunkt: '2026-09-22 16:00:00',
        gesetzt_at: 'x',
      }),
    ).toEqual({ hoechststand_cm: 710, zeitpunkt: '2026-09-22 16:00:00' });
  });

  it('Vorhersage: Werte übernehmen den Zeitpunkt samt Versatz, der Satz nennt Abschätzungen', () => {
    const v = {
      hoechststand_cm: 723,
      zeitpunkt: '2026-09-22T18:00:00+02:00',
      erstellt: '2026-09-22T07:00:00+02:00',
      abschaetzung: false,
    };
    const w = vorhersageAlsWerte(v);
    expect(w.hoechststand_m).toBe(7.23);
    expect(w.zeitpunkt?.toISOString()).toBe('2026-09-22T16:00:00.000Z');
    expect(vorhersageSatz(v, JETZT, BERLIN)).toBe(
      'PEGELONLINE-Vorhersage, gerechnet 07:00: höchster Wert 7,23 m um 18:00',
    );
    expect(vorhersageSatz({ ...v, abschaetzung: true }, JETZT, BERLIN)).toMatch(
      /\(Abschätzung, keine Vorhersage\)$/,
    );
  });
});
