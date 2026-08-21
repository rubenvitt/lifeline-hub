import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App as AntApp } from 'antd';
import UhsDetailPage from './UhsDetailPage';
import { AuthProvider } from '../../auth/AuthContext';
import { ladeEinsatz } from '../../api/einsaetze';
import { ladeUhs } from '../../api/einsatzUhs';

// Auto-Mocks: für den Robustheits-Guard reicht no-op-API — bei ungültiger ID wird ohnehin
// vor jedem Laden auf die Liste umgeleitet.
vi.mock('../../api/einsaetze');
vi.mock('../../api/einsatzUhs');
// Kind-Komponenten stubben: LFH-149 testet die Seiten-Komposition (Tabs statt Drawer),
// nicht die Datenflüsse von Grundriss/Material/Bewegungen.
vi.mock('./Grundriss', () => ({ default: () => <div>GRUNDRISS</div> }));
vi.mock('./MaterialTab', () => ({ default: () => <div>MATERIAL-TAB</div> }));
vi.mock('./BewegungenTab', () => ({ default: () => <div>BEWEGUNGEN-TAB</div> }));
vi.mock('./UhsSwitcher', () => ({ default: () => <div>SWITCHER</div> }));

/** Macht den aktuellen Pfad+Query im DOM sichtbar (Muster aus `AuftraegePage.test.tsx`s
 *  `LocationProbe`) — `window.location` ist unter einem `MemoryRouter` falsch. */
