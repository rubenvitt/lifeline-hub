import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { useSitzungsWache } from './useSitzungsWache';
import { SITZUNG_ABGELAUFEN, sitzungsMeldungZuruecksetzen } from './sitzungsEvent';

const logout = vi.fn(() => Promise.resolve(true));
const abmeldenLokal = vi.fn();

vi.mock('./AuthContext', async (echt) => ({
  ...(await echt<typeof import('./AuthContext')>()),
  useAuth: () => ({
    benutzer: null,
    laedt: false,
    login: vi.fn(),
    logout,
    aktualisiere: vi.fn(),
    abmeldenLokal,
    konflikt: null,
  }),
}));

afterEach(() => {
  sitzungsMeldungZuruecksetzen();
  logout.mockClear();
  abmeldenLokal.mockReset();
});

/** Rendert die Wache unter `route` und macht Pfad + Rückkehr-URL sichtbar. */
function Sonde() {
  useSitzungsWache();
  const ort = useLocation();
  const von = (ort.state as { von?: string } | null)?.von ?? '';
  return <div data-testid="ort">{`${ort.pathname}|${von}`}</div>;
}

function renderWache(route: string) {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <Routes>
        <Route path="*" element={<Sonde />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('useSitzungsWache', () => {
  it('meldet ab und leitet zum Login, wenn die Sitzung abläuft', async () => {
    const { getByTestId } = renderWache('/admin/benutzer');
    window.dispatchEvent(new CustomEvent(SITZUNG_ABGELAUFEN));
    await waitFor(() => expect(getByTestId('ort').textContent).toMatch(/^\/login\|/));
    expect(abmeldenLokal).toHaveBeenCalledTimes(1);
  });

  it('ruft keinen Server-Logout — er träfe eine inzwischen neue Sitzung (LFH-387)', async () => {
    // Zwischen der 401 dieses Tabs und seinem Logout kann sich in einem anderen Tab jemand
    // angemeldet haben; `POST /api/auth/logout` liefe dann mit DESSEN Cookie.
    const { getByTestId } = renderWache('/einsaetze/7/etb');
    window.dispatchEvent(new CustomEvent(SITZUNG_ABGELAUFEN));
    await waitFor(() => expect(getByTestId('ort').textContent).toMatch(/^\/login\|/));
    expect(logout).not.toHaveBeenCalled();
  });

  it('nimmt Query-String und Hash in die Rückkehr-URL auf', async () => {
    const { getByTestId } = renderWache('/einsaetze/7/etb?eintrag=42#unten');
    window.dispatchEvent(new CustomEvent(SITZUNG_ABGELAUFEN));
    await waitFor(() =>
      expect(getByTestId('ort').textContent).toBe('/login|/einsaetze/7/etb?eintrag=42#unten'),
    );
  });

  it('leitet auch dann um, wenn das lokale Abmelden wirft', async () => {
    // Sicherheitsrelevanter Seam: eine gebrochene Zusage darf keinen hängenden Nutzer erzeugen.
    abmeldenLokal.mockImplementationOnce(() => {
      throw new Error('kaputt');
    });
    const konsole = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { getByTestId } = renderWache('/einsaetze/7/lage-dashboard');
    window.dispatchEvent(new CustomEvent(SITZUNG_ABGELAUFEN));
    await waitFor(() =>
      expect(getByTestId('ort').textContent).toBe('/login|/einsaetze/7/lage-dashboard'),
    );
    expect(konsole).toHaveBeenCalled();
    konsole.mockRestore();
  });

  it('leitet auf der Login-Seite nicht erneut um (keine Schleife)', async () => {
    const { getByTestId } = renderWache('/login');
    window.dispatchEvent(new CustomEvent(SITZUNG_ABGELAUFEN));
    await new Promise((r) => setTimeout(r, 20));
    expect(getByTestId('ort').textContent).toBe('/login|');
    expect(abmeldenLokal).not.toHaveBeenCalled();
  });
});
