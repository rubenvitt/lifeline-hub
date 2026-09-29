import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { renderMitProviders } from '../test/utils';
import { VorschauZustand, type VorschauAbfrage } from './VorschauZustand';

function abfrage(o: Partial<VorschauAbfrage<string>>): VorschauAbfrage<string> {
  return {
    data: undefined,
    isPending: false,
    fetchStatus: 'idle',
    isError: false,
    error: null,
    refetch: vi.fn(),
    ...o,
  };
}

const inhalt = (d: string) => <p>Inhalt: {d}</p>;

describe('VorschauZustand (LFH-664)', () => {
  it('zeigt den Inhalt, sobald der Datensatz da ist', () => {
    renderMitProviders(
      <VorschauZustand abfrage={abfrage({ data: 'Meldung 4' })} sorte="Die Meldung">
        {inhalt}
      </VorschauZustand>,
    );
    expect(screen.getByText('Inhalt: Meldung 4')).toBeInTheDocument();
  });

  it('benennt den Ladezustand', () => {
    renderMitProviders(
      <VorschauZustand
        abfrage={abfrage({ isPending: true, fetchStatus: 'fetching' })}
        sorte="Die Meldung"
      >
        {inhalt}
      </VorschauZustand>,
    );
    expect(screen.getByLabelText('Die Meldung wird geladen')).toBeInTheDocument();
    expect(screen.queryByText(/Inhalt/)).not.toBeInTheDocument();
  });

  it('nennt einen Ladefehler mit Wiederholen, statt leer zu bleiben', async () => {
    const refetch = vi.fn();
    renderMitProviders(
      <VorschauZustand
        abfrage={abfrage({ isError: true, error: new Error('kaputt'), refetch })}
        sorte="Die Meldung"
      >
        {inhalt}
      </VorschauZustand>,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Die Meldung konnte nicht geladen werden');
    await userEvent.click(screen.getByRole('button', { name: 'Erneut abrufen' }));
    expect(refetch).toHaveBeenCalled();
  });

  /**
   * Der stille Fall: `select` findet den Datensatz nicht mehr, `data` ist `undefined`, ohne dass
   * die Abfrage lädt oder scheitert.
   */
  it('sagt, dass der Datensatz nicht mehr vorhanden ist', () => {
    renderMitProviders(
      <VorschauZustand abfrage={abfrage({})} sorte="Die Meldung">
        {inhalt}
      </VorschauZustand>,
    );
    expect(screen.getByText('Die Meldung ist nicht mehr vorhanden.')).toBeInTheDocument();
  });

  /**
   * OHNE NETZ steht eine kalte Abfrage auf `pending` + `paused`; `isLoading` ist dann false. An
   * `isLoading` gehängt hieße das fälschlich „nicht mehr vorhanden“.
   */
  it('sagt ohne Verbindung, dass nicht abgerufen werden kann — nicht „nicht mehr vorhanden"', () => {
    renderMitProviders(
      <VorschauZustand
        abfrage={abfrage({ isPending: true, fetchStatus: 'paused' })}
        sorte="Die Meldung"
      >
        {inhalt}
      </VorschauZustand>,
    );
    expect(screen.getByText(/Die Meldung ist ohne Verbindung nicht abrufbar/)).toBeInTheDocument();
    expect(screen.queryByText(/nicht mehr vorhanden/)).not.toBeInTheDocument();
  });

  it('zeigt einen veralteten Stand mit Hinweis, statt ihn wegzuwerfen', () => {
    renderMitProviders(
      <VorschauZustand
        abfrage={abfrage({ data: 'Meldung 4', isError: true, error: new Error('x') })}
        sorte="Die Meldung"
      >
        {inhalt}
      </VorschauZustand>,
    );
    expect(screen.getByText('Inhalt: Meldung 4')).toBeInTheDocument();
    expect(screen.getByText(/womöglich veraltet/)).toBeInTheDocument();
  });
});
