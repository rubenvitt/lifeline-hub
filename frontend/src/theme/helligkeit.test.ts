/**
 * Der Helligkeitsregler und seine Warnsperre (LFH-397, Kriterium 8 der Prüfliste
 * Einsatztauglichkeit: „1 Regler, 1 Sperre").
 *
 * BEIDE HÄLFTEN, SONST MISST DER TEST NICHTS: eine Sperre, die IMMER zieht, wäre an
 * „greift bei Warnung" genauso grün wie die richtige; eine, die NIE zieht, an „greift
 * ohne Warnung nicht". Erst beide zusammen trennen die Regel von ihren zwei
 * Verfälschungen. Die Erwartungen stehen als Literale — aus derselben Konstante
 * gerechnet, prüfte der Test die Konstante gegen sich selbst.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  HELLIGKEIT_BODEN_WARNUNG,
  HELLIGKEIT_STUFEN,
  abdunkelung,
  istHelligkeit,
  wirksameHelligkeit,
  type Helligkeit,
} from './helligkeit';
import { farbenDunkel, farbenHell } from './tokens';

describe('wirksameHelligkeit — die Warnsperre', () => {
  it('greift bei aktiver Warnung: 40 % gewählt, 80 % wirksam', () => {
    expect(wirksameHelligkeit(40, true)).toBe(80);
  });

  it('greift OHNE aktive Warnung nicht: 40 % gewählt, 40 % wirksam', () => {
    expect(wirksameHelligkeit(40, false)).toBe(40);
  });

  it('hebt eine Wahl über dem Boden nicht an und senkt sie nicht', () => {
    expect(wirksameHelligkeit(100, true)).toBe(100);
    expect(wirksameHelligkeit(100, false)).toBe(100);
  });

  // Die volle Tafel: jede Stufe × beide Zustände, jede Erwartung als Literal.
  const TAFEL: [Helligkeit, boolean, Helligkeit][] = [
    [100, false, 100],
    [80, false, 80],
    [60, false, 60],
    [40, false, 40],
    [20, false, 20],
    [100, true, 100],
    [80, true, 80],
    [60, true, 80],
    [40, true, 80],
    [20, true, 80],
  ];
  it.each(TAFEL)('Wahl %i, Warnung %s → wirksam %i', (wahl, warnung, soll) => {
    expect(wirksameHelligkeit(wahl, warnung)).toBe(soll);
  });
});

describe('Stufen', () => {
  it('sind 100 · 80 · 60 · 40 · 20 — AUS ist keine Stufe', () => {
    expect([...HELLIGKEIT_STUFEN]).toEqual([100, 80, 60, 40, 20]);
    expect(istHelligkeit('0')).toBe(false);
  });

  it('erkennt nur gespeicherte Stufen als Wahl', () => {
    expect(istHelligkeit('40')).toBe(true);
    expect(istHelligkeit('100')).toBe(true);
    expect(istHelligkeit('45')).toBe(false);
    expect(istHelligkeit('hell')).toBe(false);
    expect(istHelligkeit(null)).toBe(false);
  });

  it('Abdunklung ist die Deckkraft 1 − Stufe', () => {
    expect(abdunkelung(100)).toBe(0);
    expect(abdunkelung(80)).toBeCloseTo(0.2);
    expect(abdunkelung(20)).toBeCloseTo(0.8);
  });
});

/**
 * DER BODEN IST ABGELEITET, NICHT GESETZT (design.md D2): die kleinste Stufe, bei der
 * `alarmText` auf `grund` in BEIDEN Paletten ≥ 4,5 : 1 hält (Kriterium 5, „nie < 4,5 : 1").
 * Die Deckschicht ist Schwarz mit Deckkraft `1 − Stufe`, zusammengesetzt in sRGB-Werten —
 * jeder Kanal wird also mit der Stufe multipliziert, bevor die WCAG-Formel linearisiert.
 *
 * Wird rot, wenn eine Palettenänderung den Boden verschiebt, und ebenso, wenn jemand den
 * Boden ohne Messgrundlage senkt oder hebt.
 */
