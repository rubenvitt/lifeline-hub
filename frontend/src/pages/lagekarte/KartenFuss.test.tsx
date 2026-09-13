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
    expect(fussStil.display).toBe('flex');
    expect(fussStil.flexDirection).toBe('column');
    expect(fussStil.position).toBe('absolute');
    expect(fussStil.bottom).toBe(FUSS_ABSTAND);
    expect(fussStil.left).toBe(FUSS_ABSTAND);
    expect(fussStil.right).toBe(FUSS_ABSTAND);
    expect(fussStil.gap).toBe(FUSS_ABSTAND);
  });

  it('lässt die Karte darunter bedienbar — der Rahmen selbst nimmt keine Zeiger an', () => {
    // Die Gegenzeile dazu steht in `bandStil`: ohne sie wäre jedes Band sichtbar und tot.
    expect(fussStil.pointerEvents).toBe('none');
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
