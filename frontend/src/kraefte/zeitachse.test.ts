import { describe, expect, it } from 'vitest';
import type { Einsatzperiode, ZeitachseEreignis } from '../api/types';
import {
  abschliessendeEntlassungId,
  ankerText,
  dauerText,
  HERKUNFT_WORT,
  kraftDauern,
  NACHTRAG_ARTEN,
} from './zeitachse';

/** UTC-Millisekunden eines Wirestrings des 30.09.2026. */
function um(uhr: string): number {
  return Date.parse(`2026-09-30T${uhr}:00Z`);
}
function w(uhr: string): string {
  return `2026-09-30 ${uhr}:00`;
}

describe('kraftDauern (Spec „Einsatzdauer und Ruhezeit")', () => {
  it('„Laufende Einsatzdauer": Anker Alarmierung, 7 h 40', () => {
    const p: Einsatzperiode[] = [
      { beginn_at: w('06:10'), anker: 'alarmierung', eintreffen_at: w('06:40') },
    ];
    const d = kraftDauern(p, um('13:50'));
    expect(d.laufend).toEqual({ minuten: 460, anker: 'alarmierung', beginnAt: w('06:10') });
    expect(dauerText(d.laufend!.minuten)).toBe('7 h 40');
    expect(d.gesamtMinuten).toBe(460);
    expect(d.ruheMinuten).toBeNull();
  });

  it('„Ruhezeit": 3 h 20 nach dem Ende, keine laufende Dauer', () => {
    const p: Einsatzperiode[] = [
      { beginn_at: w('06:40'), anker: 'eintreffen', ende_at: w('14:40'), ende_art: 'abloesung' },
    ];
    const d = kraftDauern(p, um('18:00'));
    expect(d.laufend).toBeNull();
    expect(d.ruheMinuten).toBe(200);
    expect(dauerText(d.ruheMinuten!)).toBe('3 h 20');
    expect(d.gesamtMinuten).toBe(480);
  });

  it('„Keine Ereignisse": alles fehlt, nie 0', () => {
    expect(kraftDauern([], um('12:00'))).toEqual({
      laufend: null,
      gesamtMinuten: null,
      ruheMinuten: null,
    });
    expect(kraftDauern(undefined, um('12:00')).gesamtMinuten).toBeNull();
  });

  it('Gesamtzeit summiert beendete und offene Periode', () => {
    const p: Einsatzperiode[] = [
      { beginn_at: w('06:00'), anker: 'alarmierung', ende_at: w('08:00') },
      { beginn_at: w('10:00'), anker: 'eintreffen' },
    ];
    const d = kraftDauern(p, um('10:30'));
    expect(d.gesamtMinuten).toBe(150);
    expect(d.laufend?.minuten).toBe(30);
    expect(d.ruheMinuten).toBeNull();
  });

  it('liest UTC, nicht Ortszeit', () => {
    const p: Einsatzperiode[] = [{ beginn_at: w('06:00'), anker: 'eintreffen' }];
    expect(kraftDauern(p, um('07:00')).laufend?.minuten).toBe(60);
  });
});

describe('dauerText', () => {
  it('unter einer Stunde in Minuten, sonst Stunden mit zweistelligen Minuten', () => {
    expect(dauerText(0)).toBe('0 min');
    expect(dauerText(40)).toBe('40 min');
    expect(dauerText(60)).toBe('1 h 00');
    expect(dauerText(1865)).toBe('31 h 05');
  });
});

describe('Wörter', () => {
  it('Anker und Herkunft sind lesbar', () => {
    expect(ankerText('alarmierung', '06:10')).toBe('seit Alarmierung 06:10');
    expect(HERKUNFT_WORT.einheit).toBe('über Einheit');
    expect(HERKUNFT_WORT.nachtrag).toBe('nachgetragen');
    expect(HERKUNFT_WORT.disposition).toBe('aus dem Einsatz entlassen');
    expect(HERKUNFT_WORT.bereitstellungsraum).toBe('am Bereitstellungsraum');
  });

  it('Ablösung lässt sich nicht nachtragen', () => {
    expect(NACHTRAG_ARTEN).not.toContain('abloesung');
  });
});

describe('abschliessendeEntlassungId (LLH-1263, Spec „Abschließende Entlassung streichen“)', () => {
  function ereignis(
    id: number,
    art: ZeitachseEreignis['art'],
    uhr: string,
    gestrichen = false,
  ): ZeitachseEreignis {
    return {
      id,
      art,
      zeitpunkt_at: w(uhr),
      quelle: 'nachtrag',
      erfasst_at: w(uhr),
      erfasst_von: 1,
      gestrichen_at: gestrichen ? w('15:00') : null,
    };
  }
  const geschlossen: Einsatzperiode[] = [
    {
      beginn_at: w('06:10'),
      anker: 'alarmierung',
      eintreffen_at: w('06:40'),
      ende_at: w('14:00'),
      ende_art: 'entlassung',
    },
  ];
  const ereignisse = [
    ereignis(1, 'alarmierung', '06:10'),
    ereignis(2, 'eintreffen', '06:40'),
    ereignis(3, 'entlassung', '12:00', true),
    ereignis(4, 'entlassung', '14:00'),
  ];

  it('nennt die nicht gestrichene Entlassung, die die letzte Periode schließt', () => {
    expect(abschliessendeEntlassungId(geschlossen, ereignisse)).toBe(4);
  });

  it('bei zwei Entlassungen in derselben Sekunde die spätere (Reihenfolge der Erfassung)', () => {
    const zweiPerioden: Einsatzperiode[] = [
      { ...geschlossen[0] },
      {
        beginn_at: w('14:00'),
        anker: 'alarmierung',
        ende_at: w('14:00'),
        ende_art: 'entlassung',
      },
    ];
    expect(
      abschliessendeEntlassungId(zweiPerioden, [
        ...ereignisse,
        ereignis(6, 'alarmierung', '14:00'),
        ereignis(7, 'entlassung', '14:00'),
      ]),
    ).toBe(7);
  });

  it('keine bei offener letzter Periode', () => {
    const offen: Einsatzperiode[] = [
      ...geschlossen,
      { beginn_at: w('15:00'), anker: 'eintreffen', eintreffen_at: w('15:00') },
    ];
    expect(abschliessendeEntlassungId(offen, ereignisse)).toBeNull();
  });

  it('keine, wenn eine Ablösung die letzte Periode schließt', () => {
    const abgeloest: Einsatzperiode[] = [{ ...geschlossen[0], ende_art: 'abloesung' }];
    expect(
      abschliessendeEntlassungId(abgeloest, [
        ...ereignisse.slice(0, 2),
        ereignis(5, 'abloesung', '14:00'),
      ]),
    ).toBeNull();
  });

  it('keine ohne Perioden', () => {
    expect(abschliessendeEntlassungId([], [])).toBeNull();
    expect(abschliessendeEntlassungId(undefined, undefined)).toBeNull();
  });
});
