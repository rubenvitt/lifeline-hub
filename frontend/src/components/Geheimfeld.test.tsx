import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { renderMitProviders } from '../test/utils';
import type { AdapterGeheimnisAnzeige } from '../api/types';
import { ApiError } from '../api/client';
import Geheimfeld from './Geheimfeld';

/** Geheimfeld (LLH-2018): ein Geheimnis setzen, ersetzen, entfernen, nie lesen. */

const GEHEIM = 'sehr-geheimer-wert-123';

const platz = (extra: Partial<AdapterGeheimnisAnzeige> = {}): AdapterGeheimnisAnzeige => ({
  name: 'token',
  bezeichnung: 'API-Schlüssel',
  pflicht: true,
  is_gesetzt: false,
  is_unlesbar: false,
  ...extra,
});

const gesetzt = platz({
  is_gesetzt: true,
  gesetzt_at: '2026-11-21 17:04:00',
  gesetzt_von_name: 'R. Vitt',
});

function rendere(props: Partial<Parameters<typeof Geheimfeld>[0]> = {}) {
  const onSetzen = props.onSetzen ?? vi.fn(() => Promise.resolve());
  const onEntfernen = props.onEntfernen ?? vi.fn(() => Promise.resolve());
  const r = renderMitProviders(
    <Geheimfeld
      platz={platz()}
      darfSchreiben
      maxLaenge={4096}
      {...props}
      onSetzen={onSetzen}
      onEntfernen={onEntfernen}
    />,
  );
  return { ...r, onSetzen, onEntfernen };
}

