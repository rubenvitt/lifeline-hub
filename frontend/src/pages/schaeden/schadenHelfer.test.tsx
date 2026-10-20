import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { Schaden } from '../../api/types';
import { renderMitProviders } from '../../test/utils';
import { GEFAHR_LABEL, gefahrText, geschaedigtAnzeige } from './schadenHelfer';
import { GEFAHRENTYPEN } from '../gefahren/gefahrenSchema';

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

describe('gefahrText (LLH-1115)', () => {
  it('nennt Gefahr und Schadensgrad in Worten, nie als Schlüssel', () => {
    expect(gefahrText({ gefahrenart: 'elektrizitaet', schadensgrad: 'zerstoert' })).toBe(
      'Elektrizität · total zerstört',
    );
    expect(gefahrText({ schadensgrad: 'teilzerstoert' })).toBe('teilzerstört');
    expect(gefahrText({ gefahrenart: 'chemische_stoffe' })).toBe('Chemische Stoffe');
    expect(gefahrText({})).toBe('—');
  });

  it('benennt jede Gefahr wie das Gefahrengebiet', () => {
    for (const g of GEFAHRENTYPEN) expect(GEFAHR_LABEL[g.wert]).toBe(g.label);
  });
});
