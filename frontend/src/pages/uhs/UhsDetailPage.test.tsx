import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App as AntApp } from 'antd';
import UhsDetailPage from './UhsDetailPage';
import { AuthProvider } from '../../auth/AuthContext';
import { ladeEinsatz, ladeModulFreigaben } from '../../api/einsaetze';
import { freigabenFixture } from '../../test/fixtures';
import { ladeUhs } from '../../api/einsatzUhs';

// Auto-Mocks: bei ungültiger ID wird ohnehin vor jedem Laden auf die Liste umgeleitet.
vi.mock('../../api/einsaetze');
vi.mock('../../api/einsatzUhs');
// Kind-Komponenten gestubbt: geprüft wird die Seiten-Komposition, nicht Grundriss/Material/
// Bewegungen.
vi.mock('./Grundriss', () => ({ default: () => <div>GRUNDRISS</div> }));
vi.mock('./MaterialTab', () => ({ default: () => <div>MATERIAL-TAB</div> }));
vi.mock('./BewegungenTab', () => ({ default: () => <div>BEWEGUNGEN-TAB</div> }));
vi.mock('./UhsSwitcher', () => ({ default: () => <div>SWITCHER</div> }));
vi.mock('./UhsAnhaenge', () => ({
  default: (p: { darfSchreiben: boolean; zeigeZugriffe: boolean }) => (
    <div>
      DATEIEN-TAB schreiben={String(p.darfSchreiben)} zugriffe={String(p.zeigeZugriffe)}
    </div>
  ),
}));

/** Macht Pfad+Query im DOM sichtbar — `window.location` ist unter einem `MemoryRouter` falsch. */
function LocationProbe() {
  const loc = useLocation();
  return (
    <span data-testid="pfad">
      {loc.pathname}
      {loc.search}
    </span>
  );
}

function aktuellerPfad() {
  return screen.getByTestId('pfad').textContent;
}

function renderBei(route: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <AntApp>
        <AuthProvider>
          <MemoryRouter initialEntries={[route]}>
            <LocationProbe />
            <Routes>
              <Route
                path="/einsaetze/:id/unfallhilfsstellen/liste"
                element={<div>UHS-LISTE</div>}
              />
              <Route path="/einsaetze/:id/unfallhilfsstellen/:uhsId" element={<UhsDetailPage />} />
            </Routes>
          </MemoryRouter>
        </AuthProvider>
      </AntApp>
    </QueryClientProvider>,
  );
}

describe('UhsDetailPage — Deeplink-Robustheit (LFH-25)', () => {
  it('leitet bei ungültiger UHS-ID auf die Liste um', async () => {
    renderBei('/einsaetze/1/unfallhilfsstellen/abc');
    expect(await screen.findByText('UHS-LISTE')).toBeInTheDocument();
  });
});

describe('UhsDetailPage — Material/Bewegungen als Inline-Tabs (LFH-149)', () => {
  const einsatz = { id: 1, bezeichnung: 'Lage', status: 'aktiv', meine_rolle: 'einsatzleitung' };
  const uhs = {
    id: 9,
    einsatz_id: 1,
    bezeichnung: 'UHS Nord',
    typ: 'patientenablage',
    status: 'aktiv',
    standort: 'Halle 1',
    notiz: null,
  };

  it('zeigt Material/Bewegungen als Tabs (kein Drawer) und schaltet zwischen ihnen', async () => {
    vi.mocked(ladeEinsatz).mockResolvedValue(einsatz as Awaited<ReturnType<typeof ladeEinsatz>>);
    vi.mocked(ladeUhs).mockResolvedValue(uhs as Awaited<ReturnType<typeof ladeUhs>>);
    renderBei('/einsaetze/1/unfallhilfsstellen/9');

    // Grundriss bleibt Hauptinhalt; Material/Bewegungen sind Tabs (role=tab), keine Drawer-Buttons.
    expect(await screen.findByText('GRUNDRISS')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Material' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Bewegungen' })).toBeInTheDocument();
    // Default-Tab (Material) inline sichtbar — kein Drawer (sonst kein Tab-Panel).
    expect(screen.getByText('MATERIAL-TAB')).toBeInTheDocument();
    expect(screen.queryByText('BEWEGUNGEN-TAB')).not.toBeInTheDocument();
    // Tab-Wechsel zeigt die Bewegungen inline.
    await userEvent.click(screen.getByRole('tab', { name: 'Bewegungen' }));
    expect(await screen.findByText('BEWEGUNGEN-TAB')).toBeInTheDocument();
  });
});

