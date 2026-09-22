import { describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import { renderMitProviders } from '../test/utils';
import { setzeViewportBreite } from '../test/viewport';
import { farbenHell } from '../theme/tokens';
import Statusband from './Statusband';
import type { BandZelle } from './meldebildRaster';

function zelle(schluessel: string, ton: BandZelle['ton'], wert = 1): BandZelle {
  return { schluessel, code: schluessel.toUpperCase(), wert, wort: `Wort ${schluessel}`, ton };
}

/** CSS-Farbwert so, wie jsdom ihn aus einem Hex-Inline-Stil zurückgibt. */
function rgb(hex: string): string {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return `rgb(${r}, ${g}, ${b})`;
}

describe('Statusband', () => {
  it('jede Zelle ist eine Kennzahl auf der neutralen Fläche, der Ton im Quadrat und in der Marke', () => {
    const { container } = renderMitProviders(
      <Statusband fahrzeuge={[zelle('s3', 'achtung', 5)]} personal={[]} zustand="daten" />,
    );
    const band = screen.getByRole('region', { name: 'Fahrzeuge je Status' });
    const z = band.querySelector('[data-lfh="kennzahl"]') as HTMLElement;
    expect(z).toHaveAttribute('data-ton', 'achtung');
    expect(z).toHaveTextContent('S3');
    expect(z).toHaveTextContent('5');
    expect(z).toHaveTextContent('Wort s3');
    // Grund `flaeche` trägt die Klasse (`.lfh-kennzahl` in `sprache.css`), kein Inline-Ton.
    expect(z).toHaveClass('lfh-kennzahl');
    expect(z.style.background).toBe('');
    const quadrat = z.querySelector('[data-lfh="kennzahl-punkt"]') as HTMLElement;
    expect(quadrat.style.background).toBe(rgb(farbenHell.achtung));
    // Am Tag trägt die Zahl die Textrolle — getönt wie nachts, aber über 7 : 1 (LFH-618).
    const wert = z.querySelector('[data-lfh="kennzahl-wert"]') as HTMLElement;
    expect(wert.style.color).toBe(rgb(farbenHell.achtungText));
    expect(container.querySelectorAll('[data-lfh="meldebild-bandzelle"]')).toHaveLength(0);
  });

  it('normal und bedien behalten ihre Tonfarbe auch tags', () => {
    renderMitProviders(
      <Statusband
        fahrzeuge={[zelle('s2', 'normal', 4), zelle('s4', 'bedien', 2)]}
        personal={[]}
        zustand="daten"
      />,
    );
    const wert = (ton: string) =>
      document.querySelector(
        `[data-lfh="kennzahl"][data-ton="${ton}"] [data-lfh="kennzahl-wert"]`,
      ) as HTMLElement;
    expect(wert('normal').style.color).toBe(rgb(farbenHell.normalText));
    expect(wert('bedien').style.color).toBe(rgb(farbenHell.bedienText));
  });

  it.each([
    [1440, 6, 2, 4],
    [1024, 3, 2, 1],
    [390, 2, 0, 0],
  ])(
    'bei %i px: %i Spalten für beide Gruppen, Auffüllung %i / %i',
    (breite, spalten, lueckenF, lueckenP) => {
      setzeViewportBreite(breite);
      renderMitProviders(
        <Statusband
          fahrzeuge={[
            zelle('s1', 'normal'),
            zelle('s2', 'normal'),
            zelle('s3', 'achtung'),
            zelle('s4', 'bedien'),
          ]}
          personal={[zelle('p1', 'normal'), zelle('p2', 'alarm')]}
          zustand="daten"
        />,
      );
      const fzg = screen.getByRole('region', { name: 'Fahrzeuge je Status' });
      const pers = screen.getByRole('region', { name: 'Personal je Status' });
      const rasterF = fzg.querySelector('[data-lfh="kennzahlenband"]') as HTMLElement;
      const rasterP = pers.querySelector('[data-lfh="kennzahlenband"]') as HTMLElement;
      expect(rasterF.style.gridTemplateColumns).toBe(`repeat(${spalten}, minmax(0, 1fr))`);
      expect(rasterP.style.gridTemplateColumns).toBe(rasterF.style.gridTemplateColumns);
      expect(within(fzg).getAllByText(/^Wort/)).toHaveLength(4);
      expect(fzg.querySelectorAll('[data-lfh="kennzahl"]')).toHaveLength(4);
      expect(fzg.querySelectorAll('[data-lfh="meldebild-bandluecke"]')).toHaveLength(lueckenF);
      expect(pers.querySelectorAll('[data-lfh="meldebild-bandluecke"]')).toHaveLength(lueckenP);
    },
  );

  it('eine volle Reihe braucht keine Auffüllung', () => {
    // Sechs Zellen füllen jede der drei Stufen (6, 3, 2) restlos.
    const sechs = ['a', 'b', 'c', 'd', 'e', 'f'].map((k) => zelle(k, 'normal'));
    const { container } = renderMitProviders(
      <Statusband fahrzeuge={sechs} personal={[]} zustand="daten" />,
    );
    expect(container.querySelectorAll('[data-lfh="meldebild-bandluecke"]')).toHaveLength(0);
  });
});
