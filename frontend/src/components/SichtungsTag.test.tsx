import { ConfigProvider, theme } from 'antd';
import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderMitProviders } from '../test/utils';
import { antdToken, farbenDunkel, farbenHell } from '../theme/tokens';
import SichtungsTag from './SichtungsTag';

describe('SichtungsTag', () => {
  it.each(['light', 'dark'] as const)(
    '%s: Schwarz bleibt Kennzeichnung, Text bleibt lesbar',
    (modus) => {
      const config = {
        algorithm: modus === 'dark' ? theme.darkAlgorithm : theme.defaultAlgorithm,
        token: antdToken(modus === 'dark' ? farbenDunkel : farbenHell),
      };
      renderMitProviders(
        <ConfigProvider theme={config}>
          <SichtungsTag kategorie="tot" />
        </ConfigProvider>,
      );
      const tag = screen.getByText('tot');
      expect(tag).toHaveStyle({
        // Literale der Textrolle je Modus.
        color: modus === 'dark' ? '#e8ebee' : '#111418',
        background: 'transparent',
      });
      const farbfeld = tag.querySelector('[aria-hidden="true"]');
      expect(farbfeld).toHaveStyle({
        background: '#000000',
        borderColor: modus === 'dark' ? '#e8ebee' : '#111418',
      });
      expect(tag.className).not.toMatch(/ant-tag-(black|default)/);
    },
  );
  it('unverletzt bekommt keine erfundene Fachfarbe und Zähler 0 bleibt sichtbar', () => {
    renderMitProviders(<SichtungsTag kategorie="unverletzt" anzahl={0} />);
    const tag = screen.getByText('unverletzt: 0');
    expect(tag.querySelector('[aria-hidden]')).toBeNull();
  });

  describe('kompakte Form (LLH-1135, Personenmarke im Grundriss)', () => {
    it('Farbfeld und Kürzel ohne antd-Tag, die Schrift erbt die Marke', () => {
      renderMitProviders(<SichtungsTag kategorie="sk1" form="kompakt" />);
      const marke = screen.getByText('SK I');
      expect(marke.closest('.ant-tag')).toBeNull();
      expect(marke).toHaveAttribute('data-sichtung', 'sk1');
      // Am Stilattribut: jsdom löst `inherit` beim Rechnen zur Farbe des Elternknotens auf.
      expect(marke.style.color).toBe('inherit');
      expect(marke).toHaveStyle({ whiteSpace: 'nowrap' });
      const farbfeld = marke.querySelector<HTMLElement>('[aria-hidden="true"]');
      expect(farbfeld).toHaveStyle({ background: '#f5222d' });
      // Ohne Farbe im Kurzwert gilt `currentColor`, die Schrift der Marke.
      expect(farbfeld?.style.border).toBe('1px solid');
    });

    it('ungesichtet: Gedankenstrich sichtbar, das Wort im zugänglichen Namen', () => {
      renderMitProviders(
        <button type="button">
          <SichtungsTag kategorie={null} form="kompakt" /> R-001
        </button>,
      );
      expect(screen.getByRole('button', { name: /^ungesichtet R-001$/ })).toBeInTheDocument();
      const marke = document.querySelector('[data-sichtung="ungesichtet"]') as HTMLElement;
      expect(marke.querySelector('[aria-hidden="true"]')).toHaveTextContent('—');
    });

    it('unverletzt trägt kein Farbfeld, aber das Wort', () => {
      renderMitProviders(<SichtungsTag kategorie="unverletzt" form="kompakt" />);
      const marke = screen.getByText('unverletzt');
      expect(marke.querySelector('[aria-hidden="true"]')).toBeNull();
    });
  });
});
