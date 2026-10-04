import { describe, expect, it } from 'vitest';
import { farbenDunkel } from '../theme/tokens';
import { kartenGrund, kartenKante, phaseTon, prioTon } from './kartenKante';

describe('kartenKante — der linke Rand trägt EINE Farbe, Gefahr gewinnt', () => {
  it('Alarm schlägt den Eingangszustand', () => {
    expect(kartenKante(farbenDunkel, { alarm: true, unbearbeitet: true })).toEqual({
      zustand: 'alarm',
      farbe: farbenDunkel.alarm,
    });
  });

  it('der Eingangszustand ist gelb, wenn kein Alarm besteht', () => {
    expect(kartenKante(farbenDunkel, { alarm: false, unbearbeitet: true })).toEqual({
      zustand: 'unbearbeitet',
      farbe: farbenDunkel.achtung,
    });
  });

  it('ohne beides steht die Rahmenlinie', () => {
    expect(kartenKante(farbenDunkel, { alarm: false, unbearbeitet: false })).toEqual({
      zustand: 'keine',
      farbe: farbenDunkel.linie,
    });
  });
});

describe('kartenGrund — Gefahr gewinnt auch gegen die Deeplink-Markierung (LFH-896)', () => {
  it('eine alarmierte Karte bleibt angesprungen auf der Alarmfläche', () => {
    expect(kartenGrund(farbenDunkel, { alarm: true, hervorgehoben: true })).toBe(
      farbenDunkel.alarmFlaeche,
    );
  });

  it('eine angesprungene Karte ohne Alarm steht auf der Bedienfläche', () => {
    expect(kartenGrund(farbenDunkel, { alarm: false, hervorgehoben: true })).toBe(
      farbenDunkel.bedienFlaeche,
    );
  });

  it('ohne beides steht das Paneel', () => {
    expect(kartenGrund(farbenDunkel, { alarm: false, hervorgehoben: false })).toBe(
      farbenDunkel.paneel,
    );
  });
});

describe('phaseTon / prioTon', () => {
  it('bildet jede Phase auf ihren Ton ab', () => {
    expect(phaseTon('offen')).toBe('neutral');
    expect(phaseTon('in_arbeit')).toBe('bedien');
    expect(phaseTon('abgeschlossen')).toBe('normal');
    expect(phaseTon('ausnahme')).toBe('alarm');
  });

  it('der Eingangszustand schlägt die Phase', () => {
    expect(phaseTon('offen', true)).toBe('achtung');
  });

  it('bildet die Prioritäten ab', () => {
    expect(prioTon('sofort')).toBe('alarm');
    expect(prioTon('dringend')).toBe('achtung');
    expect(prioTon('normal')).toBe('neutral');
  });
});
