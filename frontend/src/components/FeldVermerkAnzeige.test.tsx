import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderMitProviders } from '../test/utils';
import { PaneelVermerk, VermerkZeile } from './FeldVermerkAnzeige';

describe('FeldVermerkAnzeige (LLH-1834)', () => {
  it('Zeile: „Geändert von …“, ohne Vermerk nichts', () => {
    const { rerender } = renderMitProviders(
      <VermerkZeile vermerk={{ at: '2020-01-01 13:05:00', von: 'Anna' }} />,
    );
    expect(screen.getByText(/^Geändert von Anna, /)).toBeInTheDocument();
    rerender(<VermerkZeile />);
    expect(screen.queryByText(/Geändert/)).not.toBeInTheDocument();
  });

  it('Paneelkopf: „Zuletzt geändert von …“; ohne Namen nur die Zeit', () => {
    renderMitProviders(<PaneelVermerk vermerk={{ at: '2020-01-01 13:05:00' }} />);
    expect(screen.getByText(/^Zuletzt geändert \S/)).toBeInTheDocument();
    expect(screen.queryByText(/von/)).not.toBeInTheDocument();
  });
});