describe('UhsDetailPage — Reiter „Dateien“ (LFH-758)', () => {
  const uhs = {
    id: 9,
    einsatz_id: 1,
    bezeichnung: 'BHP 50',
    typ: 'behandlungsplatz',
    status: 'aktiv',
    standort: 'Halle 1',
    notiz: null,
  };

  it.each([
    ['einsatzleitung', 'schreiben=true zugriffe=true'],
    ['fuehrungspersonal', 'schreiben=true zugriffe=false'],
    ['beobachter', 'schreiben=false zugriffe=false'],
  ])('%s: der dritte Reiter zeigt die Dateien (%s)', async (rolle, erwartet) => {
    vi.mocked(ladeEinsatz).mockResolvedValue({
      id: 1,
      bezeichnung: 'Lage',
      status: 'aktiv',
      meine_rolle: rolle,
    } as Awaited<ReturnType<typeof ladeEinsatz>>);
    vi.mocked(ladeUhs).mockResolvedValue(uhs as Awaited<ReturnType<typeof ladeUhs>>);
    renderBei('/einsaetze/1/unfallhilfsstellen/9');

    const leiste = await screen.findByRole('tablist', { name: 'Material, Bewegungen und Dateien' });
    expect(leiste).toBeInTheDocument();
    expect(screen.queryByText(/DATEIEN-TAB/)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('tab', { name: 'Dateien' }));
    expect(await screen.findByText(`DATEIEN-TAB ${erwartet}`)).toBeInTheDocument();
    expect(screen.getByRole('tabpanel', { name: 'Dateien' })).toBeInTheDocument();
  });
});

describe('UhsDetailPage — gemeinsamer Modul-Seitenkopf (LFH-341 · C6)', () => {
  // Schreibberechtigt (aktiv + Einsatzleitung) — sonst rendert kein Statuswechsel-Knopf, und die
  // Primäraktions-Zählung hätte keinen Fall.
  const einsatz = { id: 1, bezeichnung: 'Lage', status: 'aktiv', meine_rolle: 'einsatzleitung' };
  const uhsBasis = {
    id: 9,
    einsatz_id: 1,
    bezeichnung: 'UHS Nord',
    standort: 'Halle 1',
    notiz: null,
  };

  it('zeigt den UHS-Typ als Beschriftung, nicht als Wire-Wert', async () => {
    vi.mocked(ladeEinsatz).mockResolvedValue(einsatz as Awaited<ReturnType<typeof ladeEinsatz>>);
    vi.mocked(ladeUhs).mockResolvedValue({
      ...uhsBasis,
      typ: 'patientenablage',
      status: 'aktiv',
    } as Awaited<ReturnType<typeof ladeUhs>>);
    renderBei('/einsaetze/1/unfallhilfsstellen/9');

    expect(await screen.findByText(/Patientenablage/)).toBeInTheDocument();
    expect(screen.queryByText(/patientenablage/)).not.toBeInTheDocument();
  });

  it('trägt den Seitenkopf des Moduls, nicht einen eigenen', async () => {
    vi.mocked(ladeEinsatz).mockResolvedValue(einsatz as Awaited<ReturnType<typeof ladeEinsatz>>);
    vi.mocked(ladeUhs).mockResolvedValue({
      ...uhsBasis,
      typ: 'patientenablage',
      status: 'aktiv',
    } as Awaited<ReturnType<typeof ladeUhs>>);
    const { container } = renderBei('/einsaetze/1/unfallhilfsstellen/9');
    await screen.findByText('GRUNDRISS');

    // Der Aktionen-Slot ist die Zusicherung: an ihm hängt die Primäraktions-Zählung des Primitivs.
    expect(container.querySelector('[data-lfh="seitenkopf-aktionen"]')).not.toBeNull();
  });

  it('hält die Primäraktionen im Kopf je Zustand auf der gezählten Zahl', async () => {
    vi.mocked(ladeEinsatz).mockResolvedValue(einsatz as Awaited<ReturnType<typeof ladeEinsatz>>);

    for (const { status, primaer: erwartetePrimaeraktionen } of [
      { status: 'geplant', primaer: 1 },
      // „Patient aufnehmen" ist die Primäraktion einer aktiven UHS.
      { status: 'aktiv', primaer: 1 },
    ] as const) {
      vi.mocked(ladeUhs).mockResolvedValue({
        ...uhsBasis,
        typ: 'patientenablage',
        status,
      } as Awaited<ReturnType<typeof ladeUhs>>);
      const { container, unmount } = renderBei('/einsaetze/1/unfallhilfsstellen/9');
      await screen.findByText('GRUNDRISS');

      const slot = container.querySelector('[data-lfh="seitenkopf-aktionen"]')!;
      const primaer = Array.from(slot.querySelectorAll('button')).filter((knopf) =>
        Array.from(knopf.classList).some((klasse) => klasse.endsWith('-btn-primary')),
      );
      expect(primaer, `Status ${status}`).toHaveLength(erwartetePrimaeraktionen);
      unmount();
    }
  });
});

