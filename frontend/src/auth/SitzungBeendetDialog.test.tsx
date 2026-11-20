/**
 * LLH-1770: Der Dialog „Sitzung beendet“ legt sich über die montierte Seite. Die Seite
 * dahinter behält ihre Eingaben; Frist und „Abmelden“ führen zur Anmeldeseite mit Grund.
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Input, Modal } from 'antd';
import { useState } from 'react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '../test/server';
import type { BenutzerAnzeige } from '../api/types';
import { UNTERBRECHUNG_FRIST_MS, type SitzungsUnterbrechung } from './AuthContext';
import SitzungBeendetDialog from './SitzungBeendetDialog';

const anna = {
  id: 1,
  anzeigename: 'Anna Admin',
  benutzername: 'anna',
  org_id: 1,
  system_rolle: 'admin',
  org_rolle: 'keine',
  aktiv: true,
  erstellt_at: '2026-05-23 10:00:00',
  totp_aktiviert: false,
  passwort_gesetzt: true,
} as BenutzerAnzeige;

let unterbrechung: SitzungsUnterbrechung | null;
const login = vi.fn();
const unterbrechungBeenden = vi.fn(() => {
  unterbrechung = null;
  return Promise.resolve();
});

vi.mock('./AuthContext', async (echt) => ({
  ...(await echt<typeof import('./AuthContext')>()),
  useAuth: () => ({
    benutzer: anna,
    geraet: null,
    laedt: false,
    login,
    passwortFestlegen: vi.fn(),
    logout: vi.fn(),
    aktualisiere: vi.fn(),
    abmeldenLokal: vi.fn(),
    konflikt: null,
    unterbrechung,
    unterbrechen: vi.fn(() => true),
    unterbrechungBeenden,
  }),
}));

beforeEach(() => {
  unterbrechung = { bisher: anna, seit: Date.now() };
  login.mockReset();
  login.mockImplementation(() => {
    unterbrechung = null;
    return Promise.resolve({ status: 'ok' });
  });
  unterbrechungBeenden.mockClear();
  server.use(
    http.get('/api/auth/providers', () =>
      HttpResponse.json([
        { id: 'passwort', typ: 'passwort', anzeigename: 'Passwort', aktiviert: true },
        { id: 'firma', typ: 'oidc', anzeigename: 'Firmen-SSO', aktiviert: true },
      ]),
    ),
  );
});

afterEach(() => {
  vi.useRealTimers();
});

/** Eine Seite mit offenem Dialog und Eingabe, darüber der Sitzungsdialog. */
function SeiteMitAuftrag() {
  const [text, setText] = useState('');
  return (
    <Modal open title="Auftrag erteilen" footer={null}>
      <Input aria-label="Auftrag" value={text} onChange={(e) => setText(e.target.value)} />
    </Modal>
  );
}

function Ort() {
  const ort = useLocation();
  const zustand = ort.state as { von?: string; grund?: string } | null;
  return (
    <div data-testid="ort">{`${ort.pathname}|${zustand?.von ?? ''}|${zustand?.grund ?? ''}`}</div>
  );
}

