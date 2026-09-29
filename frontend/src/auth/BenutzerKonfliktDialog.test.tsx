import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BenutzerAnzeige } from '../api/types';
import type { BenutzerKonflikt } from './AuthContext';
import BenutzerKonfliktDialog from './BenutzerKonfliktDialog';

const anna: BenutzerAnzeige = {
  id: 1,
  anzeigename: 'Anna Admin',
  benutzername: 'anna',
  system_rolle: 'admin',
  org_rolle: 'keine',
  aktiv: true,
  erstellt_at: '2026-05-23 10:00:00',
  totp_aktiviert: false,
};
const bruno: BenutzerAnzeige = {
  ...anna,
  id: 2,
  anzeigename: 'Bruno Beispiel',
  benutzername: 'bruno',
};

let konflikt: BenutzerKonflikt | null = null;
const weiterAls = vi.fn();

vi.mock('./AuthContext', async (echt) => ({
  ...(await echt<typeof import('./AuthContext')>()),
  useAuth: () => ({
    benutzer: anna,
    laedt: false,
    login: vi.fn(),
    logout: vi.fn(),
    aktualisiere: vi.fn(),
    abmeldenLokal: vi.fn(),
    konflikt,
    weiterAls,
  }),
}));

afterEach(() => {
  konflikt = null;
  weiterAls.mockReset();
});

function zeige() {
  const client = new QueryClient();
  const leeren = vi.spyOn(client, 'clear');
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/einsaetze/7/etb?eintrag=3']}>
        <Routes>
          <Route path="/einsaetze" element={<div>Einsatzliste</div>} />
          <Route path="*" element={<div>Einsatzseite</div>} />
        </Routes>
        <BenutzerKonfliktDialog />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { leeren };
}

describe('BenutzerKonfliktDialog (LFH-387)', () => {
  it('ist ohne Konflikt nicht da', () => {
    zeige();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('nennt beide Benutzer und erklärt, dass unter dem bisherigen nichts mehr gespeichert wird', async () => {
    konflikt = { bisher: anna, jetzt: bruno };
    zeige();
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Anderer Benutzer angemeldet')).toBeInTheDocument();
    expect(dialog).toHaveTextContent('Bruno Beispiel');
    expect(dialog).toHaveTextContent('Anna Admin');
    expect(dialog).toHaveTextContent(/nichts mehr unter Anna Admin gespeichert/);
  });

  it('trägt genau eine Aktion und lässt sich weder per Escape noch per Kreuz schließen', async () => {
    konflikt = { bisher: anna, jetzt: bruno };
    zeige();
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getAllByRole('button')).toHaveLength(1);
    expect(within(dialog).queryByRole('button', { name: /close|schließen/i })).toBeNull();
    await userEvent.keyboard('{Escape}');
    // antd schließt animiert; „offen“ heißt im jsdom: kein Ausblend-Zustand (ant-zoom-leave).
    await new Promise((r) => setTimeout(r, 30));
    const nachEscape = screen.getByRole('dialog');
    expect(nachEscape.closest('.ant-zoom-leave')).toBeNull();
    expect(weiterAls).not.toHaveBeenCalled();
  });

  it('„Als B weiterarbeiten“ räumt den Cache, übernimmt B und führt zur Startseite', async () => {
    konflikt = { bisher: anna, jetzt: bruno };
    const { leeren } = zeige();
    expect(screen.getByText('Einsatzseite')).toBeInTheDocument();
    await userEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', {
        name: 'Als Bruno Beispiel weiterarbeiten',
      }),
    );
    expect(leeren).toHaveBeenCalledTimes(1);
    expect(weiterAls).toHaveBeenCalledTimes(1);
    expect(await screen.findByText('Einsatzliste')).toBeInTheDocument();
  });
});
