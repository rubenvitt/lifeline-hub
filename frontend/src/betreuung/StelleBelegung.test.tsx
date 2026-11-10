import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { renderMitProviders } from '../test/utils';
import StelleBelegung from './StelleBelegung';

/** „Belegung in Zahlen“ einer Stelle (LLH-1044), namentlich geführt seit LLH-1612. */

const zelle = (titel: string) =>
  screen.getByText(titel).closest('[data-lfh="kennzahl"]') as HTMLElement | null;

describe('StelleBelegung', () => {
  it('gezählt: Belegt, Kapazität, Frei und „Davon namentlich“ mit Personenrecht', () => {
    renderMitProviders(
      <StelleBelegung
        stelle={{
          belegungsart: 'gezaehlt',
          kapazitaet_personen: 150,
          belegung: { id: 1, belegt: 89, zeitpunkt_at: '2026-11-09 08:00:00' },
        }}
        namentlich={3}
      />,
    );
    expect(zelle('Belegt')).toHaveTextContent('89');
    expect(zelle('Davon namentlich')).toHaveTextContent('3');
    expect(screen.queryByText('namentlich geführt')).toBeNull();
  });

  it('namentlich geführt: die Belegung nennt ihre Herkunft, „Davon namentlich“ entfällt (dieselbe Zahl)', () => {
    renderMitProviders(
      <StelleBelegung
        stelle={{
          belegungsart: 'namentlich',
          kapazitaet_personen: 150,
          belegung: { id: 1, belegt: 15, zeitpunkt_at: '2026-11-09 08:00:00' },
        }}
        namentlich={15}
      />,
    );
    expect(zelle('Belegt')).toHaveTextContent('15');
    expect(zelle('Belegt')).toHaveTextContent('namentlich geführt');
    expect(screen.queryByText('Davon namentlich')).toBeNull();
  });
});