function zeige(seite = <span>Seite</span>) {
  return render(
    <MemoryRouter initialEntries={['/einsaetze/4/meldungen?neu=1']}>
      <Routes>
        <Route
          path="*"
          element={
            <>
              {seite}
              <SitzungBeendetDialog />
              <Ort />
            </>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

describe('SitzungBeendetDialog (LLH-1770)', () => {
  it('ist ohne Unterbrechung nicht da', () => {
    unterbrechung = null;
    zeige();
    expect(screen.queryByText('Sitzung beendet')).toBeNull();
  });

  it('zeigt Kopf, Text, Restzeit und den vorbelegten Benutzernamen', async () => {
    zeige();
    expect(await screen.findByText('Sitzung beendet')).toBeInTheDocument();
    expect(
      screen.getByText('Erneut anmelden. Eingaben auf dieser Seite bleiben erhalten.'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Ohne Anmeldung wird diese Seite in 15 min geschlossen'),
    ).toBeInTheDocument();
    await waitFor(() => expect(screen.getByLabelText('Benutzername')).toHaveValue('anna'));
  });

  it('lässt sich weder mit Escape noch per Maske schließen', async () => {
    zeige();
    const dialog = await screen.findByRole('dialog', { name: 'Sitzung beendet' });
    fireEvent.keyDown(dialog, { key: 'Escape' });
    const maske = document.querySelector('.ant-modal-wrap');
    if (maske) fireEvent.click(maske);
    expect(screen.getByText('Sitzung beendet')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /close|schließen/i })).toBeNull();
  });

  it('liegt über einem offenen Dialog der Seite und behält dessen Eingabe', async () => {
    unterbrechung = null;
    const { rerender } = zeige(<SeiteMitAuftrag />);
    await userEvent.type(screen.getByLabelText('Auftrag'), 'Wasserschaden Keller');
    unterbrechung = { bisher: anna, seit: Date.now() };
    rerender(
      <MemoryRouter initialEntries={['/einsaetze/4/meldungen?neu=1']}>
        <Routes>
          <Route
            path="*"
            element={
              <>
                <SeiteMitAuftrag />
                <SitzungBeendetDialog />
                <Ort />
              </>
            }
          />
        </Routes>
      </MemoryRouter>,
    );
    const kopf = await screen.findByText('Sitzung beendet');
    const sitzung = kopf.closest('.ant-modal-wrap') as HTMLElement;
    const auftrag = screen.getByText('Auftrag erteilen').closest('.ant-modal-wrap') as HTMLElement;
    expect(Number(sitzung.style.zIndex)).toBeGreaterThan(Number(auftrag.style.zIndex || 1000));
    // Die Maske verdeckt undurchsichtig.
    const maske = document.querySelector('.lfh-sitzung-beendet-maske') as HTMLElement | null;
    expect(maske).not.toBeNull();
    await userEvent.type(screen.getByLabelText('Passwort'), 'geheim');
    await userEvent.click(screen.getByRole('button', { name: 'Anmelden' }));
    expect(login).toHaveBeenCalledWith('anna', 'geheim');
    expect(screen.getByLabelText('Auftrag')).toHaveValue('Wasserschaden Keller');
  });

  it('abgelaufene Frist führt sofort zur Anmeldeseite mit Grund', async () => {
    unterbrechung = { bisher: anna, seit: Date.now() - UNTERBRECHUNG_FRIST_MS - 60_000 };
    zeige();
    await waitFor(() => expect(unterbrechungBeenden).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(screen.getByTestId('ort')).toHaveTextContent(
        '/login|/einsaetze/4/meldungen?neu=1|sitzung-beendet',
      ),
    );
  });

  it('die Frist läuft im Dialog ab', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    zeige();
    await screen.findByText('Sitzung beendet');
    await act(async () => {
      vi.advanceTimersByTime(UNTERBRECHUNG_FRIST_MS + 2_000);
    });
    await waitFor(() => expect(unterbrechungBeenden).toHaveBeenCalledTimes(1));
  });

  it('„Abmelden“ führt zur Anmeldeseite mit Grund', async () => {
    zeige();
    await userEvent.click(await screen.findByRole('button', { name: 'Abmelden' }));
    expect(unterbrechungBeenden).toHaveBeenCalledTimes(1);
    await waitFor(() =>
      expect(screen.getByTestId('ort')).toHaveTextContent(
        '/login|/einsaetze/4/meldungen?neu=1|sitzung-beendet',
      ),
    );
  });

  it('der SSO-Knopf trägt den Hinweis', async () => {
    zeige();
    expect(
      await screen.findByRole('button', { name: /Mit Firmen-SSO anmelden/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Verlässt die Seite, Eingaben auf dieser Seite gehen verloren'),
    ).toBeInTheDocument();
  });
});
