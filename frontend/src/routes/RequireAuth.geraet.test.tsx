import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import RequireAuth from './RequireAuth';
import { merkeGeraet } from '../geraet/geraetMarke';

/** Gerätezweige von `RequireAuth` (LFH-892, Spec `feldgeraet-bedienung`). */

const GERAET = {
  kopplung_id: 3,
  einsatz_id: 7,
  ansicht: 'uhs-tablet',
  uhs_id: 2,
  stelle: 'UHS Nord',
  bezeichnung: 'Tablet 1',
  laeuft_ab_at: '2026-10-05 12:00:00',
};

let wert: { benutzer: unknown; geraet: unknown; laedt: boolean } = {
  benutzer: null,
  geraet: null,
  laedt: false,
};

vi.mock('../auth/AuthContext', async (echt) => ({
  ...(await echt<typeof import('../auth/AuthContext')>()),
  useAuth: () => wert,
}));

afterEach(() => {
  localStorage.clear();
  wert = { benutzer: null, geraet: null, laedt: false };
});

function Ort() {
  return <div data-testid="ort">{useLocation().pathname}</div>;
}

function renderAn(route: string) {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <Routes>
        <Route path="/login" element={<Ort />} />
        <Route path="/kopplung-beendet" element={<Ort />} />
        <Route element={<RequireAuth />}>
          <Route path="*" element={<Ort />} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

describe('RequireAuth — Geräte (LFH-892)', () => {
  it('zeigt einem beendeten Gerät „Kopplung beendet“ statt der Anmeldung', () => {
    merkeGeraet(true);
    expect(renderAn('/geraet').getByTestId('ort').textContent).toBe('/kopplung-beendet');
  });

  it('führt einen Browser ohne Gerätemarke weiter zur Anmeldung', () => {
    expect(renderAn('/geraet').getByTestId('ort').textContent).toBe('/login');
  });

  it('hält ein Gerät auf seiner Hülle: die Lagekarte führt zur Startseite', () => {
    wert = { benutzer: { id: 9 }, geraet: GERAET, laedt: false };
    expect(renderAn('/einsaetze/7/lagekarte').getByTestId('ort').textContent).toBe('/geraet');
  });

  it('lässt Pfade unter der Hülle stehen, aber nicht ähnlich beginnende', () => {
    wert = { benutzer: { id: 9 }, geraet: GERAET, laedt: false };
    expect(renderAn('/geraet/patienten').getByTestId('ort').textContent).toBe('/geraet/patienten');
  });

  it('segmentgenau: /geraeteliste gehört nicht zur Hülle', () => {
    wert = { benutzer: { id: 9 }, geraet: GERAET, laedt: false };
    expect(renderAn('/geraeteliste').getByTestId('ort').textContent).toBe('/geraet');
  });

  it('lässt eine Person überall hin, wo sie die Anwendung hinführt', () => {
    wert = { benutzer: { id: 4 }, geraet: null, laedt: false };
    expect(renderAn('/einsaetze/7/lagekarte').getByTestId('ort').textContent).toBe(
      '/einsaetze/7/lagekarte',
    );
  });
});
