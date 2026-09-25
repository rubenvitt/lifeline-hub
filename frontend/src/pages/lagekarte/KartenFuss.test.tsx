import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { KartenFuss, bandStil, fussStil, FUSS_ABSTAND } from './KartenFuss';

/**
 * LFH-355. Geprüft wird die STRUKTUR, aus der die Zusicherung folgt — nicht ein Pixel:
 * jsdom rechnet kein Layout, eine Messung wäre hier nicht widerlegbar. Dass sich die
 * Bänder im Browser tatsächlich nicht überlagern (auch bei 390 px), misst
 * `e2e/lagekarte-smoke.spec.ts` mit echten Bounding-Boxen.
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
   * LFH-373: der Fuß endet rechts VOR der Knopfspalte. Gemessen vor dem Fix: bei 390 px im
   * Handschuh-Betrieb lagen drei Kartenknöpfe vollständig unter dem Zeitachsenband. Die Zahl
   * ist Rand des Knopfblocks + Kante + Abstand; als Literale, damit die Zusicherung nicht die
   * Rechnung gegen sich selbst prüft. Ob sich die beiden im Browser wirklich nicht
   * überschneiden, misst `e2e/fokus-verdeckung.spec.ts` (Lagekarte).
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

  it('lässt die Karte darunter bedienbar — der Rahmen selbst nimmt keine Zeiger an', () => {
    // Die Gegenzeile dazu steht in `bandStil`: ohne sie wäre jedes Band sichtbar und tot.
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
    // Ein Band, das wieder `position: absolute` mitbrächte, wäre aus dem Fluss und könnte
    // das Nachbarband erneut verdecken. Der Stil darf diese Tür nicht selbst aufmachen.
    for (const a of ['voll', 'mitte', 'links'] as const) {
      expect(bandStil(a).position).toBeUndefined();
      expect(bandStil(a).zIndex).toBeUndefined();
      expect(bandStil(a).bottom).toBeUndefined();
    }
  });
});
