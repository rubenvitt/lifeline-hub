import { describe, expect, it } from 'vitest';
import { farbenHell } from '../theme/tokens';
import { verortenLinkStil } from './personBearbeiten';

describe('verortenLinkStil', () => {
  it('trägt beide Angaben des handgebauten Bedienziels und folgt der Dichtestufe', () => {
    // Literale Böden: kompakt 30, Handschuh 72.
    expect(
      verortenLinkStil({ controlHeight: 30, paddingSM: 12 }, farbenHell.bedienText),
    ).toMatchObject({
      minHeight: 30,
      paddingInline: 12,
      // Die übergebene Textrolle, nicht antds `colorLink`.
      color: farbenHell.bedienText,
    });
    expect(
      verortenLinkStil({ controlHeight: 72, paddingSM: 12 }, farbenHell.bedienText).minHeight,
    ).toBe(72);
  });
});
