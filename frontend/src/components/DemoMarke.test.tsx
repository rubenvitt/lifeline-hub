import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderMitProviders } from '../test/utils';
import DemoMarke from './DemoMarke';

describe('DemoMarke', () => {
  it('trägt die Bedeutung als Text und erklärt sich im title', () => {
    renderMitProviders(<DemoMarke />);
    const tag = screen.getByText('Demo').closest('.ant-tag') as HTMLElement;
    expect(tag).toBeInTheDocument();
    expect(tag).toHaveAttribute('title', 'Stammdaten aus dem Demo-Import');
  });

  /** WCAG 1.4.1: keine Farbe trägt die Marke. antd setzt für `color` entweder eine
   *  Preset-Klasse (`ant-tag-blue`) oder einen Inline-Hintergrund — beides darf fehlen. */
  it('ist neutral: keine Preset-Farbklasse, kein Inline-Hintergrund', () => {
    renderMitProviders(<DemoMarke />);
    const tag = screen.getByText('Demo').closest('.ant-tag') as HTMLElement;
    // Varianten-Klassen (`ant-tag-filled` …) sind Form, keine Farbe — geprüft werden nur die
    // Preset- und Statusfarben.
    const farbklassen = [...tag.classList].filter((k) =>
      /^ant-tag-(blue|purple|cyan|green|magenta|pink|red|orange|yellow|volcano|geekblue|lime|gold|success|processing|error|warning)$/.test(
        k,
      ),
    );
    expect(farbklassen).toEqual([]);
    expect(tag.style.backgroundColor).toBe('');
  });
});
