import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderMitProviders } from '../../test/utils';
import { farbenHell } from '../../theme/tokens';
import MetaZeile from './MetaZeile';

/** Text, den ein Vorleser liest: ohne `aria-hidden`-Teile. */
function vorleseText(el: HTMLElement): string {
  const kopie = el.cloneNode(true) as HTMLElement;
  kopie.querySelectorAll('[aria-hidden="true"]').forEach((n) => n.remove());
  return kopie.textContent ?? '';
}

describe('MetaZeile (Spec `schriftstufen`, „Metazeile in einer Form")', () => {
  it('setzt zwischen zwei Teilen genau einen Trenner, vor dem Vorleser verborgen', () => {
    renderMitProviders(
      <MetaZeile aria-label="Angaben">
        <MetaZeile.Teil mono>HH-RK 1083</MetaZeile.Teil>
        <MetaZeile.Teil>Wache Nord</MetaZeile.Teil>
        <MetaZeile.Teil>geändert</MetaZeile.Teil>
      </MetaZeile>,
    );
    const zeile = screen.getByLabelText('Angaben');
    expect(zeile.textContent).toBe('HH-RK 1083·Wache Nord·geändert');
    const trenner = zeile.querySelectorAll('[aria-hidden="true"]');
    expect(trenner).toHaveLength(2);
    expect(vorleseText(zeile)).toBe('HH-RK 1083Wache Nordgeändert');
  });

  it('lässt leere Teile samt Trenner weg', () => {
    const wache: string | null = null;
    renderMitProviders(
      <MetaZeile aria-label="Angaben">
        <MetaZeile.Teil mono>HH-RK 1083</MetaZeile.Teil>
        <MetaZeile.Teil>{wache}</MetaZeile.Teil>
        <MetaZeile.Teil>{''}</MetaZeile.Teil>
        {false}
        <MetaZeile.Teil>17.11. 14:32</MetaZeile.Teil>
      </MetaZeile>,
    );
    expect(screen.getByLabelText('Angaben').textContent).toBe('HH-RK 1083·17.11. 14:32');
  });

  it('rendert ohne gefüllten Teil nichts', () => {
    const { container } = renderMitProviders(
      <MetaZeile>
        <MetaZeile.Teil>{null}</MetaZeile.Teil>
      </MetaZeile>,
    );
    expect(container.textContent).toBe('');
  });

  it('setzt Teile in `textKlein`/`schwach`, `mono` in der Stufe `meta`', () => {
    renderMitProviders(
      <MetaZeile>
        <MetaZeile.Teil>Wache Nord</MetaZeile.Teil>
        <MetaZeile.Teil mono>0412</MetaZeile.Teil>
      </MetaZeile>,
    );
    expect(screen.getByText('Wache Nord')).toHaveStyle({
      fontSize: '12px',
      color: farbenHell.schwach,
    });
    const nummer = screen.getByText('0412');
    expect(nummer).toHaveStyle({ fontSize: '11px' });
    expect(nummer.style.fontVariantNumeric).toBe('tabular-nums');
  });

  it('nimmt je Teil einen eigenen Ton', () => {
    renderMitProviders(
      <MetaZeile>
        <MetaZeile.Teil ton="alarm">nicht erreichbar</MetaZeile.Teil>
      </MetaZeile>,
    );
    expect(screen.getByText('nicht erreichbar')).toHaveStyle({ color: farbenHell.alarmText });
  });

  it('bricht zwischen Teilen um, statt die Zeile zu sprengen', () => {
    renderMitProviders(
      <MetaZeile aria-label="Angaben">
        <MetaZeile.Teil>a</MetaZeile.Teil>
      </MetaZeile>,
    );
    expect(screen.getByLabelText('Angaben')).toHaveStyle({
      flexDirection: 'row',
      flexWrap: 'wrap',
      alignItems: 'baseline',
    });
  });
});
