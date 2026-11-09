import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { renderMitProviders } from '../../test/utils';
import SchichtplanRaster, { type SchichtplanRasterProps } from './SchichtplanRaster';
import type { RasterZeile } from './raster';

/**
 * Das Raster und die Zeilenschleuse (LLH-1604): eine entfallene Zeile steht gedämpft mit
 * „(entfallen)“ und nimmt nichts an; ein Zug meldet sich beim Aufrufer, damit die Schleuse hält,
 * auch wenn der Zeiger das Raster verlässt. Den Zug selbst prüft die e2e (jsdom misst keine Pixel).
 */

const T0 = Date.UTC(2026, 10, 9, 8, 0);
const STUNDE = 3_600_000;

const ZEILEN: RasterZeile[] = [
  { schluessel: 'einheit:1', titel: 'RTW 1', gruppe: null, entfallen: true },
  { schluessel: 'einheit:2', titel: 'Streife 2', gruppe: null },
  { schluessel: 'pause', titel: 'Pause', gruppe: null, ueberlappungErlaubt: true },
];

function zeige(props: Partial<SchichtplanRasterProps> = {}) {
  const onAnlegen = vi.fn();
  const onZug = vi.fn();
  renderMitProviders(
    <SchichtplanRaster
      zeilen={ZEILEN}
      bloecke={[]}
      spanne={{ von: T0, bis: T0 + 8 * STUNDE }}
      darfSchreiben
      zone="Europe/Berlin"
      formatMarke={() => ''}
      formatZeit={() => ''}
      onAnlegen={onAnlegen}
      onAendern={vi.fn()}
      onOeffnen={vi.fn()}
      onZug={onZug}
      beschriftung="Schichtplan"
      {...props}
    />,
  );
  return { onAnlegen, onZug };
}

const zeile = (schluessel: string) =>
  document.querySelector(`[data-lfh="schichtplan-zeile"][data-raster-zeile="${schluessel}"]`)!;
const spur = (schluessel: string) =>
  zeile(schluessel).querySelector('[data-lfh="schichtplan-spur"]')!;

describe('SchichtplanRaster, Zeilenschleuse (LLH-1604)', () => {
  it('eine entfallene Zeile steht mit „(entfallen)“ und ohne Zeichenzeiger', () => {
    zeige();
    expect(zeile('einheit:1')).toHaveAttribute('data-entfallen', 'true');
    expect(zeile('einheit:1')).toHaveTextContent('RTW 1 (entfallen)');
    expect(spur('einheit:1')).not.toHaveStyle({ cursor: 'crosshair' });
    expect(zeile('einheit:2')).not.toHaveAttribute('data-entfallen');
    expect(screen.getByText('Streife 2')).toBeInTheDocument();
  });

  it('in einer entfallenen Zeile beginnt kein Zug', () => {
    const { onZug } = zeige();
    fireEvent.pointerDown(spur('einheit:1'), { pointerType: 'mouse', button: 0, pointerId: 1 });
    expect(onZug).not.toHaveBeenCalledWith(true);
  });

  it('ein Zug meldet Beginn und Ende', () => {
    const { onZug } = zeige();
    fireEvent.pointerDown(spur('einheit:2'), { pointerType: 'mouse', button: 0, pointerId: 1 });
    expect(onZug).toHaveBeenLastCalledWith(true);
    fireEvent.pointerUp(document, { pointerType: 'mouse', pointerId: 1 });
    expect(onZug).toHaveBeenLastCalledWith(false);
  });
});
