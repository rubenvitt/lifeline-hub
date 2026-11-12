import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderMitProviders } from '../test/utils';
import FuehrungHinweisband from './FuehrungHinweisband';
import type { EinsatzAnzeige, FuehrungAnzeige } from '../api/types';

vi.mock('../auth/AuthContext', () => ({
  useAuth: vi.fn(),
  AuthProvider: ({ children }: { children?: unknown }) => children,
}));
vi.mock('../api/fuehrung', () => ({
  loadFuehrung: vi.fn(),
  bestaetigeUebernahme: vi.fn(),
  widersprecheUebernahme: vi.fn(),
}));

import { useAuth } from '../auth/AuthContext';
import { loadFuehrung } from '../api/fuehrung';
import { authWertFixture, benutzerFixture } from '../test/fixtures';

const einsatz = (rolle: EinsatzAnzeige['meine_rolle'], offen: boolean): EinsatzAnzeige =>
  ({
    id: 7,
    org_id: 1,
    status: 'aktiv',
    meine_rolle: rolle,
    fuehrung: { fuehrend: true, bei: 'ELW 1', epoche: 1, offen },
  }) as EinsatzAnzeige;

const akte: FuehrungAnzeige = {
  id: 4,
  kennung: 'k-elw/7',
  einsatz_id: 7,
  bezeichnung: 'Hochwasser',
  status: 'aktiv',
  epoche: 1,
  fuehrer_name: 'ELW 1',
  fuehrer_kennung: 'k-elw',
  fuehrend: true,
  art: 'angelegt',
  anfrage_offen: false,
  verwahrt: false,
  gegenueber: [],
  verlauf: [],
  offen: {
    von: 'Hub Nord',
    epoche: 2,
    grund: 'ELW ohne Verbindung',
    unterzeichner: 'Admin A',
    bruch_at: '2026-11-09 14:00:00',
  },
};

describe('FuehrungHinweisband (LLH-1491)', () => {
  beforeEach(() => {
    vi.mocked(useAuth).mockReturnValue(authWertFixture(benutzerFixture()));
    vi.mocked(loadFuehrung).mockResolvedValue(akte);
  });

  it('erscheint nur bei offener Übernahme', () => {
    renderMitProviders(<FuehrungHinweisband einsatz={einsatz('einsatzleitung', false)} />);
    expect(screen.queryByText(/Führung übernommen/)).toBeNull();
    expect(loadFuehrung).not.toHaveBeenCalled();
  });

  it('nennt von wem und warum; die Einsatzleitung entscheidet', async () => {
    renderMitProviders(<FuehrungHinweisband einsatz={einsatz('einsatzleitung', true)} />);
    expect(await screen.findByText('Führung übernommen von Hub Nord')).toBeInTheDocument();
    expect(screen.getByText(/unterzeichnet von Admin A · ELW ohne Verbindung/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Übernahme bestätigen' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Widersprechen' })).toBeInTheDocument();
  });

  it('Führungspersonal sieht den Hinweis ohne Entscheidung', async () => {
    renderMitProviders(<FuehrungHinweisband einsatz={einsatz('fuehrungspersonal', true)} />);
    expect(await screen.findByText('Führung übernommen von Hub Nord')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Übernahme bestätigen' })).toBeNull();
  });
  it('ein gescheiterter Abruf lässt das Band mit „Erneut laden“ stehen', async () => {
    vi.mocked(loadFuehrung).mockRejectedValueOnce(new Error('Netz weg'));
    renderMitProviders(<FuehrungHinweisband einsatz={einsatz('einsatzleitung', true)} />);
    const knopf = await screen.findByRole('button', { name: 'Erneut laden' });
    expect(
      screen.getByText('Die Angaben zur Übernahme ließen sich nicht laden.'),
    ).toBeInTheDocument();
    await userEvent.click(knopf);
    expect(await screen.findByText('Führung übernommen von Hub Nord')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Erneut laden' })).toBeNull());
  });
});