function LocationProbe() {
  const loc = useLocation();
  return <span data-testid="pfad">{loc.pathname}{loc.search}</span>;
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
              <Route path="/einsaetze/:id/unfallhilfsstellen/liste" element={<div>UHS-LISTE</div>} />
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
  // `typ` war hier `'sammelplatz'` — kein gültiger `UhsTyp` (patientenablage/behandlungsplatz/
  // verletztensammelstelle/sonstige). Solange die Meta-Zeile den Wert roh ausgab, fiel das
  // nicht auf; seit dem Umzug auf `uhsTyp[uhs.typ].label` (LFH-341 · C6) wäre das ein
  // `undefined.label`-Absturz. Korrigiert auf einen echten Typ.
  const uhs = { id: 9, einsatz_id: 1, bezeichnung: 'UHS Nord', typ: 'patientenablage', status: 'aktiv', standort: 'Halle 1', notiz: null };

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

describe('UhsDetailPage — gemeinsamer Modul-Seitenkopf (LFH-341 · C6)', () => {
  // Schreibberechtigt (aktiv + Einsatzleitung) — sonst rendert keiner der Statuswechsel-Knöpfe,
  // und die Primäraktions-Zählung im Kopf hätte keinen Fall, den sie prüfen könnte.
  const einsatz = { id: 1, bezeichnung: 'Lage', status: 'aktiv', meine_rolle: 'einsatzleitung' };
  const uhsBasis = { id: 9, einsatz_id: 1, bezeichnung: 'UHS Nord', standort: 'Halle 1', notiz: null };

  it('zeigt den UHS-Typ als Beschriftung, nicht als Wire-Wert', async () => {
    vi.mocked(ladeEinsatz).mockResolvedValue(einsatz as Awaited<ReturnType<typeof ladeEinsatz>>);
    vi.mocked(ladeUhs).mockResolvedValue(
      { ...uhsBasis, typ: 'patientenablage', status: 'aktiv' } as Awaited<ReturnType<typeof ladeUhs>>,
    );
    renderBei('/einsaetze/1/unfallhilfsstellen/9');

    expect(await screen.findByText(/Patientenablage/)).toBeInTheDocument();
    expect(screen.queryByText(/patientenablage/)).not.toBeInTheDocument();
  });

  it('trägt den Seitenkopf des Moduls, nicht einen eigenen', async () => {
    vi.mocked(ladeEinsatz).mockResolvedValue(einsatz as Awaited<ReturnType<typeof ladeEinsatz>>);
    vi.mocked(ladeUhs).mockResolvedValue(
      { ...uhsBasis, typ: 'patientenablage', status: 'aktiv' } as Awaited<ReturnType<typeof ladeUhs>>,
    );
    const { container } = renderBei('/einsaetze/1/unfallhilfsstellen/9');
    await screen.findByText('GRUNDRISS');

    // `EinsatzSeite` trägt keine eigene Wurzel-Marke (nur den Aktionen-Slot). Der Slot IST die
    // Zusicherung: an ihm hängt die Primäraktions-Zählung des Primitivs — ohne ihn wäre „wie
    // viele Primäraktionen stehen im Kopf" eine Handzählung. `container` ist deshalb der
    // ehrlichere Anker als ein erfundenes `data-testid="uhs-detail-seite"`.
    expect(container.querySelector('[data-lfh="seitenkopf-aktionen"]')).not.toBeNull();
  });

  it('hält die Primäraktionen im Kopf je Zustand auf der gezählten Zahl', async () => {
    vi.mocked(ladeEinsatz).mockResolvedValue(einsatz as Awaited<ReturnType<typeof ladeEinsatz>>);

    for (const { status, primaer: erwartetePrimaeraktionen } of [
      { status: 'geplant', primaer: 1 },
      // War NULL (der Befund H38 selbst: eine UHS im Betrieb bot im Kopf keine Aufnahme an,
      // jeder Patient kostete einen Modulwechsel). LFH-341/C6 zieht sie auf 1 — „Patient
      // aufnehmen" ist ab jetzt die Primäraktion einer aktiven UHS, siehe die Tests unten.
      { status: 'aktiv', primaer: 1 },
    ] as const) {
      vi.mocked(ladeUhs).mockResolvedValue(
        { ...uhsBasis, typ: 'patientenablage', status } as Awaited<ReturnType<typeof ladeUhs>>,
      );
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
  const uhsBasis = { id: 9, einsatz_id: 1, bezeichnung: 'UHS Nord', standort: 'Halle 1', notiz: null };

  it('bietet „Patient aufnehmen" und schickt in die Aufnahme mit UHS-Auftrag', async () => {
    vi.mocked(ladeEinsatz).mockResolvedValue(einsatz as Awaited<ReturnType<typeof ladeEinsatz>>);
    vi.mocked(ladeUhs).mockResolvedValue(
      { ...uhsBasis, id: 7, typ: 'patientenablage', status: 'aktiv' } as Awaited<ReturnType<typeof ladeUhs>>,
    );
    renderBei('/einsaetze/1/unfallhilfsstellen/7');

    await userEvent.click(await screen.findByRole('button', { name: 'Patient aufnehmen' }));
    // Die ADRESSE ist die Zusicherung, nicht der Klick: der `uhs`-Auftrag ist das,
    // woran die Aufnahmeseite den Wartebereich-Eintritt erkennt.
    await waitFor(() => expect(aktuellerPfad()).toBe('/einsaetze/1/personen/aufnahme?uhs=7'));
  });

  it('bietet die Aufnahme in einer geplanten UHS nicht an', async () => {
    // Eine geplante UHS nimmt niemanden auf — dort ist „In Betrieb nehmen" die
    // Primäraktion. Ohne diese Gegenaussage wäre „genau eine Primäraktion" in Task 2
    // eine Zählung ohne Fall, der sie verletzen könnte.
    vi.mocked(ladeEinsatz).mockResolvedValue(einsatz as Awaited<ReturnType<typeof ladeEinsatz>>);
    vi.mocked(ladeUhs).mockResolvedValue(
      { ...uhsBasis, id: 8, typ: 'patientenablage', status: 'geplant' } as Awaited<ReturnType<typeof ladeUhs>>,
    );
    renderBei('/einsaetze/1/unfallhilfsstellen/8'); // Status geplant

    expect(await screen.findByRole('button', { name: 'In Betrieb nehmen' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Patient aufnehmen' })).not.toBeInTheDocument();
  });

  it('bietet die Aufnahme ohne Schreibrecht gar nicht erst an', async () => {
    // Der Weg endet in einem POST; ein 403 nach dem Ausfüllen der Maske wäre die
    // spaeteste denkbare Absage.
    vi.mocked(ladeEinsatz).mockResolvedValue(
      { ...einsatz, meine_rolle: 'beobachter' } as Awaited<ReturnType<typeof ladeEinsatz>>,
    );
    vi.mocked(ladeUhs).mockResolvedValue(
      { ...uhsBasis, id: 7, typ: 'patientenablage', status: 'aktiv' } as Awaited<ReturnType<typeof ladeUhs>>,
    );
    renderBei('/einsaetze/1/unfallhilfsstellen/7');

    // Seite ist da — Grundriss ist in dieser Datei gemockt (kein „Bett" im DOM).
    expect(await screen.findByText('GRUNDRISS')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Patient aufnehmen' })).not.toBeInTheDocument();
  });
});
