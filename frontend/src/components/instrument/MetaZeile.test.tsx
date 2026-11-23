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
    expect(zeile.textContent).toBe('HH-RK 1083 · Wache Nord · geändert');
    const trenner = zeile.querySelectorAll('[aria-hidden="true"]');
    expect(trenner).toHaveLength(2);
    // Zwischen den Teilen bleibt Weißraum, damit Vorleser und Kopieren keine Wörter verkleben.
    expect(vorleseText(zeile).replace(/\s+/g, ' ')).toBe('HH-RK 1083 Wache Nord geändert');
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
    expect(screen.getByLabelText('Angaben').textContent).toBe('HH-RK 1083 · 17.11. 14:32');
  });

  it('wertet einen Teil, dessen Kinder alle leer sind, als leer', () => {
    const a: string | null = null;
    const b: string | null = null;
    renderMitProviders(
      <MetaZeile aria-label="Angaben">
        <MetaZeile.Teil>Wache Nord</MetaZeile.Teil>
        <MetaZeile.Teil>
          {a}
          {b}
        </MetaZeile.Teil>
        <MetaZeile.Teil>geändert</MetaZeile.Teil>
      </MetaZeile>,
    );
    expect(screen.getByLabelText('Angaben').textContent).toBe('Wache Nord · geändert');
  });

  it('verliert Text ohne Teil nicht, sondern setzt ihn als eigenen Teil', () => {
    renderMitProviders(
      <MetaZeile aria-label="Angaben">
        {'Leitstelle'}
        <MetaZeile.Teil>Nord</MetaZeile.Teil>
      </MetaZeile>,
    );
    expect(screen.getByLabelText('Angaben').textContent).toBe('Leitstelle · Nord');
  });

  it('setzt eine Zahl in einem Wortteil mit `MetaZeile.Zahl` in die Zahlenfamilie', () => {
    renderMitProviders(
      <MetaZeile>
        <MetaZeile.Teil>
          bis <MetaZeile.Zahl>14:32</MetaZeile.Zahl>
        </MetaZeile.Teil>
      </MetaZeile>,
    );
    const zeit = screen.getByText('14:32');
    expect(zeit).toHaveStyle({ fontSize: '11px' });
    expect(zeit.style.fontFamily).toContain('JetBrains Mono');
    expect(zeit.style.fontVariantNumeric).toBe('tabular-nums');
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
    // `monoFein` (LLH-2046): die Zahl bleibt Mono, seit `meta` in der Textschrift steht.
    expect(nummer.style.fontFamily).toContain('JetBrains Mono');
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
