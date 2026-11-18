import userEvent from '@testing-library/user-event';
import { screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderMitProviders } from '../../test/utils';
import KlappBand, { klappBandSchluessel, klappBandKopfStil } from './KlappBand';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** `css: false` in Vitest: die Datei wird als Quelltext gelesen (Muster `EinsatzSeite.test.tsx`). */
const klappBandCss = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), 'klappBand.css'),
  'utf-8',
);

/**
 * Klappbare Kennzahlen über einer Liste (LLH-1786, Change `z137bgm5-seitenkopf-einzeilig` D3,
 * Spec `einsatztauglichkeit-layout`, „Kennzahlenbänder über Listen lassen sich einklappen“).
 */

afterEach(() => {
  window.localStorage.clear();
  vi.restoreAllMocks();
});

function zeige() {
  return renderMitProviders(
    <KlappBand seite="test" titel="Unterbringung in Zahlen" kurzform="12 in Betreuung · 18 frei">
      <div data-testid="band">Band</div>
    </KlappBand>,
  );
}

describe('KlappBand', () => {
  it('druckt das Band immer offen und ohne Klappkopf (Quelltext-Pin, jsdom rechnet kein @media)', () => {
    expect(klappBandCss).toMatch(
      /@media print[\s\S]*klappband-inhalt["']\]\[hidden\][\s\S]*display:\s*block/,
    );
    expect(klappBandCss).toMatch(/\.lfh-klappband-kopf\s*\{\s*display:\s*none/);
  });

  it('steht ohne gemerkte Wahl offen, der Kopf sagt es mit aria-expanded', () => {
    zeige();
    const kopf = screen.getByRole('button', { name: /Unterbringung in Zahlen/ });
    expect(kopf).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByTestId('band')).toBeInTheDocument();
    // Offen steht die Kurzform nicht im Kopf: das Band selbst zeigt die Zahlen.
    expect(kopf).not.toHaveTextContent('12 in Betreuung');
  });

  it('klappt ein: eine Zeile mit der Kurzform bleibt, das Band fehlt', async () => {
    zeige();
    await userEvent.click(screen.getByRole('button', { name: /Unterbringung in Zahlen/ }));
    const kopf = screen.getByRole('button', { name: /Unterbringung in Zahlen/ });
    expect(kopf).toHaveAttribute('aria-expanded', 'false');
    expect(kopf).toHaveTextContent('12 in Betreuung · 18 frei');
    expect(screen.getByTestId('band')).not.toBeVisible();
  });

  it('merkt die Wahl je Seite auf dem Gerät, ein Neuaufbau steht wieder eingeklappt', async () => {
    const { unmount } = zeige();
    await userEvent.click(screen.getByRole('button', { name: /Unterbringung in Zahlen/ }));
    expect(window.localStorage.getItem(klappBandSchluessel('test'))).toBe('zu');
    unmount();
    zeige();
    expect(screen.getByRole('button', { name: /Unterbringung in Zahlen/ })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
  });

  it('wirkt ohne Browserspeicher für die Sitzung', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('gesperrt');
    });
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('gesperrt');
    });
    zeige();
    await userEvent.click(screen.getByRole('button', { name: /Unterbringung in Zahlen/ }));
    expect(screen.getByRole('button', { name: /Unterbringung in Zahlen/ })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
  });

  it('hält den Kopf auf der Steuerhöhe der Stufe (30 / 48 / 72 px)', () => {
    for (const hoehe of [30, 48, 72]) {
      expect(
        klappBandKopfStil({ controlHeight: hoehe, paddingXS: 4, paddingSM: 8 }).minHeight,
      ).toBe(hoehe);
    }
  });
});
