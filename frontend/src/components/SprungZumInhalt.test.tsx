import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fireEvent, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { renderMitProviders } from '../test/utils';
import { RAHMEN_EBENE } from './rahmenOben';
import SprungZumInhalt, { SPRUNGZIEL_INHALT, sprungZumInhaltStil } from './SprungZumInhalt';

/**
 * Sprunglink zum Inhalt (nufmon70, Spec `einsatztauglichkeit-layout`, „Ein Sprunglink führt zum
 * Inhalt“, D2/D4). Was nur der Browser zeigt (sichtbar mit Fokus, kein Layoutsprung, nicht
 * verdeckt), misst `e2e/sprung-zum-inhalt.spec.ts`.
 */

afterEach(() => {
  window.history.replaceState(null, '', '/');
});

const link = () => screen.getByRole('link', { name: 'Zum Inhalt springen' });

describe('SprungZumInhalt', () => {
  it('setzt den Fokus auf das letzte Sprungziel in DOM-Reihenfolge, also das innere', () => {
    renderMitProviders(
      <>
        <SprungZumInhalt />
        <main data-lfh={SPRUNGZIEL_INHALT} tabIndex={-1} data-testid="aussen">
          <nav>Menü</nav>
          <div data-lfh={SPRUNGZIEL_INHALT} tabIndex={-1} data-testid="innen">
            <button type="button">Erstes Bedienelement</button>
          </div>
        </main>
      </>,
    );
    fireEvent.click(link());
    expect(document.activeElement).toBe(screen.getByTestId('innen'));
  });

  it('lässt die Adresse ohne Hash: der Klick wird abgefangen', () => {
    renderMitProviders(
      <>
        <SprungZumInhalt />
        <main data-lfh={SPRUNGZIEL_INHALT} tabIndex={-1} />
      </>,
    );
    const nichtAbgefangen = fireEvent.click(link());
    expect(nichtAbgefangen).toBe(false);
    expect(window.location.hash).toBe('');
  });

  it('wirft ohne Ziel nicht und lässt die Adresse stehen', () => {
    renderMitProviders(<SprungZumInhalt />);
    link().focus();
    expect(() => fireEvent.click(link())).not.toThrow();
    expect(window.location.hash).toBe('');
    expect(document.activeElement).toBe(link());
  });

  it('trägt Wortlaut, Klasse und Greifer, ist aber selbst kein Sprungziel', () => {
    renderMitProviders(<SprungZumInhalt />);
    expect(link()).toHaveClass('lfh-sprung-inhalt');
    expect(link()).toHaveAttribute('data-lfh', 'sprung-zum-inhalt');
    expect(link()).toHaveAttribute('href', '#inhalt');
  });

  it('hält die Steuerhöhe der Staffel und liegt über dem klebenden Rahmen', () => {
    for (const [controlHeight, padding] of [
      [30, 12],
      [48, 16],
      [72, 20],
    ]) {
      const stil = sprungZumInhaltStil({ controlHeight, padding });
      expect(stil.minHeight).toBe(controlHeight);
      expect(stil.padding).toBe(`0 ${padding}px`);
      expect(stil.zIndex).toBeGreaterThan(RAHMEN_EBENE);
    }
    expect(sprungZumInhaltStil({ controlHeight: 72, padding: 20 }).minHeight).toBe(72);
  });

  it('sprache.css blendet ihn ohne Fokus aus und zeigt ihn mit Fokus fest oben links', () => {
    const css = readFileSync(join(process.cwd(), 'src/theme/sprache.css'), 'utf8');
    const ohneFokus = css.match(/\.lfh-sprung-inhalt:not\(:focus\) \{([^}]*)\}/)?.[1] ?? '';
    expect(ohneFokus).toMatch(/position: absolute;/);
    expect(ohneFokus).toMatch(/clip: rect\(0 0 0 0\);/);
    expect(ohneFokus).toMatch(/min-height: 0 !important;/);
    const mitFokus = css.match(/\.lfh-sprung-inhalt:focus \{([^}]*)\}/)?.[1] ?? '';
    expect(mitFokus).toMatch(/position: fixed;/);
    expect(mitFokus).toMatch(/top: 0;/);
    expect(mitFokus).toMatch(/left: 0;/);
    expect(mitFokus).toMatch(/background: var\(--lfh-paneel\);/);
    expect(mitFokus).toMatch(/outline: 2px solid var\(--lfh-bedien\);/);
    // Das Ziel ist kein Bedienelement: kein Ring um die ganze Fläche (D2, Risiken).
    expect(css).toMatch(/\[data-lfh='sprungziel-inhalt'\]:focus \{\s*outline: none;/);
  });

  it('index.css nimmt den Link von den Fokusabständen oben aus', () => {
    const css = readFileSync(join(process.cwd(), 'src/index.css'), 'utf8');
    const ausnahme = css.match(/:root:has\(([^)]*\)[^{]*)\{\s*scroll-padding-block-start: 0px;/);
    expect(ausnahme?.[1]).toContain('.lfh-sprung-inhalt:focus');
  });
});
