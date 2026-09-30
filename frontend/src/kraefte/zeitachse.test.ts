import { describe, expect, it } from 'vitest';
import type { Einsatzperiode } from '../api/types';
import { ankerText, dauerText, HERKUNFT_WORT, kraftDauern, NACHTRAG_ARTEN } from './zeitachse';

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
  });

  it('Ablösung lässt sich nicht nachtragen', () => {
    expect(NACHTRAG_ARTEN).not.toContain('abloesung');
  });
});
