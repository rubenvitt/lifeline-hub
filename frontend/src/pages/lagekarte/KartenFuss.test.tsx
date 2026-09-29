import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { KartenFuss, bandStil, fussStil, FUSS_ABSTAND } from './KartenFuss';

/**
 * Geprüft wird die Struktur, aus der die Zusicherung folgt, nicht ein Pixel. Dass sich die Bänder
 * im Browser nicht überlagern, misst `e2e/lagekarte-smoke.spec.ts`.
 */
describe('KartenFuss — Rahmen', () => {
  it('stapelt seine Bänder als Spalte am unteren Kartenrand', () => {
    const stil = fussStil(32);
    expect(stil.display).toBe('flex');
    expect(stil.flexDirection).toBe('column');
    expect(stil.position).toBe('absolute');
    expect(stil.bottom).toBe(FUSS_ABSTAND);
    expect(stil.left).toBe(FUSS_ABSTAND);
    expect(stil.gap).toBe(FUSS_ABSTAND);
  });

  /**
   * Der Fuß endet rechts vor der Knopfspalte. Die Zahl ist Rand des Knopfblocks + Kante + Abstand,
   * als Literal. Die Überschneidung im Browser misst `e2e/fokus-verdeckung.spec.ts`.
   */
  it.each([
    [32, 56],
    [48, 72],
    [72, 96],
  ])(
    'lässt bei Knopfkante %i rechts %i px frei — die Knopfspalte gehört nicht dem Fuß',
    (kante, rechts) => {
      expect(fussStil(kante).right).toBe(rechts);
    },
  );

  /**
   * Oben endet der Fuß an der Karte; unten verankert ohne Obergrenze ragte er in den Seitenkopf.
   * Das Rollen per Finger misst `e2e/lagekarte-touch.spec.ts`.
   */
  it('reicht bis zur Oberkante der Karte, stapelt nach unten und schneidet nichts ab', () => {
    const stil = fussStil(32);
    expect(stil.top).toBe(12);
    expect(stil.justifyContent).toBe('flex-end');
    // Ein `overflow` am Rahmen schnitte Schatten und Fokusringe der Bänder auf jeder Breite ab.
    expect(stil.overflow).toBeUndefined();
    expect(stil.overflowY).toBeUndefined();
  });

  it('nur ein nachgiebiges Band gibt Höhe ab und rollt in sich', () => {
    expect(bandStil('voll', true)).toMatchObject({ minHeight: 0, overflowY: 'auto' });
    expect(bandStil('voll').minHeight).toBeUndefined();
    expect(bandStil('voll').overflowY).toBeUndefined();
  });

  it('lässt die Karte darunter bedienbar — der Rahmen selbst nimmt keine Zeiger an', () => {
    // Die Gegenzeile steht in `bandStil`: ohne sie wäre jedes Band sichtbar und tot.
    expect(fussStil(32).pointerEvents).toBe('none');
  });

  it('rendert seine Bänder als Flow-Geschwister in der übergebenen Reihenfolge', () => {
    render(
      <KartenFuss>
        <div data-testid="oben">Steuerung</div>
        <div data-testid="unten">Leiste</div>
      </KartenFuss>,
    );
    const rahmen = screen.getByTestId('oben').parentElement!;
    expect(rahmen.dataset.lfh).toBe('karten-fuss');
    // Geschwister im Fluss, nicht verschachtelt und nicht übereinander gelegt.
    expect(Array.from(rahmen.children).map((k) => (k as HTMLElement).dataset.testid)).toEqual([
      'oben',
      'unten',
    ]);
  });
});

describe('KartenFuss — bandStil', () => {
  it('gibt jedem Band die Zeiger zurück, die der Rahmen abgibt', () => {
    for (const a of ['voll', 'mitte', 'links'] as const) {
      expect(bandStil(a).pointerEvents).toBe('auto');
      expect(bandStil(a).maxWidth).toBe('100%');
    }
  });

  it('richtet die drei Bandsorten unterschiedlich aus', () => {
    expect(bandStil('voll').alignSelf).toBe('stretch');
    expect(bandStil('mitte').alignSelf).toBe('center');
    expect(bandStil('links').alignSelf).toBe('flex-start');
    expect(bandStil().alignSelf).toBe('stretch');
  });

  it('positioniert NICHT selbst — das ist die ganze Aussage von LFH-355', () => {
    // Ein Band mit `position: absolute` wäre aus dem Fluss und könnte das Nachbarband wieder
    // verdecken.
    for (const a of ['voll', 'mitte', 'links'] as const) {
      expect(bandStil(a).position).toBeUndefined();
      expect(bandStil(a).zIndex).toBeUndefined();
      expect(bandStil(a).bottom).toBeUndefined();
    }
  });
});
