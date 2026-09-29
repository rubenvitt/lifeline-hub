import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, renderHook, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import type { ReactNode } from 'react';
import { authWertFixture, benutzerFixture } from '../test/fixtures';
import { leseZuletztModule } from './zuletztModule';
import { useModulWahl } from './useModulWahl';

const auth = vi.hoisted(() => ({ benutzer: true }));
vi.mock('../auth/AuthContext', () => ({
  useAuth: () => authWertFixture(auth.benutzer ? benutzerFixture({ id: 3 }) : null),
}));

function Pfad() {
  const { pathname, search } = useLocation();
  return <div data-testid="pfad">{pathname + search}</div>;
}

function imEinsatz(children: ReactNode) {
  return (
    <MemoryRouter initialEntries={['/einsaetze/7/ueberblick']}>
      <Routes>
        <Route
          path="/einsaetze/:id/*"
          element={
            <>
              {children}
              <Pfad />
            </>
          }
        />
      </Routes>
    </MemoryRouter>
  );
}

function Seite() {
  const { linkFaenger, waehle } = useModulWahl();
  return (
    // Der Fänger liegt an der Wurzel; die Knöpfe gehen über `waehle`.
    <div {...linkFaenger}>
      {/* `preventDefault`: jsdom navigiert nicht, der Anker soll nur geklickt werden. */}
      <a href="/einsaetze/7/personen?filter=vermisst" onClick={(e) => e.preventDefault()}>
        <span>Betroffene</span>
      </a>
      <a href="/einsaetze" onClick={(e) => e.preventDefault()}>
        Einsätze
      </a>
      <span>Nur Text</span>
      <button type="button" onClick={() => waehle('/einsaetze/7/etb?neu=1')}>
        Eintrag
      </button>
    </div>
  );
}

describe('useModulWahl (LFH-436)', () => {
  beforeEach(() => {
    localStorage.clear();
    auth.benutzer = true;
  });

  it('merkt das Modul eines Pfads samt Query', () => {
    const { result } = renderHook(() => useModulWahl(), {
      wrapper: ({ children }) => imEinsatz(children),
    });
    result.current.merkeZiel('/einsaetze/7/personen?filter=vermisst');
    expect(leseZuletztModule(3, 7)).toEqual(['personen']);
  });

  it('merkt im Einsatz des ZIELS, nicht der aktuellen Route', () => {
    const { result } = renderHook(() => useModulWahl(), {
      wrapper: ({ children }) => imEinsatz(children),
    });
    result.current.merkeZiel('/einsaetze/8/etb');
    expect(leseZuletztModule(3, 8)).toEqual(['etb']);
    expect(leseZuletztModule(3, 7)).toEqual([]);
  });

  it('merkt auch den Mittelklick, der das Ziel im neuen Tab öffnet', async () => {
    render(imEinsatz(<Seite />));
    await userEvent.pointer({ keys: '[MouseMiddle]', target: screen.getByText('Betroffene') });
    expect(leseZuletztModule(3, 7)).toEqual(['personen']);
  });

  it('merkt nichts beim Rechtsklick, der nur das Kontextmenü öffnet', async () => {
    render(imEinsatz(<Seite />));
    await userEvent.pointer({ keys: '[MouseRight]', target: screen.getByText('Betroffene') });
    expect(leseZuletztModule(3, 7)).toEqual([]);
  });

  it('merkt nichts für einen Pfad ohne Modul', () => {
    const { result } = renderHook(() => useModulWahl(), {
      wrapper: ({ children }) => imEinsatz(children),
    });
    result.current.merkeZiel('/einsaetze');
    result.current.merkeZiel('/profil');
    expect(leseZuletztModule(3, 7)).toEqual([]);
  });

  it('merkt nichts ohne angemeldete Person', () => {
    auth.benutzer = false;
    const { result } = renderHook(() => useModulWahl(), {
      wrapper: ({ children }) => imEinsatz(children),
    });
    result.current.merkeZiel('/einsaetze/7/etb');
    expect(localStorage.length).toBe(0);
  });

  it('merkt beim Klick auf ein Kind eines Ankers dessen Modul', async () => {
    render(imEinsatz(<Seite />));
    await userEvent.click(screen.getByText('Betroffene'));
    expect(leseZuletztModule(3, 7)).toEqual(['personen']);
  });

  it('merkt nichts beim Klick außerhalb eines Ankers oder auf einen Anker ohne Modul', async () => {
    render(imEinsatz(<Seite />));
    await userEvent.click(screen.getByText('Nur Text'));
    await userEvent.click(screen.getByText('Einsätze'));
    expect(leseZuletztModule(3, 7)).toEqual([]);
  });

  it('merkt mit `waehle` und navigiert', async () => {
    render(imEinsatz(<Seite />));
    await userEvent.click(screen.getByRole('button', { name: 'Eintrag' }));
    expect(leseZuletztModule(3, 7)).toEqual(['etb']);
    expect(screen.getByTestId('pfad')).toHaveTextContent('/einsaetze/7/etb?neu=1');
  });
});
