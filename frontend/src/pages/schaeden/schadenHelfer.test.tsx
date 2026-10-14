import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { Schaden } from '../../api/types';
import { renderMitProviders } from '../../test/utils';
import { geschaedigtAnzeige } from './schadenHelfer';

describe('geschaedigtAnzeige', () => {
  /**
   * `?personal=` bleibt Zeilenmarke der Personalliste (LLH-1060 D2): der Schaden zeigt die
   * geschädigte Einsatzkraft im Vergleich mit den übrigen Kräften, nicht ihre Ansicht.
   */
  it('verlinkt eine geschädigte Einsatzkraft auf ihre Zeile in der Personalliste', () => {
    const schaden = {
      geschaedigt_registrier_nr: null,
      geschaedigt_personal_id: 12,
      geschaedigt_personal_name: 'Anna Berg',
      geschaedigt_organisation_id: null,
    } as unknown as Schaden;
    renderMitProviders(<>{geschaedigtAnzeige(schaden, 5)}</>);
    expect(screen.getByRole('link', { name: /Anna Berg/ })).toHaveAttribute(
      'href',
      '/einsaetze/5/personal?personal=12',
    );
  });
});
