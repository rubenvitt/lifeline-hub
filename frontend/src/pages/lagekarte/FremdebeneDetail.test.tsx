import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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

const FLAECHE = {
  type: 'Polygon',
  coordinates: [
    [
      [9, 50],
      [9.1, 50],
      [9.1, 50.1],
      [9, 50],
    ],
  ],
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

  it('mit Schreibrecht und Fläche: „Übernehmen“ öffnet die Artwahl und meldet sie (LLH-2129)', async () => {
    const onUebernehmen = vi.fn(() => Promise.resolve(true));
    renderMitProviders(
      <FremdebeneDetail
        ebene={EBENE}
        properties={{ name: 'H 12' }}
        geometrie={FLAECHE}
        darfSchreiben
        onUebernehmen={onUebernehmen}
        onSchliessen={vi.fn()}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Übernehmen …' }));
    await userEvent.click(screen.getByRole('button', { name: 'Übernehmen' }));
    expect(onUebernehmen).toHaveBeenCalledWith({
      teile: [{ art: 'flaeche', geometrie: FLAECHE }],
      zonenTyp: 'gefahrengebiet',
    });
  });

  it('ohne Schreibrecht kein „Übernehmen“', () => {
    renderMitProviders(
      <FremdebeneDetail
        ebene={EBENE}
        properties={{}}
        geometrie={FLAECHE}
        darfSchreiben={false}
        onUebernehmen={vi.fn()}
        onSchliessen={vi.fn()}
      />,
    );
    expect(screen.queryByRole('button', { name: 'Übernehmen …' })).toBeNull();
  });

  it('gemischte oder zu große Objekte: Knopf gesperrt mit Grund', async () => {
    const { rerender } = renderMitProviders(
      <FremdebeneDetail
        ebene={EBENE}
        properties={{}}
        geometrie={{
          type: 'GeometryCollection',
          geometries: [FLAECHE, { type: 'Point', coordinates: [9, 50] }],
        }}
        darfSchreiben
        onUebernehmen={vi.fn()}
        onSchliessen={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: 'Übernehmen …' })).toBeDisabled();
    expect(screen.getByText('Gemischte Objekte lassen sich nicht übernehmen')).toBeInTheDocument();
    rerender(
      <FremdebeneDetail
        ebene={EBENE}
        properties={{}}
        geometrie={{
          type: 'MultiPoint',
          coordinates: Array.from({ length: 21 }, (_, i) => [9 + i / 100, 50]),
        }}
        darfSchreiben
        onUebernehmen={vi.fn()}
        onSchliessen={vi.fn()}
      />,
    );
    expect(screen.getByText('Mehr als 20 Teile lassen sich nicht übernehmen')).toBeInTheDocument();
  });

  it('nach dem Wechsel von Fläche zu Linie gilt die Vorgabe der Linie', async () => {
    const onUebernehmen = vi.fn(() => Promise.resolve(true));
    const LINIE = {
      type: 'LineString',
      coordinates: [
        [9, 50],
        [9.1, 50.1],
      ],
    };
    const { rerender } = renderMitProviders(
      <FremdebeneDetail
        ebene={EBENE}
        properties={{}}
        geometrie={FLAECHE}
        darfSchreiben
        onUebernehmen={onUebernehmen}
        onSchliessen={vi.fn()}
      />,
    );
    rerender(
      <FremdebeneDetail
        ebene={EBENE}
        properties={{}}
        geometrie={LINIE}
        darfSchreiben
        onUebernehmen={onUebernehmen}
        onSchliessen={vi.fn()}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Übernehmen …' }));
    expect(screen.getByRole('radio', { name: 'Absperrgrenze' })).toBeChecked();
    await userEvent.click(screen.getByRole('button', { name: 'Übernehmen' }));
    expect(onUebernehmen).toHaveBeenCalledWith(
      expect.objectContaining({ zonenTyp: 'absperrgrenze' }),
    );
  });
});
