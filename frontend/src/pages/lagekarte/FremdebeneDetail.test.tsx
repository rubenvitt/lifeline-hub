import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderMitProviders } from '../../test/utils';
import type { Fremdebene } from '../../api/fremdebenen';
import FremdebeneDetail from './FremdebeneDetail';

const EBENE: Fremdebene = {
  id: 4,
  name: 'Lage Nachbarkreis',
  color: 'fremd-1',
  source: 'url',
  url_host: 'geo.example.org',
  feature_count: 1,
  dropped_count: 0,
  created_at: '2026-11-24T10:00:00Z',
};

describe('Detailkarte eines Fremdebenen-Objekts (LLH-2099)', () => {
  it('zeigt Name, Beschreibung, Ebene und „Fremde Daten“, nur zum Lesen', () => {
    renderMitProviders(
      <FremdebeneDetail
        ebene={EBENE}
        properties={{ name: 'H 12', description: 'DN 100' }}
        onSchliessen={vi.fn()}
      />,
    );
    expect(screen.getByRole('heading', { name: 'H 12' })).toBeInTheDocument();
    expect(screen.getByText('DN 100')).toBeInTheDocument();
    expect(screen.getByText('Lage Nachbarkreis')).toBeInTheDocument();
    expect(screen.getAllByText(/Fremde Daten/).length).toBeGreaterThan(0);
    expect(screen.getByText('Fremde Daten von geo.example.org')).toBeInTheDocument();
    // Kein Schreibweg: der einzige Knopf schließt.
    expect(screen.getAllByRole('button').map((b) => b.getAttribute('aria-label'))).toEqual([
      'Schließen',
    ]);
  });

  it('ohne Objektnamen trägt der Kopf den Namen der Ebene', () => {
    renderMitProviders(<FremdebeneDetail ebene={EBENE} properties={{}} onSchliessen={vi.fn()} />);
    expect(screen.getByRole('heading', { name: 'Lage Nachbarkreis' })).toBeInTheDocument();
    expect(screen.queryByText('Beschreibung')).toBeNull();
  });
});
