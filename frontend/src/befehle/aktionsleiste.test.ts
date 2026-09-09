import { describe, expect, it } from 'vitest';
import { aktionsleisteStil, AKTIONSLEISTE_AB } from './aktionsleiste';

/**
 * LFH-465 — die verankerte Aktionsleiste des Befehlsentwurfs.
 *
 * REIN UND EXPORTIERT nach dem Muster von `bedienzielStil` (LFH-365) und
 * `speicherLeisteStil` (LFH-345 · C10): nur so ist die Ungleichheit über die beiden
 * Breitenzweige prüfbar, ohne zu rendern — jsdom rechnet kein Layout, ein gerechneter
 * Stil belegte hier nichts.
 *
 * DIE UNGLEICHHEIT IST DIE AUSSAGE, nicht der Sticky-Zweig für sich: ein Bau, der die
 * Leiste in JEDER Breite verankert, erfüllt „bei 390 px verankert" ebenfalls und wäre
 * trotzdem falsch — oberhalb der Schwelle gehören die Aktionen in den Kopf.
 */

const TOKEN = {
  colorBgContainer: '#fff',
  paddingSM: 12,
  colorBorderSecondary: '#f0f0f0',
  marginSM: 8,
};

describe('aktionsleisteStil (LFH-465)', () => {
  it('verankert unterhalb der Schwelle am unteren Rand', () => {
    const stil = aktionsleisteStil(true, TOKEN);
    expect(stil.position).toBe('sticky');
    expect(stil.bottom).toBe(0);
    // Eigener Grund und Trennlinie: eine durchsichtige Leiste über Markdown-Text ist
    // von „nicht da" nicht zu unterscheiden.
    expect(stil.background).toBe(TOKEN.colorBgContainer);
    expect(stil.borderTop).toContain(TOKEN.colorBorderSecondary);
  });

  it('verankert oberhalb der Schwelle NICHT — dort stehen die Aktionen im Kopf', () => {
    const stil = aktionsleisteStil(false, TOKEN);
    expect(stil.position).toBeUndefined();
    expect(stil.borderTop).toBeUndefined();
  });

  /**
   * Die Schwelle kommt aus antd über `useViewport`, sie wird NICHT als Pixelzahl
   * gespiegelt (`useViewport.ts`, Dateikopf: „Die Schwellen kommen aus antd und werden
   * NICHT gespiegelt"). `lg` = 992 ist die letzte Stufe unterhalb des Führungs-Tablets
   * (1024–1280 px, Bedien-Leitlinie LFH-327) — 1024 ist damit die Probe knapp oberhalb.
   * Ein handgeschriebenes `1024` wäre die zweite Wahrheit, gegen die der Viewport-Guard
   * gebaut ist.
   */
  it('hängt an der antd-Stufe `lg`, nicht an einer gespiegelten Pixelzahl', () => {
    expect(AKTIONSLEISTE_AB).toBe('lg');
  });
});