function kanal(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}
function luminanz(hex: string, stufe: number): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) * (stufe / 100));
  return 0.2126 * kanal(r) + 0.7152 * kanal(g) + 0.0722 * kanal(b);
}
function kontrast(a: string, b: string, stufe: number): number {
  const [x, y] = [luminanz(a, stufe), luminanz(b, stufe)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

describe('Boden bei Warnung — hergeleitet aus Kriterium 5', () => {
  const traegt = (stufe: number) =>
    [farbenDunkel, farbenHell].every((f) => kontrast(f.alarmText, f.grund, stufe) >= 4.5);

  it('ist die kleinste Stufe, bei der alarmText auf grund in beiden Paletten ≥ 4,5 : 1 hält', () => {
    const kleinsteTragende = Math.min(...HELLIGKEIT_STUFEN.filter(traegt));
    expect(HELLIGKEIT_BODEN_WARNUNG).toBe(kleinsteTragende);
  });

  it('steht heute auf 80 % (nachts 4,81 : 1; bei 60 % wären es 3,07 : 1)', () => {
    expect(HELLIGKEIT_BODEN_WARNUNG).toBe(80);
    expect(kontrast(farbenDunkel.alarmText, farbenDunkel.grund, 80)).toBeCloseTo(4.81, 2);
    expect(kontrast(farbenDunkel.alarmText, farbenDunkel.grund, 60)).toBeCloseTo(3.07, 2);
  });
});

/**
 * Die Deckschicht in `rollen.css` (design.md D4). jsdom rendert kein `::after`, deshalb
 * prüft dieser Test den Quelltext; die Wirkung im Browser belegt `e2e/helligkeit.spec.ts`
 * (Klick durch die Schicht, kein Abdunkeln im Druck).
 */
describe('Deckschicht in rollen.css', () => {
  const css = readFileSync(resolve(__dirname, 'rollen.css'), 'utf8');
  const block =
    /@media screen \{\s*html\[data-helligkeit\]:not\(\[data-helligkeit='100'\]\)::after \{([^}]*)\}\s*\}/.exec(
      css,
    );

  it('steht nur unter @media screen — der Druck wird nie abgedunkelt', () => {
    expect(block).not.toBeNull();
  });

  it('lässt Zeigereingaben durch und liegt über jedem Portal', () => {
    const regeln = block?.[1] ?? '';
    expect(regeln).toMatch(/pointer-events:\s*none;/);
    expect(regeln).toMatch(/position:\s*fixed;/);
    expect(regeln).toMatch(/inset:\s*0;/);
    expect(regeln).toMatch(/z-index:\s*2147483647;/);
    expect(regeln).toMatch(/opacity:\s*var\(--lfh-abdunkelung,\s*0\);/);
  });
});

/**
 * Der Spiegel in `index.html` (design.md D5): das Bootstrap-Skript setzt die gespeicherte
 * Stufe vor dem ersten Bild. Seine Stufenliste und sein Schlüssel sind eine Handkopie —
 * dieser Test hält sie an `HELLIGKEIT_STUFEN`, damit eine neue Stufe nicht beim Laden
 * als „keine Wahl" auf 100 % springt, bis React übernimmt.
 */
describe('Bootstrap-Spiegel in index.html', () => {
  const html = readFileSync(resolve(__dirname, '../../index.html'), 'utf8');

  it('liest denselben Schlüssel', () => {
    expect(html).toContain("localStorage.getItem('lifeline-hub.helligkeit')");
  });

  it('kennt genau die Stufen aus HELLIGKEIT_STUFEN', () => {
    const liste = /var stufen = \[([^\]]*)\];/.exec(html)?.[1] ?? '';
    const werte = liste.split(',').map((w) => w.trim().replace(/'/g, ''));
    expect(werte).toEqual(HELLIGKEIT_STUFEN.map(String));
  });

  it('setzt Merkmal und Deckkraft wie der Provider', () => {
    expect(html).toContain('document.documentElement.dataset.helligkeit = h;');
    // Whitespace-frei verglichen: Prettier bricht den Aufruf je nach Breite um.
    expect(html.replace(/\s+/g, '')).toContain(
      "document.documentElement.style.setProperty('--lfh-abdunkelung',String((100-Number(h))/100),);",
    );
  });
});
