import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderMitProviders } from '../../test/utils';
import BeantragtListe from './BeantragtListe';

describe('BeantragtListe (LLH-1492, Spec `spiegel-antraege`)', () => {
  it('zeigt beantragte Erfassungen mit Zeit unter eigenem Titel', () => {
    renderMitProviders(
      <BeantragtListe
        titel="Beantragte Meldungen"
        eintraege={[
          { schluessel: 'antrag-1', text: 'Hub · Bitte Lagebild', zeit: '2026-11-10 08:00:00' },
        ]}
      />,
    );
    const liste = screen.getByRole('region', { name: 'Beantragte Meldungen' });
    expect(liste).toHaveTextContent('Hub · Bitte Lagebild');
  });

  it('steht ohne Anträge nicht da', () => {
    renderMitProviders(<BeantragtListe eintraege={[]} />);
    expect(document.querySelector('[data-lfh="beantragt"]')).toBeNull();
  });
});
