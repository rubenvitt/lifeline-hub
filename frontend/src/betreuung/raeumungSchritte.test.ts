import { describe, expect, it } from 'vitest';
import type { Raeumungszustand } from '../api/types';
import { RAEUMUNG_FOLGE } from './betreuungText';
import { raeumungPlan } from './raeumungSchritte';

describe('raeumungPlan (LLH-1076)', () => {
  it('angeordnet: „Räumung beginnen“ sichtbar, „Als geräumt melden“ im Menü, Aufheben rot', () => {
    const p = raeumungPlan('angeordnet');
    expect(p.knopf).toMatchObject({ label: 'Räumung beginnen', ziel: 'laeuft' });
    expect(p.menue.map((s) => [s.label, s.ziel])).toEqual([['Als geräumt melden', 'geraeumt']]);
    expect(p.aufheben).toMatchObject({
      label: 'Anordnung aufheben',
      ziel: 'aufgehoben',
      rueckfrage: true,
    });
  });

  it('läuft: „Als geräumt melden“ sichtbar, Rückweg auf angeordnet im Menü', () => {
    const p = raeumungPlan('laeuft');
    expect(p.knopf).toMatchObject({ label: 'Als geräumt melden', ziel: 'geraeumt' });
    expect(p.menue.map((s) => s.ziel)).toEqual(['angeordnet']);
    expect(p.aufheben?.ziel).toBe('aufgehoben');
  });

  it('geräumt: kein Vorwärtsknopf, beide Rückwege im Menü', () => {
    const p = raeumungPlan('geraeumt');
    expect(p.knopf).toBeNull();
    expect(p.menue.map((s) => s.label)).toEqual([
      'Räumung wieder aufnehmen',
      'Zurück auf angeordnet',
    ]);
  });

  it('aufgehoben: nur „Erneut anordnen“, kein zweites Aufheben', () => {
    const p = raeumungPlan('aufgehoben');
    expect(p.knopf).toMatchObject({ label: 'Erneut anordnen', ziel: 'angeordnet' });
    expect(p.menue).toEqual([]);
    expect(p.aufheben).toBeNull();
  });

  it('jeder andere Zustand ist erreichbar, nie der eigene, keiner doppelt; aus „aufgehoben“ nur über die Anordnung', () => {
    for (const z of RAEUMUNG_FOLGE) {
      const p = raeumungPlan(z);
      const ziele = [p.knopf, ...p.menue, p.aufheben].filter((s) => s != null).map((s) => s.ziel);
      const erwartet = RAEUMUNG_FOLGE.filter((x: Raeumungszustand) => x !== z);
      // Von „aufgehoben“ führt der Weg zurück über die Anordnung — wie im ETB als Entscheidung.
      if (z === 'aufgehoben') expect(ziele).toEqual(['angeordnet']);
      else expect([...ziele].sort()).toEqual([...erwartet].sort());
      expect(ziele).not.toContain(z);
      expect(new Set(ziele).size).toBe(ziele.length);
    }
  });
});
