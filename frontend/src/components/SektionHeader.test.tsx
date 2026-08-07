import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderMitProviders } from '../test/utils';
import SektionHeader from './SektionHeader';

describe('SektionHeader', () => {
  it('rendert Titel, Beschreibung, Extra und Children', () => {
    renderMitProviders(
      <SektionHeader titel="Anzeige" beschreibung="Darstellungs-Defaults" extra={<button>Extra</button>}>
        <div>Inhalt</div>
      </SektionHeader>,
    );
    expect(screen.getByRole('heading', { name: 'Anzeige' })).toBeInTheDocument();
    expect(screen.getByText('Darstellungs-Defaults')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Extra' })).toBeInTheDocument();
    expect(screen.getByText('Inhalt')).toBeInTheDocument();
  });

  it('rendert ohne Beschreibung', () => {
    renderMitProviders(<SektionHeader titel="Nur Titel" />);
    expect(screen.getByRole('heading', { name: 'Nur Titel' })).toBeInTheDocument();
  });

  it('zeigt den Query-Datenstand im Sektionskopf', () => {
    const zeit = new Date(2026, 5, 10, 9, 5).getTime();
    renderMitProviders(<SektionHeader titel="Liste" dataUpdatedAt={zeit} />);
    expect(screen.getByText('Stand 09:05')).toBeInTheDocument();
  });
});