describe('Geheimfeld', () => {
  it('nennt einen fehlenden Pflichtwert und bietet „Setzen“', () => {
    rendere();
    expect(screen.getByText('API-Schlüssel')).toBeInTheDocument();
    expect(
      screen.getByText(/nicht gesetzt: der Adapter ruft ohne ihn nicht ab/),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Setzen' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: /Entfernen/ })).not.toBeInTheDocument();
  });

  it('zeigt einen gesetzten Wert nur als „gesetzt … von …“', () => {
    rendere({ platz: gesetzt });
    const zeile = screen.getByTestId('geheimfeld-token');
    expect(zeile).toHaveTextContent(/gesetzt .* von R\. Vitt/);
    expect(screen.getByRole('button', { name: 'Ersetzen' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Entfernen …' })).toBeEnabled();
    expect(zeile.querySelector('input')).toBeNull();
  });

  it('sendet den Wert und vergisst ihn danach', async () => {
    const user = userEvent.setup();
    const { onSetzen, client } = rendere({ platz: gesetzt });
    await user.click(screen.getByRole('button', { name: 'Ersetzen' }));
    const feld = screen.getByLabelText('Neuer Wert für API-Schlüssel');
    expect(feld).toHaveAttribute('type', 'password');
    expect(feld).toHaveAttribute('autocomplete', 'new-password');
    await user.type(feld, GEHEIM);
    await user.click(screen.getByRole('button', { name: 'Speichern' }));
    await waitFor(() => expect(onSetzen).toHaveBeenCalledWith(GEHEIM));
    await waitFor(() =>
      expect(screen.queryByLabelText('Neuer Wert für API-Schlüssel')).not.toBeInTheDocument(),
    );
    expect(document.body.innerHTML).not.toContain(GEHEIM);
    expect(
      JSON.stringify(
        client
          .getMutationCache()
          .getAll()
          .map((m) => m.state),
      ),
    ).not.toContain(GEHEIM);
  });

  it('leert das Feld auch, wenn das Speichern scheitert, und zeigt den Fehler', async () => {
    const user = userEvent.setup();
    const onSetzen = vi.fn(() => Promise.reject(new ApiError(422, 'Server sagt nein')));
    rendere({ onSetzen });
    await user.click(screen.getByRole('button', { name: 'Setzen' }));
    await user.type(screen.getByLabelText('Neuer Wert für API-Schlüssel'), GEHEIM);
    await user.click(screen.getByRole('button', { name: 'Speichern' }));
    expect(await screen.findByText('Server sagt nein')).toBeInTheDocument();
    expect(screen.getByLabelText('Neuer Wert für API-Schlüssel')).toHaveValue('');
    expect(document.body.innerHTML).not.toContain(GEHEIM);
  });

  it('verwirft mit „Abbrechen“ und mit Escape', async () => {
    const user = userEvent.setup();
    const { onSetzen } = rendere();
    await user.click(screen.getByRole('button', { name: 'Setzen' }));
    await user.type(screen.getByLabelText('Neuer Wert für API-Schlüssel'), 'abc');
    await user.click(screen.getByRole('button', { name: 'Abbrechen' }));
    expect(screen.queryByLabelText('Neuer Wert für API-Schlüssel')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Setzen' }));
    expect(screen.getByLabelText('Neuer Wert für API-Schlüssel')).toHaveValue('');
    await user.type(screen.getByLabelText('Neuer Wert für API-Schlüssel'), 'abc{Escape}');
    expect(screen.queryByLabelText('Neuer Wert für API-Schlüssel')).not.toBeInTheDocument();
    expect(onSetzen).not.toHaveBeenCalled();
  });

  it('sendet keinen leeren Wert und begrenzt die Länge', async () => {
    const user = userEvent.setup();
    const { onSetzen } = rendere({ maxLaenge: 8 });
    await user.click(screen.getByRole('button', { name: 'Setzen' }));
    expect(screen.getByRole('button', { name: 'Speichern' })).toBeDisabled();
    await user.type(screen.getByLabelText('Neuer Wert für API-Schlüssel'), '   ');
    expect(screen.getByRole('button', { name: 'Speichern' })).toBeDisabled();
    expect(screen.getByLabelText('Neuer Wert für API-Schlüssel')).toHaveAttribute('maxlength', '8');
    expect(onSetzen).not.toHaveBeenCalled();
  });

  it('entfernt erst nach der roten Rückfrage', async () => {
    const user = userEvent.setup();
    const { onEntfernen } = rendere({ platz: gesetzt });
    await user.click(screen.getByRole('button', { name: 'Entfernen …' }));
    expect(onEntfernen).not.toHaveBeenCalled();
    expect(await screen.findByText('API-Schlüssel entfernen?')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Entfernen' }));
    await waitFor(() => expect(onEntfernen).toHaveBeenCalledTimes(1));
  });

  it('nennt den Grund, wenn das Entfernen scheitert', async () => {
    const user = userEvent.setup();
    const onEntfernen = vi.fn(() => Promise.reject(new ApiError(404, 'Nicht gefunden')));
    rendere({ platz: gesetzt, onEntfernen });
    await user.click(screen.getByRole('button', { name: 'Entfernen …' }));
    await user.click(await screen.findByRole('button', { name: 'Entfernen' }));
    expect(await screen.findByText('Nicht gefunden')).toBeInTheDocument();
    expect(screen.getByText('Nicht entfernt')).toBeInTheDocument();
  });

  it('nennt einen unlesbaren Wert und bietet „Neu setzen“', () => {
    rendere({ platz: { ...gesetzt, is_unlesbar: true } });
    expect(
      screen.getByText(/unlesbar: mit einem anderen Schlüssel des Servers gesetzt/),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Neu setzen' })).toBeEnabled();
  });

  it('sperrt das Setzen mit Grund', () => {
    rendere({ gesperrt: 'Geheimnisspeicher ohne Schlüssel' });
    const knopf = screen.getByRole('button', { name: 'Setzen' });
    expect(knopf).toBeDisabled();
    expect(knopf.closest('[title]')).toHaveAttribute('title', 'Geheimnisspeicher ohne Schlüssel');
  });

  it('zeigt ohne Schreibrecht keine Knöpfe', () => {
    rendere({ platz: gesetzt, darfSchreiben: false });
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.getByText(/von R\. Vitt/)).toBeInTheDocument();
  });
});
