import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route, useLocation, useNavigate } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App as AntApp } from 'antd';
import UhsDetailPage from './UhsDetailPage';
import { AuthProvider } from '../../auth/AuthContext';
import { ladeEinsatz, ladeModulFreigaben } from '../../api/einsaetze';
import { freigabenFixture } from '../../test/fixtures';
import { ladeUhs, setzeUhsStatus, storniereUhs } from '../../api/einsatzUhs';
import { listePersonen } from '../../api/einsatzPerson';
import type { Person } from '../../api/types';
import { ApiError } from '../../api/client';

// Auto-Mocks: bei ungültiger ID wird ohnehin vor jedem Laden auf die Liste umgeleitet.
vi.mock('../../api/einsaetze');
vi.mock('../../api/einsatzUhs');
// Belegung der UHS für die Sperre von „Auflösen“; ohne Vorgabe ist niemand belegt.
vi.mock('../../api/einsatzPerson', () => ({ listePersonen: vi.fn(async () => []) }));
// Kind-Komponenten gestubbt: geprüft wird die Seiten-Komposition, nicht Grundriss/Material/
// Bewegungen.
// Die Instanz zählt mit: ein Wechsel der UHS baut den Grundriss neu (Gründe der vorigen weg).
vi.mock('./Grundriss', async () => {
  const { useState } = await import('react');
  let instanzen = 0;
  return {
    default: function GrundrissAttrappe() {
      const [instanz] = useState(() => ++instanzen);
      return (
        <div data-testid="grundriss" data-instanz={instanz}>
          GRUNDRISS
        </div>
      );
    },
  };
});
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

    const leiste = await screen.findByRole('tablist', {
      name: 'Material, Kräfte, Bewegungen und Dateien',
    });
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

  it('fragt vor dem Auflösen ohne Kürzel nach (LFH-948)', async () => {
    vi.mocked(ladeEinsatz).mockResolvedValue(einsatz as Awaited<ReturnType<typeof ladeEinsatz>>);
    vi.mocked(ladeUhs).mockResolvedValue({
      ...uhsBasis,
      typ: 'patientenablage',
      status: 'aktiv',
    } as Awaited<ReturnType<typeof ladeUhs>>);
    renderBei('/einsaetze/1/unfallhilfsstellen/9');

    await userEvent.click(await screen.findByRole('button', { name: 'Auflösen' }));
    expect(await screen.findByText('Unfallhilfsstelle auflösen?')).toBeInTheDocument();
    expect(screen.queryByText('UHS auflösen?')).not.toBeInTheDocument();
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

    // Der Grund steht sichtbar im Knopf, nicht nur im `title` (der auf Touch nie erscheint).
    const knopf = await screen.findByRole('button', {
      name: 'Patient aufnehmen (Keine Berechtigung)',
    });
    expect(knopf).toBeDisabled();
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

describe('UhsDetailPage — „Auflösen“ gesperrt, solange belegt (LFH-1078)', () => {
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

  it('nennt die Zahl der Belegten sichtbar im gesperrten Knopf', async () => {
    vi.mocked(ladeEinsatz).mockResolvedValue(einsatz as Awaited<ReturnType<typeof ladeEinsatz>>);
    vi.mocked(ladeUhs).mockResolvedValue(uhs as Awaited<ReturnType<typeof ladeUhs>>);
    vi.mocked(listePersonen).mockResolvedValueOnce([
      { id: 1, aktuelle_uhs_id: 9, storniert_at: null },
      { id: 2, aktuelle_uhs_id: 9, storniert_at: null },
      // Andere UHS und stornierte Personen zählen nicht.
      { id: 3, aktuelle_uhs_id: 4, storniert_at: null },
      { id: 4, aktuelle_uhs_id: 9, storniert_at: '2026-10-07 10:00:00' },
    ] as unknown as Person[]);
    renderBei('/einsaetze/1/unfallhilfsstellen/9');

    const knopf = await screen.findByRole('button', { name: 'Auflösen (noch 2 Personen)' });
    expect(knopf).toBeDisabled();
    expect(screen.queryByText(/Nur möglich, wenn/)).not.toBeInTheDocument();
  });

  it('ohne Belegte ist „Auflösen“ bedienbar', async () => {
    vi.mocked(ladeEinsatz).mockResolvedValue(einsatz as Awaited<ReturnType<typeof ladeEinsatz>>);
    vi.mocked(ladeUhs).mockResolvedValue(uhs as Awaited<ReturnType<typeof ladeUhs>>);
    renderBei('/einsaetze/1/unfallhilfsstellen/9');

    expect(await screen.findByRole('button', { name: 'Auflösen' })).toBeEnabled();
  });
});

describe('UhsDetailPage — Rückfragen nennen die Handlung (LFH-960)', () => {
  const einsatz = { id: 1, bezeichnung: 'Lage', status: 'aktiv', meine_rolle: 'einsatzleitung' };
  const uhsBasis = {
    id: 9,
    einsatz_id: 1,
    bezeichnung: 'UHS Nord',
    typ: 'patientenablage',
    standort: 'Halle 1',
    notiz: null,
  };

  it('aktiv: „Unfallhilfsstelle auflösen“ bestätigt rot und löst erst dann auf', async () => {
    vi.mocked(ladeEinsatz).mockResolvedValue(einsatz as Awaited<ReturnType<typeof ladeEinsatz>>);
    vi.mocked(ladeUhs).mockResolvedValue({ ...uhsBasis, status: 'aktiv' } as Awaited<
      ReturnType<typeof ladeUhs>
    >);
    vi.mocked(setzeUhsStatus).mockClear();
    renderBei('/einsaetze/1/unfallhilfsstellen/9');

    await userEvent.click(await screen.findByRole('button', { name: 'Auflösen' }));
    const ok = await screen.findByRole('button', { name: 'Unfallhilfsstelle auflösen' });
    expect(ok).toHaveClass('ant-btn-dangerous');
    expect(screen.queryByRole('button', { name: 'OK' })).not.toBeInTheDocument();
    expect(setzeUhsStatus).not.toHaveBeenCalled();
    await userEvent.click(ok);
    await waitFor(() => expect(setzeUhsStatus).toHaveBeenCalledWith(1, 9, 'aufgeloest'));
  });

  it('geplant: „Unfallhilfsstelle stornieren“ bestätigt rot und storniert erst dann', async () => {
    vi.mocked(ladeEinsatz).mockResolvedValue(einsatz as Awaited<ReturnType<typeof ladeEinsatz>>);
    vi.mocked(ladeUhs).mockResolvedValue({ ...uhsBasis, status: 'geplant' } as Awaited<
      ReturnType<typeof ladeUhs>
    >);
    vi.mocked(storniereUhs).mockClear();
    renderBei('/einsaetze/1/unfallhilfsstellen/9');

    await userEvent.click(await screen.findByRole('button', { name: 'Stornieren' }));
    expect(await screen.findByText('Unfallhilfsstelle stornieren?')).toBeInTheDocument();
    const ok = screen.getByRole('button', { name: 'Unfallhilfsstelle stornieren' });
    expect(ok).toHaveClass('ant-btn-dangerous');
    expect(screen.queryByRole('button', { name: 'OK' })).not.toBeInTheDocument();
    expect(storniereUhs).not.toHaveBeenCalled();
    await userEvent.click(ok);
    await waitFor(() => expect(storniereUhs).toHaveBeenCalledWith(1, 9));
  });
});

describe('UhsDetailPage — Ablehnung im Seitenhinweis (LFH-1077)', () => {
  const einsatz = { id: 1, bezeichnung: 'Lage', status: 'aktiv', meine_rolle: 'einsatzleitung' };
  const uhsBasis = {
    id: 9,
    einsatz_id: 1,
    bezeichnung: 'UHS Nord',
    typ: 'patientenablage',
    standort: 'Halle 1',
    notiz: null,
  };
  /** Der Hinweis-Slot des Seitenkopfs. */
  const hinweis = () => document.querySelector<HTMLElement>('[data-lfh="seiten-beschreibung"]');

  function geplant() {
    vi.mocked(ladeEinsatz).mockResolvedValue(einsatz as Awaited<ReturnType<typeof ladeEinsatz>>);
    vi.mocked(ladeUhs).mockResolvedValue({ ...uhsBasis, status: 'geplant' } as Awaited<
      ReturnType<typeof ladeUhs>
    >);
  }

  it('Status: der Grund steht im Seitenhinweis, kein Toast', async () => {
    geplant();
    vi.mocked(setzeUhsStatus).mockReset();
    vi.mocked(setzeUhsStatus).mockRejectedValueOnce(new ApiError(409, 'Keine Plätze angelegt'));
    renderBei('/einsaetze/1/unfallhilfsstellen/9');

    await userEvent.click(await screen.findByRole('button', { name: 'In Betrieb nehmen' }));

    const grund = await within(hinweis()!).findByRole('alert');
    expect(grund).toHaveTextContent('Keine Plätze angelegt');
    expect(grund).toHaveTextContent('Status nicht geändert');
    expect(document.querySelectorAll('.ant-message-notice')).toHaveLength(0);
  });

  it('Status: das nächste Absenden räumt den Grund, solange die Antwort aussteht', async () => {
    geplant();
    vi.mocked(setzeUhsStatus).mockReset();
    vi.mocked(setzeUhsStatus)
      .mockRejectedValueOnce(new ApiError(409, 'Keine Plätze angelegt'))
      .mockImplementationOnce(() => new Promise(() => {}));
    renderBei('/einsaetze/1/unfallhilfsstellen/9');

    await userEvent.click(await screen.findByRole('button', { name: 'In Betrieb nehmen' }));
    await within(hinweis()!).findByRole('alert');
    await userEvent.click(screen.getByRole('button', { name: 'In Betrieb nehmen' }));

    await waitFor(() => expect(hinweis()).toBeNull());
  });

  it('Storno: der Grund steht im Seitenhinweis, „In Betrieb nehmen“ räumt ihn', async () => {
    geplant();
    vi.mocked(storniereUhs).mockReset();
    vi.mocked(storniereUhs).mockRejectedValueOnce(new ApiError(409, 'UHS hat Belegungen'));
    vi.mocked(setzeUhsStatus).mockReset();
    vi.mocked(setzeUhsStatus).mockImplementationOnce(() => new Promise(() => {}));
    renderBei('/einsaetze/1/unfallhilfsstellen/9');

    await userEvent.click(await screen.findByRole('button', { name: 'Stornieren' }));
    await userEvent.click(
      await screen.findByRole('button', { name: 'Unfallhilfsstelle stornieren' }),
    );

    const grund = await within(hinweis()!).findByRole('alert');
    expect(grund).toHaveTextContent('UHS hat Belegungen');
    expect(grund).toHaveTextContent('Nicht storniert');
    expect(document.querySelectorAll('.ant-message-notice')).toHaveLength(0);

    // Derselbe Slot, die zuletzt begonnene Handlung zählt.
    await userEvent.click(screen.getByRole('button', { name: 'In Betrieb nehmen' }));
    await waitFor(() => expect(hinweis()).toBeNull());
  });

  it('Wechsel zu einer anderen UHS: der Grund der vorigen bleibt nicht stehen', async () => {
    /** Die Route hat keinen `key`: dieselbe Seite zeigt nach dem Wechsel die nächste UHS. */
    function Wechsel() {
      const navigate = useNavigate();
      return (
        <>
          <button type="button" onClick={() => void navigate('/einsaetze/1/unfallhilfsstellen/8')}>
            Zur zweiten UHS
          </button>
          <button type="button" onClick={() => void navigate('/einsaetze/1/unfallhilfsstellen/9')}>
            Zur ersten UHS
          </button>
        </>
      );
    }
    geplant();
    vi.mocked(ladeUhs).mockImplementation(
      async (_einsatz, id) =>
        ({ ...uhsBasis, id, status: 'geplant' }) as Awaited<ReturnType<typeof ladeUhs>>,
    );
    vi.mocked(setzeUhsStatus).mockReset();
    vi.mocked(setzeUhsStatus).mockRejectedValueOnce(new ApiError(409, 'Keine Plätze angelegt'));
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <AntApp>
          <AuthProvider>
            <MemoryRouter initialEntries={['/einsaetze/1/unfallhilfsstellen/9']}>
              <Wechsel />
              <Routes>
                <Route
                  path="/einsaetze/:id/unfallhilfsstellen/:uhsId"
                  element={<UhsDetailPage />}
                />
              </Routes>
            </MemoryRouter>
          </AuthProvider>
        </AntApp>
      </QueryClientProvider>,
    );
    await userEvent.click(await screen.findByRole('button', { name: 'In Betrieb nehmen' }));
    await within(hinweis()!).findByRole('alert');

    await userEvent.click(screen.getByRole('button', { name: 'Zur zweiten UHS' }));
    await waitFor(() => expect(vi.mocked(ladeUhs)).toHaveBeenCalledWith(1, 8));
    await screen.findByRole('button', { name: 'In Betrieb nehmen' });
    expect(hinweis()).toBeNull();

    // Zurück zur ersten, deren Daten im Cache liegen: kein Ladezustand dazwischen. Der Grundriss
    // (und die Reiter) tragen die UHS als `key` und werden trotzdem neu gebaut; ihre Gründe gehen.
    const vorher = screen.getByTestId('grundriss').dataset.instanz;
    await userEvent.click(screen.getByRole('button', { name: 'Zur ersten UHS' }));
    await waitFor(() => expect(screen.getByTestId('grundriss').dataset.instanz).not.toBe(vorher));
  });
});