describe('UhsDetailPage — Patientenaufnahme ohne Modulwechsel (LFH-341 · H38)', () => {
  const einsatz = { id: 1, bezeichnung: 'Lage', status: 'aktiv', meine_rolle: 'einsatzleitung' };
  const uhsBasis = {
    id: 9,
    einsatz_id: 1,
    bezeichnung: 'UHS Nord',
    standort: 'Halle 1',
    notiz: null,
  };

  it('bietet „Patient aufnehmen" und schickt in die Aufnahme mit UHS-Auftrag', async () => {
    vi.mocked(ladeEinsatz).mockResolvedValue(einsatz as Awaited<ReturnType<typeof ladeEinsatz>>);
    vi.mocked(ladeUhs).mockResolvedValue({
      ...uhsBasis,
      id: 7,
      typ: 'patientenablage',
      status: 'aktiv',
    } as Awaited<ReturnType<typeof ladeUhs>>);
    renderBei('/einsaetze/1/unfallhilfsstellen/7');

    await userEvent.click(await screen.findByRole('button', { name: 'Patient aufnehmen' }));
    // Die Adresse ist die Zusicherung: am `uhs`-Auftrag erkennt die Aufnahmeseite den
    // Wartebereich-Eintritt.
    await waitFor(() => expect(aktuellerPfad()).toBe('/einsaetze/1/personen/aufnahme?uhs=7'));
  });

  it('gesperrte Personen: „Patient aufnehmen" steht gesperrt mit Grund (LFH-888)', async () => {
    vi.mocked(ladeEinsatz).mockResolvedValue(einsatz as Awaited<ReturnType<typeof ladeEinsatz>>);
    vi.mocked(ladeModulFreigaben).mockResolvedValue(
      freigabenFixture({ personen: { zugriff: false } }),
    );
    vi.mocked(ladeUhs).mockResolvedValue({
      ...uhsBasis,
      id: 7,
      typ: 'patientenablage',
      status: 'aktiv',
    } as Awaited<ReturnType<typeof ladeUhs>>);
    renderBei('/einsaetze/1/unfallhilfsstellen/7');

    const knopf = await screen.findByRole('button', { name: 'Patient aufnehmen' });
    await waitFor(() => expect(knopf).toBeDisabled());
    expect(knopf).toHaveAttribute('title', 'Keine Berechtigung');
    vi.mocked(ladeModulFreigaben).mockReset();
  });

  it('bietet die Aufnahme in einer geplanten UHS nicht an', async () => {
    // Eine geplante UHS nimmt niemanden auf, dort ist „In Betrieb nehmen" die Primäraktion — die
    // Gegenaussage zur Zählung.
    vi.mocked(ladeEinsatz).mockResolvedValue(einsatz as Awaited<ReturnType<typeof ladeEinsatz>>);
    vi.mocked(ladeUhs).mockResolvedValue({
      ...uhsBasis,
      id: 8,
      typ: 'patientenablage',
      status: 'geplant',
    } as Awaited<ReturnType<typeof ladeUhs>>);
    renderBei('/einsaetze/1/unfallhilfsstellen/8'); // Status geplant

    expect(await screen.findByRole('button', { name: 'In Betrieb nehmen' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Patient aufnehmen' })).not.toBeInTheDocument();
  });

  it('bietet die Aufnahme ohne Schreibrecht gar nicht erst an', async () => {
    // Der Weg endet in einem POST; ein 403 nach dem Ausfüllen wäre die späteste denkbare Absage.
    vi.mocked(ladeEinsatz).mockResolvedValue({ ...einsatz, meine_rolle: 'beobachter' } as Awaited<
      ReturnType<typeof ladeEinsatz>
    >);
    vi.mocked(ladeUhs).mockResolvedValue({
      ...uhsBasis,
      id: 7,
      typ: 'patientenablage',
      status: 'aktiv',
    } as Awaited<ReturnType<typeof ladeUhs>>);
    renderBei('/einsaetze/1/unfallhilfsstellen/7');

    // Seite ist da — Grundriss ist in dieser Datei gemockt (kein „Bett" im DOM).
    expect(await screen.findByText('GRUNDRISS')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Patient aufnehmen' })).not.toBeInTheDocument();
  });
});
