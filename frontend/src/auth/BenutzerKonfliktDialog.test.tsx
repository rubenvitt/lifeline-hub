import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setzeErwartetenBenutzer } from '../api/client';
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
const { seiteNeuLaden } = vi.hoisted(() => ({ seiteNeuLaden: vi.fn() }));
vi.mock('./seiteNeuLaden', () => ({ seiteNeuLaden }));
vi.mock('../api/client', async (echt) => ({
  ...(await echt<typeof import('../api/client')>()),
  setzeErwartetenBenutzer: vi.fn(),
}));

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
  }),
}));

afterEach(() => {
  konflikt = null;
  seiteNeuLaden.mockReset();
  vi.mocked(setzeErwartetenBenutzer).mockReset();
});

function zeige() {
  render(<BenutzerKonfliktDialog />);
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
    expect(seiteNeuLaden).not.toHaveBeenCalled();
  });

  it('„Als B weiterarbeiten“ lädt die Startseite neu, ohne den Benutzer im laufenden Baum umzustellen', async () => {
    // Umstellen im laufenden Baum hieße: die noch montierte Seite von A schriebe ihren
    // Entwurf (Autosave, „Speichern und weiter“ im Navigationsschutz) mit der Kennung von B.
    // Bleibt die Kennung bei A, scheitert jeder solche Rest am Server mit 412.
    konflikt = { bisher: anna, jetzt: bruno };
    zeige();
    await userEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', {
        name: 'Als Bruno Beispiel weiterarbeiten',
      }),
    );
    expect(seiteNeuLaden).toHaveBeenCalledExactlyOnceWith('/einsaetze');
    expect(setzeErwartetenBenutzer).not.toHaveBeenCalled();
  });

  it('nennt vorgemerkte Offline-Einträge ehrlich', async () => {
    konflikt = { bisher: anna, jetzt: bruno };
    zeige();
    expect(await screen.findByRole('dialog')).toHaveTextContent(
      /Vorgemerkte Einträge bleiben für Anna Admin liegen/,
    );
  });
});
