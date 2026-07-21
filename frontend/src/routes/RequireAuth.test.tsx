import { describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import RequireAuth from './RequireAuth';

vi.mock('../auth/AuthContext', async (echt) => ({
  ...(await echt<typeof import('../auth/AuthContext')>()),
  useAuth: () => ({
    benutzer: null,
    laedt: false,
    login: vi.fn(),
    logout: vi.fn(),
    aktualisiere: vi.fn(),
  }),
}));

function LoginSonde() {
  const von = (useLocation().state as { von?: string } | null)?.von ?? '';
  return <div data-testid="von">{von}</div>;
}

describe('RequireAuth', () => {
  it('merkt sich Pfad, Query-String und Hash als Rückkehr-URL', () => {
    const { getByTestId } = render(
      <MemoryRouter initialEntries={['/einsaetze/7/etb?eintrag=42#unten']}>
        <Routes>
          <Route path="/login" element={<LoginSonde />} />
          <Route element={<RequireAuth />}>
            <Route path="/einsaetze/:id/etb" element={<div>ETB</div>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );
    // `pathname` allein verlöre die Deeplink-Selektion des Query-Param-Musters (CLAUDE.md).
    expect(getByTestId('von').textContent).toBe('/einsaetze/7/etb?eintrag=42#unten');
  });
});
