import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderMitProviders } from '../../test/utils';
import WarnstufenHinweis from './WarnstufenHinweis';

describe('WarnstufenHinweis', () => {
  it('Wort mit Warndreieck als Zeichen, Ton als Farbe', () => {
    const { container } = renderMitProviders(
      <WarnstufenHinweis ton="alarm">Warnstufe akut</WarnstufenHinweis>,
    );
    const hinweis = container.querySelector<HTMLElement>('[data-lfh="warnstufe-hinweis"]')!;
    expect(hinweis).toHaveTextContent('Warnstufe akut');
    expect(hinweis.querySelector('[aria-hidden="true"] svg')).not.toBeNull();
    expect(hinweis).toHaveAttribute('data-ton', 'alarm');
    expect(screen.getByText('Warnstufe akut')).toBeInTheDocument();
  });
});
