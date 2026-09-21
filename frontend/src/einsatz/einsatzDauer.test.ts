import { describe, expect, it } from 'vitest';
import { einsatzDauer } from './einsatzDauer';

/** Absoluter Zeitpunkt als Literal — nie aus derselben Parse-Funktion zurückgerechnet. */
const JETZT = Date.UTC(2026, 8, 21, 14, 22, 0); // 21.09.2026 14:22 UTC

describe('einsatzDauer', () => {
  it('rechnet vom UTC-Wirestring bis jetzt', () => {
    expect(einsatzDauer('2026-09-21 07:41:00', null, JETZT)).toBe('06:41 h');
  });

  it('liest den Wirestring als UTC, nicht als Ortszeit', () => {
    // Genau 0 Minuten — bei Ortszeit-Lesart stünde hier der Zonenversatz.
    expect(einsatzDauer('2026-09-21 14:22:00', null, JETZT)).toBe('00:00 h');
  });

  it('setzt ab 24 Stunden die vollen Tage vor die Uhrzeitform', () => {
    expect(einsatzDauer('2026-09-20 07:17:00', null, JETZT)).toBe('1 d 07:05 h');
    // 62:20 h — die Form, die der Neuentwurf ablöst.
    expect(einsatzDauer('2026-09-19 00:02:00', null, JETZT)).toBe('2 d 14:20 h');
  });

  it('bleibt knapp unter 24 Stunden in der Stundenform und wechselt genau bei 24', () => {
    expect(einsatzDauer('2026-09-20 14:23:00', null, JETZT)).toBe('23:59 h');
    expect(einsatzDauer('2026-09-20 14:22:00', null, JETZT)).toBe('1 d 00:00 h');
  });

  it('steht bei einem abgeschlossenen Einsatz auf der Dauer bis zum Ende', () => {
    expect(einsatzDauer('2026-09-21 07:00:00', '2026-09-21 09:30:00', JETZT)).toBe('02:30 h');
  });

  it('gibt für einen Beginn in der Zukunft keine negative Dauer aus', () => {
    expect(einsatzDauer('2026-09-21 15:00:00', null, JETZT)).toBe('00:00 h');
  });

  it('erfindet ohne lesbaren Beginn nichts', () => {
    expect(einsatzDauer(null, null, JETZT)).toBeNull();
    expect(einsatzDauer('kaputt', null, JETZT)).toBeNull();
  });
});
