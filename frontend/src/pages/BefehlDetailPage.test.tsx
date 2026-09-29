import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App as AntApp } from 'antd';
import BefehlDetailPage from './BefehlDetailPage';
import { AuthProvider } from '../auth/AuthContext';
import * as befehleApi from '../api/befehle';
import * as einsaetzeApi from '../api/einsaetze';
import { EinsatzAnzeigeProvider } from '../anzeige/AnzeigeKonventionenContext';
import { einsatzKeys } from '../api/queryKeys';
import { setzeViewportBreite } from '../test/viewport';
import { ApiError } from '../api/client';
import { http, HttpResponse } from 'msw';
import { server } from '../test/server';

vi.mock('../api/befehle');
vi.mock('../api/einsaetze');

const einsatz = { id: 1, bezeichnung: 'Übung', status: 'aktiv', meine_rolle: 'einsatzleitung' };

function renderAt(bid: number | string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createMemoryRouter(
    [
      { path: '/einsaetze', element: <div>EINSATZ-LISTE</div> },
      { path: '/einsaetze/:id/auftraege', element: <div>AUFTRAEGE-LISTE</div> },
      { path: '/einsaetze/:id/auftraege/befehle/:befehlId', element: <BefehlDetailPage /> },
    ],
    { initialEntries: ['/einsaetze/1/auftraege', `/einsaetze/1/auftraege/befehle/${bid}`] },
  );
  const ergebnis = render(
    <QueryClientProvider client={qc}>
      <AntApp>
        <AuthProvider>
          <RouterProvider router={router} />
        </AuthProvider>
      </AntApp>
    </QueryClientProvider>,
  );
  return {
    ...ergebnis,
    router,
    /**
     * Stellt den Serverstand um und löst denselben Weg aus wie der SSE-Listener: Invalidierung →
     * Refetch → neues `befehlQuery.data`. Ein `vi.fn()`-Ersatz oder bloßes `rerender` träfe den
     * Fall nicht — er entsteht, wenn ein frischer Datensatz eine Runde später eintrifft, während
     * getippt wurde.
     */
    rerenderMitBefehl: async (neu: object) => {
      const vorher = vi.mocked(befehleApi.ladeBefehl).mock.calls.length;
      vi.mocked(befehleApi.ladeBefehl).mockResolvedValue(neu as never);
      await act(async () => {
        await qc.invalidateQueries();
      });
      /*
       * Auf den abgeschlossenen Refetch warten, nicht bloß auf das Invalidieren; sonst bestünde ein
       * folgendes `waitFor(… 'Meine Fassung')` beim ersten Versuch, auch wenn der Refetch das Feld
       * gleich darauf überschriebe.
       */
      await waitFor(() =>
        expect(vi.mocked(befehleApi.ladeBefehl).mock.calls.length).toBeGreaterThan(vorher),
      );
    },
  };
}

beforeEach(() => {
  vi.mocked(einsaetzeApi.ladeEinsatz).mockResolvedValue(einsatz as never);
});

function befehl(status: 'entwurf' | 'freigegeben') {
  return {
    id: 7,
    einsatz_id: 1,
    vorlage: 'befehl_ladef',
    titel: 'Befehl 1',
    zeitstand: '2026-06-02 10:00:00',
    status,
    abschnitte: [],
    version: 1,
    vorgaenger_id: null,
    ersteller_id: 1,
    ersteller_name: 'EL',
    erstellt_at: '',
    aktualisiert_at: '',
    freigegeben_von_id: null,
    freigegeben_von_name: null,
    freigegeben_at: null,
    etb_eintrag_id: status === 'freigegeben' ? 5 : null,
  };
}

/**
 * ── Einstiegsfokus (LFH-495) ──
 *
 * Mechanik und Begründungen stehen in `entwurf/Einstiegsfokus.tsx`. Hier steht, dass die Seite das
 * Ziel aus dem Serverstand ableitet, nicht aus den Formularwerten — die sind beim Mount noch leer,
 * eine Ableitung daraus träfe immer den ersten Abschnitt.
 *
 * Anders als im Lagebericht gibt es kein Akkordeon: alle fünf Editoren stehen gestapelt, der Fokus
 * scrollt bis zu seinem Ziel (die verankerte Aktionsleiste hält es über `scroll-padding-block-end`
 * frei).
 */
describe('BefehlDetailPage — Einstiegsfokus (LFH-495)', () => {
  it('fokussiert den ersten LEEREN Abschnitt des Serverstands', async () => {
    vi.mocked(befehleApi.ladeBefehl).mockResolvedValue({
      ...befehl('entwurf'),
      abschnitte: [
        { schluessel: 'lage', text: 'Allgemeine Lage steht' },
        { schluessel: 'auftrag', text: 'Auftrag steht' },
        { schluessel: 'durchfuehrung', text: '' },
      ],
    } as never);
    renderAt(7);
    expect(await screen.findByLabelText('Durchführung')).toHaveFocus();
  });

  it('fokussiert am leeren Befehl den ersten Abschnitt (Gegenaussage)', async () => {
    vi.mocked(befehleApi.ladeBefehl).mockResolvedValue(befehl('entwurf') as never);
    renderAt(7);
    expect(await screen.findByLabelText('Lage')).toHaveFocus();
  });

  it('fokussiert im FREIGEGEBENEN Befehl nichts — es gibt kein Formular', async () => {
    vi.mocked(befehleApi.ladeBefehl).mockResolvedValue(befehl('freigegeben') as never);
    renderAt(7);
    await screen.findByRole('heading', { name: 'Befehl 1' });
    expect(document.body).toHaveFocus();
  });
});

describe('BefehlDetailPage', () => {
  it('zeigt im Entwurf editierbare Felder mit Hilfetext', async () => {
    vi.mocked(befehleApi.ladeBefehl).mockResolvedValue(befehl('entwurf') as never);
    renderAt(7);
    expect(await screen.findByText('Einsatzunterstützung')).toBeInTheDocument();
    expect(screen.getByText(/a\. Allgemeine Lage/)).toBeInTheDocument();
  });

  // Die Überschriftenebene nennt der Einbauort: lesend unter dem Abschnittskopf (h3) → `#` wird h4;
  // im Entwurf unter dem Paneel „Entwurf" (h2) → h3.
  it('setzt eine Markdown-Überschrift lesend unter den Abschnittskopf (h4)', async () => {
    vi.mocked(befehleApi.ladeBefehl).mockResolvedValue({
      ...befehl('freigegeben'),
      abschnitte: [{ schluessel: 'lage', text: '# Kopfzeile' }],
    } as never);
    renderAt(7);
    expect(await screen.findByRole('heading', { name: 'Kopfzeile' })).toHaveProperty(
      'tagName',
      'H4',
    );
  });

  it('setzt eine Markdown-Überschrift im Entwurf unter das Paneel (h3)', async () => {
    vi.mocked(befehleApi.ladeBefehl).mockResolvedValue({
      ...befehl('entwurf'),
      abschnitte: [{ schluessel: 'lage', text: '# Kopfzeile' }],
    } as never);
    renderAt(7);
    expect(await screen.findByRole('heading', { name: 'Kopfzeile' })).toHaveProperty(
      'tagName',
      'H3',
    );
  });

  it('zeigt freigegeben read-only mit Fortschreiben', async () => {
    vi.mocked(befehleApi.ladeBefehl).mockResolvedValue(befehl('freigegeben') as never);
    renderAt(7);
    expect(await screen.findByRole('button', { name: 'Fortschreiben' })).toBeInTheDocument();
  });

  it('leitet bei ungültiger Befehl-ID auf die Auftrags-Liste um (LFH-25)', async () => {
    renderAt('abc');
    expect(await screen.findByText('AUFTRAEGE-LISTE')).toBeInTheDocument();
  });

  it('verlinkt vom freigegebenen Befehl per ?eintrag= auf den ETB-Eintrag (LFH-25)', async () => {
    vi.mocked(befehleApi.ladeBefehl).mockResolvedValue(befehl('freigegeben') as never);
    renderAt(7);
    const link = await screen.findByRole('link', { name: /ETB-Eintrag/ });
    expect(link).toHaveAttribute('href', '/einsaetze/1/etb?eintrag=5');
  });

  /**
   * Der Kopf trägt die Phasenfarbe der gemeinsamen Achse, nicht das Preset-Grün. Dass der Wortlaut
   * gelesen statt abgeschrieben wird, pinnt `kommunikation/kopfStatus.guard.test.ts`.
   *
   * Der Entwurfs-Zustand ist bewusst nicht die Probe: `PHASE_META.offen.color` ist `'default'` und
   * damit gleich dem abgelösten Preset.
   */
  it('malt den freigegebenen Status in der Phasenfarbe, nicht im Preset-Grün', async () => {
    vi.mocked(befehleApi.ladeBefehl).mockResolvedValue(befehl('freigegeben') as never);
    renderAt(7);
    // Die Phase trägt eine getönte Statusfläche (`StatusChip`); die Farbe kommt aus der Phasenachse
    // (`abgeschlossen` → Ton `normal`), nicht aus einem handgeschriebenen Grün.
    const etikett = (await screen.findByText('Freigegeben')).closest('[data-lfh="status-chip"]');
    expect(etikett).toHaveAttribute('data-ton', 'normal');
    expect(etikett!.closest('[data-phase]')).toHaveAttribute('data-phase', 'abgeschlossen');
    expect(etikett!.closest('.ant-tag')).toBeNull();
  });
});

/**
 * Verlustschutz am Befehlsentwurf (LFH-342): Autosave, Verlassen-Schutz, und der SSE-Refetch
 * überschreibt nicht, was gerade getippt wird.
 */
describe('BefehlDetailPage — Verlustschutz (LFH-342 · C7, Befund N18)', () => {
  beforeEach(() => {
    // `mockClear` ist nötig: die Suite läuft ohne `clearMocks`, und die Aufrufzählungen dieses
    // Blocks sind die Zusicherung.
    vi.mocked(befehleApi.aktualisiereBefehl).mockClear();
    vi.mocked(befehleApi.aktualisiereBefehl).mockResolvedValue(befehl('entwurf') as never);
  });

  it('überschreibt ein berührtes Feld NICHT mit dem nachgelieferten Serverstand', async () => {
    vi.mocked(befehleApi.ladeBefehl).mockResolvedValue(befehl('entwurf') as never);
    const { rerenderMitBefehl } = renderAt(7);
    const titel = await screen.findByLabelText('Titel');
    await userEvent.clear(titel);
    await userEvent.type(titel, 'Meine Fassung');

    // Der Server liefert eine fremde Fassung nach (SSE-Invalidierung → Refetch).
    await rerenderMitBefehl({ ...befehl('entwurf'), titel: 'Fremde Fassung' });

    /*
     * Zuerst warten, bis der neue Stand angekommen ist — die Überschrift kommt aus
     * `befehlQuery.data`, nicht aus dem Formular, und ist der unabhängige Zeuge. Ohne diesen
     * Schritt bestünde die Zusicherung darunter auch ohne Riegel.
     */
    await screen.findByRole('heading', { name: 'Fremde Fassung' });
    expect(screen.getByLabelText('Titel')).toHaveValue('Meine Fassung');
  });

  it('übernimmt den Serverstand weiterhin, solange nichts berührt wurde', async () => {
    // Die Gegenaussage ist die eigentliche Prüfung: ein Riegel, der immer blockiert, machte die
    // Seite still veraltet.
    vi.mocked(befehleApi.ladeBefehl).mockResolvedValue(befehl('entwurf') as never);
    const { rerenderMitBefehl } = renderAt(7);
    await screen.findByLabelText('Titel');

    await rerenderMitBefehl({ ...befehl('entwurf'), titel: 'Neu vom Server' });

    await screen.findByRole('heading', { name: 'Neu vom Server' });
    expect(screen.getByLabelText('Titel')).toHaveValue('Neu vom Server');
  });

  it('speichert eine berührte Fassung nach der Autosave-Frist von selbst', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      vi.mocked(befehleApi.ladeBefehl).mockResolvedValue(befehl('entwurf') as never);
      const nutzer = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      renderAt(7);
      const titel = await screen.findByLabelText('Titel');
      await nutzer.type(titel, 'x');
      expect(befehleApi.aktualisiereBefehl).not.toHaveBeenCalled();

      await act(async () => {
        vi.advanceTimersByTime(31_000);
      });
      await waitFor(() => expect(befehleApi.aktualisiereBefehl).toHaveBeenCalled());
      // Der Zeitstempel sagt es sichtbar — ein unsichtbarer Autosave ist von „nicht gespeichert"
      // nicht zu unterscheiden.
      expect(await screen.findByText(/zuletzt gespeichert \d{2}:\d{2}/)).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('speichert nichts, solange nichts berührt wurde', () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      vi.mocked(befehleApi.ladeBefehl).mockResolvedValue(befehl('entwurf') as never);
      renderAt(7);
      act(() => {
        vi.advanceTimersByTime(120_000);
      });
      // Ein Autosave ohne Änderung erzeugte alle 30 s ein PATCH samt Invalidierung und
      // Live-Ereignis.
      expect(befehleApi.aktualisiereBefehl).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('speichert beim Verlassen eines Feldes, ohne auf die Frist zu warten', async () => {
    vi.mocked(befehleApi.ladeBefehl).mockResolvedValue(befehl('entwurf') as never);
    renderAt(7);
    const titel = await screen.findByLabelText('Titel');
    await userEvent.type(titel, 'x');
    // Ein verlassenes Feld ist der Moment, in dem ein Abschnitt fertig gedacht ist — und der Griff,
    // der einem In-App-Seitenwechsel vorausgeht: der Klick auf die Brotkrume blurrt das Feld
    // zuerst.
    await userEvent.tab();
    await waitFor(() => expect(befehleApi.aktualisiereBefehl).toHaveBeenCalled());
  });

  it('warnt beim Reload, solange eine Fassung ungespeichert ist', async () => {
    vi.mocked(befehleApi.ladeBefehl).mockResolvedValue(befehl('entwurf') as never);
    renderAt(7);
    const titel = await screen.findByLabelText('Titel');
    await userEvent.type(titel, 'noch nicht gespeichert');

    const ereignis = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(ereignis);
    expect(ereignis.defaultPrevented).toBe(true);
  });

  it('warnt NICHT, wenn nichts offen ist', async () => {
    // Gegenaussage: ein Warner, der immer hängt, macht jeden Reload zur Rückfrage und wird
    // ungelesen weggeklickt.
    vi.mocked(befehleApi.ladeBefehl).mockResolvedValue(befehl('entwurf') as never);
    renderAt(7);
    await screen.findByLabelText('Titel');

    const ereignis = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(ereignis);
    expect(ereignis.defaultPrevented).toBe(false);
  });
});

/**
 * ── Zeitstand in der Anzeigezone (LFH-350) ──
 *
 * `zeitstand` ist ein UTC-Wirestring ohne Zonenkennung. Die Zone wird ausdrücklich gestellt und der
 * Cache vorbelegt: ohne Provider fiele `useAnzeigeKonventionen` auf die lokale Zone der Maschine
 * zurück, und nur den Provider einzuhängen genügt nicht, weil die Einstellungs-Abfrage erst nach
 * dem ersten Render auflöst — auf einem Berliner Rechner bliebe der Test sonst auch mit `zeitzone:
 * 'UTC'` grün. `setQueryData` stellt die Zone vor dem ersten Render.
 */
function renderMitZone(bid: number) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(einsatzKeys.einstellungen(1), {
    einsatz_id: 1,
    zeitzone: 'Europe/Berlin',
    org_defaults: { org_id: 1 },
  });
  return render(
    <QueryClientProvider client={qc}>
      <AntApp>
        <AuthProvider>
          <EinsatzAnzeigeProvider einsatzId={1}>
            <RouterProvider
              router={createMemoryRouter(
                [
                  {
                    path: '/einsaetze/:id/auftraege/befehle/:befehlId',
                    element: <BefehlDetailPage />,
                  },
                ],
                { initialEntries: [`/einsaetze/1/auftraege/befehle/${bid}`] },
              )}
            />
          </EinsatzAnzeigeProvider>
        </AuthProvider>
      </AntApp>
    </QueryClientProvider>,
  );
}

describe('BefehlDetailPage — Zeitstand (LFH-350 · H60)', () => {
  it('zeigt die taktische DTG in der Anzeigezone, nicht den rohen UTC-Wirestring', async () => {
    vi.mocked(einsaetzeApi.ladeEinstellungen).mockResolvedValue({
      einsatz_id: 1,
      zeitzone: 'Europe/Berlin',
      org_defaults: { org_id: 1 },
    } as never);
    vi.mocked(befehleApi.ladeBefehl).mockResolvedValue({
      ...befehl('freigegeben'),
      zeitstand: '2026-07-25 12:00:00',
    } as never);
    renderMitZone(7);

    // 12:00 UTC → 14:00 Sommerzeit in Berlin.
    expect(await screen.findByText('Zeitstand: 251400JUL2026')).toBeInTheDocument();
    expect(screen.queryByText(/2026-07-25 12:00:00/)).toBeNull();
  });
});

describe('BefehlDetailPage — Router-Blocker (LFH-462)', () => {
  beforeEach(() => {
    vi.mocked(befehleApi.ladeBefehl).mockResolvedValue(befehl('entwurf') as never);
    vi.mocked(befehleApi.aktualisiereBefehl).mockReset();
    vi.mocked(befehleApi.aktualisiereBefehl).mockResolvedValue(befehl('entwurf') as never);
  });

  function halteSpeichernAn() {
    let resolve!: (wert: never) => void;
    let reject!: (fehler: Error) => void;
    vi.mocked(befehleApi.aktualisiereBefehl).mockImplementation(
      () =>
        new Promise((ja, nein) => {
          resolve = ja;
          reject = nein;
        }),
    );
    return {
      erfolg: () =>
        act(async () => {
          resolve(befehl('entwurf') as never);
        }),
      fehler: () =>
        act(async () => {
          reject(new Error('Netz unterbrochen'));
        }),
      /** Wie `fehler`, aber mit einem bestimmten Grund — der Wortlaut trägt die Aussage. */
      ablehnen: (e: Error) =>
        act(async () => {
          reject(e);
        }),
    };
  }

  async function oeffneBlocker() {
    const titel = await screen.findByLabelText('Titel');
    await userEvent.type(titel, ' neu');
    await userEvent.click(screen.getByRole('link', { name: 'Aufträge/Befehle' }));
    return within(await screen.findByRole('dialog', { name: 'Ungespeicherte Änderungen' }));
  }

  it('hält die Brotkrume an; Verwerfen setzt genau diesen Wechsel fort', async () => {
    halteSpeichernAn();
    renderAt(7);
    const dialog = await oeffneBlocker();
    expect(screen.queryByText('AUFTRAEGE-LISTE')).toBeNull();
    await userEvent.click(dialog.getByRole('button', { name: 'Verwerfen' }));
    expect(await screen.findByText('AUFTRAEGE-LISTE')).toBeInTheDocument();
    expect(befehleApi.aktualisiereBefehl).toHaveBeenCalledTimes(1); // nur vorheriger Blur
  });

  it('Bleiben hält die Fassung und verwirft die Navigation auch nach Autosave-Erfolg', async () => {
    const save = halteSpeichernAn();
    const { router } = renderAt(7);
    const dialog = await oeffneBlocker();
    await userEvent.click(dialog.getByRole('button', { name: 'Bleiben' }));
    expect(screen.getByLabelText('Titel')).toHaveValue('Befehl 1 neu');
    await save.erfolg();
    expect(router.state.location.pathname).toBe('/einsaetze/1/auftraege/befehle/7');
    expect(screen.queryByText('AUFTRAEGE-LISTE')).toBeNull();
  });

  it('holt den angehaltenen Wechsel nach, sobald Autosave die Fassung gesichert hat', async () => {
    const save = halteSpeichernAn();
    renderAt(7);
    await oeffneBlocker();
    await save.erfolg();
    expect(await screen.findByText('AUFTRAEGE-LISTE')).toBeInTheDocument();
  });

  it('bleibt bei einem Speicherfehler und speichert beim erneuten Auftrag vor dem Weitergehen', async () => {
    const save = halteSpeichernAn();
    renderAt(7);
    const dialog = await oeffneBlocker();
    await save.fehler();
    expect(screen.queryByText('AUFTRAEGE-LISTE')).toBeNull();
    const erneut = halteSpeichernAn();
    const weiter = dialog.getByRole('button', { name: /Speichern und weiter/ });
    await waitFor(() => expect(weiter).not.toHaveClass('ant-btn-loading'));
    await userEvent.click(weiter);
    await waitFor(() => expect(befehleApi.aktualisiereBefehl).toHaveBeenCalledTimes(2));
    expect(befehleApi.aktualisiereBefehl).toHaveBeenLastCalledWith(
      1,
      7,
      expect.objectContaining({ titel: 'Befehl 1 neu' }),
    );
    expect(screen.queryByText('AUFTRAEGE-LISTE')).toBeNull();
    await erneut.erfolg();
    expect(await screen.findByText('AUFTRAEGE-LISTE')).toBeInTheDocument();
  });

  /**
   * Der Grund muss im Dialog stehen, nicht auf der Seite dahinter: der Blocker-Dialog trägt
   * `mask={{ closable: false }}`, alles dahinter ist abgedunkelt. Ohne Grund im Dialog fiele nur
   * `loading`, und der Dialog stünde unverändert da. `autosaveJetzt()` liefert `void`, die Seite
   * kann nicht selbst melden.
   */
  it('zeigt den Grund eines gescheiterten „Speichern und weiter" IM Dialog', async () => {
    const save = halteSpeichernAn();
    renderAt(7);
    const dialog = await oeffneBlocker();
    await save.fehler();
    const erneut = halteSpeichernAn();
    const weiter = dialog.getByRole('button', { name: /Speichern und weiter/ });
    await waitFor(() => expect(weiter).not.toHaveClass('ant-btn-loading'));
    await userEvent.click(weiter);
    await erneut.ablehnen(new ApiError(503, 'Speichern vorübergehend nicht möglich'));

    expect(await dialog.findByText('Speichern vorübergehend nicht möglich')).toBeInTheDocument();
    expect(screen.queryByText('AUFTRAEGE-LISTE')).toBeNull();
  });

  it('räumt den Grund im Dialog, sobald das Speichern gelingt, und geht weiter (Gegenaussage)', async () => {
    const save = halteSpeichernAn();
    renderAt(7);
    const dialog = await oeffneBlocker();
    await save.ablehnen(new ApiError(503, 'Speichern vorübergehend nicht möglich'));
    expect(await dialog.findByText('Speichern vorübergehend nicht möglich')).toBeInTheDocument();

    const erneut = halteSpeichernAn();
    const weiter = dialog.getByRole('button', { name: /Speichern und weiter/ });
    await waitFor(() => expect(weiter).not.toHaveClass('ant-btn-loading'));
    await userEvent.click(weiter);
    await erneut.erfolg();
    expect(await screen.findByText('AUFTRAEGE-LISTE')).toBeInTheDocument();
    expect(screen.queryByText('Speichern vorübergehend nicht möglich')).toBeNull();
  });

  it('schützt auch Browser-Zurück und lässt eine neue Fassung nach älterem PATCH offen', async () => {
    const save = halteSpeichernAn();
    const { router } = renderAt(7);
    const titel = await screen.findByLabelText('Titel');
    await userEvent.type(titel, ' a');
    await userEvent.tab();
    await userEvent.type(titel, ' b');
    await act(async () => {
      await router.navigate(-1);
    });
    await screen.findByRole('dialog', { name: 'Ungespeicherte Änderungen' });
    await save.erfolg();
    expect(screen.queryByText('AUFTRAEGE-LISTE')).toBeNull();
    expect(screen.getByLabelText('Titel')).toHaveValue('Befehl 1 a b');
  });

  it('gibt eine neue Eingabe nicht durch die Quittung eines älteren manuellen Speicherns frei', async () => {
    const save = halteSpeichernAn();
    const { router } = renderAt(7);
    const titel = await screen.findByLabelText('Titel');
    await userEvent.type(titel, ' a');
    // Direkter Submit ohne Blur trennt den manuellen Weg vom Autosave.
    fireEvent.submit(titel.closest('form')!);
    await waitFor(() => expect(befehleApi.aktualisiereBefehl).toHaveBeenCalledTimes(1));
    await userEvent.type(titel, ' b');
    await act(async () => {
      await router.navigate('/einsaetze/1/auftraege');
    });
    await screen.findByRole('dialog', { name: 'Ungespeicherte Änderungen' });
    await save.erfolg();
    expect(router.state.location.pathname).toBe('/einsaetze/1/auftraege/befehle/7');
    expect(screen.getByLabelText('Titel')).toHaveValue('Befehl 1 a b');
  });

  it('schreibt manuellen Stand und folgenden Autosave in Reihenfolge und wartet auf die neuere Fassung', async () => {
    const save = halteSpeichernAn();
    const { router } = renderAt(7);
    const titel = await screen.findByLabelText('Titel');
    await userEvent.type(titel, ' a');
    fireEvent.submit(titel.closest('form')!);
    await waitFor(() => expect(befehleApi.aktualisiereBefehl).toHaveBeenCalledTimes(1));
    await userEvent.type(titel, ' b');
    await userEvent.click(screen.getByRole('link', { name: 'Aufträge/Befehle' }));
    await screen.findByRole('dialog', { name: 'Ungespeicherte Änderungen' });
    expect(befehleApi.aktualisiereBefehl).toHaveBeenCalledTimes(1);
    await save.erfolg();
    await waitFor(() => expect(befehleApi.aktualisiereBefehl).toHaveBeenCalledTimes(2));
    expect(befehleApi.aktualisiereBefehl).toHaveBeenLastCalledWith(
      1,
      7,
      expect.objectContaining({ titel: 'Befehl 1 a b' }),
    );
    expect(router.state.location.pathname).toBe('/einsaetze/1/auftraege/befehle/7');
    await save.erfolg();
    expect(await screen.findByText('AUFTRAEGE-LISTE')).toBeInTheDocument();
  });

  it('startet nach Verwerfen keinen vorgemerkten PATCH des verlassenen Editors', async () => {
    const save = halteSpeichernAn();
    renderAt(7);
    const titel = await screen.findByLabelText('Titel');
    await userEvent.type(titel, ' a');
    fireEvent.submit(titel.closest('form')!);
    await waitFor(() => expect(befehleApi.aktualisiereBefehl).toHaveBeenCalledTimes(1));
    await userEvent.type(titel, ' b');
    await userEvent.click(screen.getByRole('link', { name: 'Aufträge/Befehle' }));
    const dialog = within(await screen.findByRole('dialog', { name: 'Ungespeicherte Änderungen' }));
    await userEvent.click(dialog.getByRole('button', { name: 'Verwerfen' }));
    await screen.findByText('AUFTRAEGE-LISTE');
    await save.erfolg();
    expect(befehleApi.aktualisiereBefehl).toHaveBeenCalledTimes(1);
  });

  it('lässt Query-/Hash-Wechsel im selben Editor ohne Dialog zu', async () => {
    const { router } = renderAt(7);
    await userEvent.type(await screen.findByLabelText('Titel'), ' neu');
    await act(async () => {
      await router.navigate('?ansicht=test#lage');
    });
    expect(screen.getByLabelText('Titel')).toHaveValue('Befehl 1 neu');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(router.state.location.hash).toBe('#lage');
  });

  it.each(['entwurf', 'freigegeben'] as const)(
    'lässt die unveränderte Fassung %s direkt gehen',
    async (status) => {
      vi.mocked(befehleApi.ladeBefehl).mockResolvedValue(befehl(status) as never);
      renderAt(7);
      await userEvent.click(await screen.findByRole('link', { name: 'Aufträge/Befehle' }));
      expect(await screen.findByText('AUFTRAEGE-LISTE')).toBeInTheDocument();
      expect(screen.queryByRole('dialog')).toBeNull();
    },
  );

  it('verlangt beim ausdrücklichen Speichern einen gültigen Titel', async () => {
    halteSpeichernAn();
    renderAt(7);
    await userEvent.clear(await screen.findByLabelText('Titel'));
    // Ohne Blur: prüft den expliziten Dialogweg unabhängig vom Autosave.
    fireEvent.click(screen.getByRole('link', { name: 'Aufträge/Befehle' }));
    const dialog = within(await screen.findByRole('dialog', { name: 'Ungespeicherte Änderungen' }));
    await userEvent.click(dialog.getByRole('button', { name: 'Speichern und weiter' }));
    await screen.findByText(/titel.*required/i);
    expect(screen.queryByText('AUFTRAEGE-LISTE')).toBeNull();
  });
});

/**
 * Verankerte Aktionsleiste unterhalb des Tablet-Breakpoints (LFH-465).
 *
 * Geprüft wird die Struktur — ein Aktionsblock, zwei Orte, der Autosave-Beleg geht mit. Die
 * Geometrie (klebt die Leiste, verdeckt sie ein Fokusziel) kann jsdom nicht beantworten; die trägt
 * `e2e/befehl-aktionsleiste.spec.ts`.
 *
 * Beide Zweige stehen als Paar: ein Bau, der die Leiste in jeder Breite verankert, erfüllte „bei
 * 390 px verankert" ebenfalls.
 */
describe('BefehlDetailPage — verankerte Aktionsleiste (LFH-465)', () => {
  beforeEach(() => {
    vi.mocked(befehleApi.ladeBefehl).mockResolvedValue(befehl('entwurf') as never);
    vi.mocked(befehleApi.aktualisiereBefehl).mockResolvedValue(befehl('entwurf') as never);
  });

  const aktionsblock = () => document.querySelector<HTMLElement>('[data-lfh="befehl-aktionen"]');

  it('verankert die Aktionen unterhalb von `lg` am unteren Rand', async () => {
    setzeViewportBreite(390);
    renderAt(7);
    const freigeben = await screen.findByRole('button', { name: 'Freigeben' });
    const block = aktionsblock();
    expect(block).not.toBeNull();
    expect(block).toContainElement(freigeben);
    expect(block).toHaveStyle({ position: 'sticky', bottom: '0px' });
  });

  it('lässt die Aktionen ab `lg` im Kopf stehen — dort ist nichts verankert', async () => {
    setzeViewportBreite(1024);
    renderAt(7);
    const freigeben = await screen.findByRole('button', { name: 'Freigeben' });
    const block = aktionsblock();
    expect(block).toContainElement(freigeben);
    expect(block!.style.position).toBe('');
  });

  /**
   * Genau eine Kopie in beiden Breiten. Beide Orte rendern und einen per CSS verstecken lieferte
   * zwei gleichnamige Knöpfe: „Freigeben" doppelt vorgelesen, und der Tabulaturdurchlauf liefe auf
   * ein unsichtbares Ziel.
   */
  it.each([390, 1024])('rendert die Aktionen bei %ipx genau einmal', async (breite) => {
    setzeViewportBreite(breite);
    renderAt(7);
    expect(await screen.findAllByRole('button', { name: 'Freigeben' })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: 'Entwurf speichern' })).toHaveLength(1);
    expect(document.querySelectorAll('[data-lfh="befehl-aktionen"]')).toHaveLength(1);
  });

  /**
   * Der Autosave-Beleg bleibt sichtbar, wo immer die Knöpfe landen; oben im Kopf wäre er auf 390 px
   * aus dem Bild gescrollt, während man tippt.
   */
  it.each([390, 1024])(
    'trägt den Autosave-Beleg bei %ipx im selben Block wie die Knöpfe',
    async (breite) => {
      setzeViewportBreite(breite);
      renderAt(7);
      await userEvent.type(await screen.findByLabelText('Titel'), ' x');
      expect(within(aktionsblock()!).getByText('ungespeicherte Änderungen')).toBeInTheDocument();
    },
  );
});

/**
 * ── Speicherfehler in der Seite (LFH-494) ──
 *
 * Zwilling der Probe in `LageberichtePage.test.tsx`: beide Entwurfsseiten teilen den
 * Verlustschutz-Hook.
 *
 * Die `.ant-message`-Abgrenzung trägt die Aussage: antds Toast rendert innerhalb des
 * RTL-Containers, ein bloßes `findByText` bliebe auch mit Toast grün.
 */
describe('BefehlDetailPage — Speicherfehler in der Seite (LFH-494)', () => {
  it('lässt den Grund eines gescheiterten Autosave in der Seite stehen, nicht nur im Toast', async () => {
    vi.mocked(befehleApi.ladeBefehl).mockResolvedValue(befehl('entwurf') as never);
    vi.mocked(befehleApi.aktualisiereBefehl).mockRejectedValue(
      new ApiError(503, 'Dienst nicht erreichbar'),
    );
    renderAt(7);
    await userEvent.type(await screen.findByLabelText('Titel'), 'x');
    await userEvent.tab();

    const treffer = await screen.findByText('Dienst nicht erreichbar');
    expect(treffer.closest('.ant-message')).toBeNull();
    expect(screen.getByText('Nicht gespeichert')).toBeInTheDocument();
    expect(screen.getByText('ungespeicherte Änderungen')).toBeInTheDocument();
  });

  it('räumt den Grund beim nächsten gelungenen Speichern (Gegenaussage)', async () => {
    vi.mocked(befehleApi.ladeBefehl).mockResolvedValue(befehl('entwurf') as never);
    vi.mocked(befehleApi.aktualisiereBefehl)
      .mockRejectedValueOnce(new ApiError(503, 'Dienst nicht erreichbar'))
      .mockResolvedValue(befehl('entwurf') as never);
    renderAt(7);
    await userEvent.type(await screen.findByLabelText('Titel'), 'x');
    await userEvent.tab();
    expect(await screen.findByText('Dienst nicht erreichbar')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Entwurf speichern' }));
    await waitFor(() =>
      expect(screen.queryByText('Dienst nicht erreichbar')).not.toBeInTheDocument(),
    );
  });

  it('behandelt das Verlassen des Editors nicht als Speicherfehler', async () => {
    // `speichern` bricht noch nicht gestartete Aufträge mit einem `AbortError` ab. Ein Alert dafür
    // behauptete einen Verlust, den es nicht gab — auf der Seite, die man gerade verlassen hat.
    vi.mocked(befehleApi.ladeBefehl).mockResolvedValue(befehl('entwurf') as never);
    vi.mocked(befehleApi.aktualisiereBefehl).mockRejectedValue(
      new DOMException('Editor verlassen', 'AbortError'),
    );
    renderAt(7);
    await userEvent.type(await screen.findByLabelText('Titel'), 'x');
    await userEvent.tab();
    await act(async () => {});
    expect(screen.queryByText('Nicht gespeichert')).not.toBeInTheDocument();
  });
});

/**
 * ── Gescheiterte Freigabe (LFH-535) ──
 *
 * Schlägt `POST …/freigeben` fehl, bleibt der Bestätigungsdialog stehen; ein Toast wäre nach drei
 * Sekunden weg und der Dialog von „nichts passiert" nicht zu unterscheiden. Der Dialog trägt
 * `mask={{ closable: false }}`, ein Seiten-Alert dahinter wäre unsichtbar.
 *
 * Zwei Hälften: der Grund steht im Dialog und nicht in der Message-Queue. Ohne
 * `closest('.ant-message')` bliebe der Test grün, wenn der Toast zurückkäme.
 */
describe('BefehlDetailPage — gescheiterte Freigabe (LFH-535)', () => {
  beforeEach(() => {
    vi.mocked(befehleApi.ladeBefehl).mockResolvedValue(befehl('entwurf') as never);
    vi.mocked(befehleApi.aktualisiereBefehl).mockResolvedValue(befehl('entwurf') as never);
    // Die Suite fährt ohne `clearMocks`: der Zähler liefe sonst über die Tests der Datei weiter.
    vi.mocked(befehleApi.gibBefehlFrei).mockClear();
  });

  async function oeffneFreigabe() {
    await userEvent.click(await screen.findByRole('button', { name: 'Freigeben' }));
    return screen.findByRole('dialog', { name: 'Befehl freigeben?' });
  }

  /**
   * Die Message-Queue nach diesem Wortlaut absuchen.
   *
   * `within(dialog).findByText(...)` allein belegt es nicht: käme der Toast zurück, stünde der
   * Wortlaut an zwei Stellen. Ein `getAllByText`-Zähler taugt auch nicht überall — beim
   * gescheiterten Speicher-Vorlauf steht der Grund zu Recht doppelt (Dialog und Seiten-Alert).
   * Gezählt wird deshalb genau die Queue.
   */
  function toastsMit(wortlaut: string) {
    return [...document.querySelectorAll('.ant-message')].filter((n) =>
      n.textContent?.includes(wortlaut),
    );
  }

  it('zeigt den Grund IM Dialog statt im Toast und lässt ihn offen', async () => {
    vi.mocked(befehleApi.gibBefehlFrei).mockRejectedValue(
      new ApiError(422, 'Abschnitt „Auftrag" ist leer'),
    );
    renderAt(7);
    const dialog = await oeffneFreigabe();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Freigeben' }));

    const treffer = await within(dialog).findByText('Abschnitt „Auftrag" ist leer');
    expect(treffer.closest('.ant-message')).toBeNull();
    expect(toastsMit('Abschnitt „Auftrag" ist leer')).toHaveLength(0);
    expect(within(dialog).getByText('Freigabe fehlgeschlagen')).toBeInTheDocument();
    // „Offen" heißt in jsdom „nicht in der Verlassen-Bewegung": antds Modal räumt seinen Knoten
    // erst am Ende der Zoom-Animation ab, und jsdom feuert kein `transitionend`.
    // `queryByRole('dialog')` wäre hier blind.
    expect(dialog).not.toHaveClass('ant-zoom-leave');
  });

  it('schliesst den Dialog bei gelungener Freigabe und quittiert per Toast (Gegenaussage)', async () => {
    vi.mocked(befehleApi.gibBefehlFrei).mockResolvedValue(befehl('freigegeben') as never);
    renderAt(7);
    const dialog = await oeffneFreigabe();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Freigeben' }));

    await waitFor(() => expect(dialog).toHaveClass('ant-zoom-leave'));
    expect(await screen.findByText('Befehl freigegeben')).toBeInTheDocument();
  });

  /**
   * Der Speicher-Vorlauf ist die erste Fehlerquelle: `/freigeben` prüft den persistierten Stand.
   * Scheitert er, läuft die Freigabe nicht, und der Grund trägt eine andere Überschrift, weil er
   * Anderes sagt.
   */
  it('hält die Freigabe zurück, wenn schon der Speicher-Vorlauf scheitert', async () => {
    vi.mocked(befehleApi.aktualisiereBefehl).mockRejectedValue(
      new ApiError(503, 'Dienst nicht erreichbar'),
    );
    renderAt(7);
    const dialog = await oeffneFreigabe();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Freigeben' }));

    const treffer = await within(dialog).findByText('Dienst nicht erreichbar');
    expect(treffer.closest('.ant-message')).toBeNull();
    expect(toastsMit('Dienst nicht erreichbar')).toHaveLength(0);
    expect(within(dialog).getByText('Nicht gespeichert')).toBeInTheDocument();
    expect(befehleApi.gibBefehlFrei).not.toHaveBeenCalled();
  });

  /**
   * react-query hält `error` bis zum nächsten `mutate()`. Ohne `reset()` beim Öffnen trüge ein
   * abgebrochener Versuch seinen Grund in den nächsten Dialog.
   */
  it('öffnet nach Abbrechen ohne den Grund des vorigen Versuchs', async () => {
    vi.mocked(befehleApi.gibBefehlFrei).mockRejectedValue(
      new ApiError(422, 'Abschnitt „Auftrag" ist leer'),
    );
    renderAt(7);
    const dialog = await oeffneFreigabe();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Freigeben' }));
    await within(dialog).findByText('Abschnitt „Auftrag" ist leer');

    await userEvent.click(within(dialog).getByRole('button', { name: 'Abbrechen' }));
    await waitFor(() => expect(dialog).toHaveClass('ant-zoom-leave'));
    await userEvent.click(screen.getByRole('button', { name: 'Freigeben' }));

    await waitFor(() => expect(dialog).not.toHaveClass('ant-zoom-leave'));
    expect(within(dialog).queryByText('Abschnitt „Auftrag" ist leer')).toBeNull();
  });
});

/**
 * ── Druckwurzel (LFH-71) ──
 *
 * `druck/druck.css` blendet im Druck alles außerhalb der Druckwurzel aus (`display: none`). Der
 * Guard hält fest, dass die Seite genau eine Wurzel trägt und die gedruckten Teile in ihr liegen.
 * Ob die Regeln wirken, misst `e2e/druck-fluss.spec.ts`.
 */
describe('BefehlDetailPage — Druckwurzel (LFH-71)', () => {
  function wurzel(): HTMLElement {
    const alle = document.querySelectorAll<HTMLElement>('[data-lfh="druckwurzel"]');
    expect(alle).toHaveLength(1);
    return alle[0];
  }

  it('Lesezweig: genau eine Wurzel, Abschnittstitel und Text liegen darin', async () => {
    vi.mocked(befehleApi.ladeBefehl).mockResolvedValue({
      ...befehl('freigegeben'),
      abschnitte: [{ schluessel: 'lage', text: 'Die Lage ist ruhig.' }],
    } as never);
    renderAt(7);
    const titel = await screen.findByRole('heading', { name: 'Lage' });
    expect(wurzel()).toContainElement(titel);
    expect(wurzel()).toContainElement(screen.getByText('Die Lage ist ruhig.'));
  });

  it('Entwurfszweig: genau eine Wurzel, jede Editor-Vorschau liegt darin', async () => {
    vi.mocked(befehleApi.ladeBefehl).mockResolvedValue({
      ...befehl('entwurf'),
      abschnitte: [{ schluessel: 'lage', text: 'Die Lage ist ruhig.' }],
    } as never);
    renderAt(7);
    await screen.findByLabelText('Lage');
    const vorschauen = document.querySelectorAll('.markdown-editor__vorschau');
    expect(vorschauen.length).toBeGreaterThan(0);
    for (const v of vorschauen) expect(wurzel()).toContainElement(v as HTMLElement);
    expect(wurzel()).toContainElement(screen.getByLabelText('Lage'));
  });
});

/**
 * ── Druckkopf und Druckknopf (LFH-22) ──
 *
 * Der gemeinsame Druckkopf steht in der Druckwurzel über dem Inhalt und ist am Bildschirm
 * verborgen. „Drucken / als PDF" öffnet den Dialog erst, wenn die Organisation geladen ist — sonst
 * fehlte ihr Name auf dem Blatt.
 */
describe('BefehlDetailPage — Druckkopf (LFH-22)', () => {
  it('trägt den Druckkopf in der Wurzel: „Befehl – Titel", Stand, am Schirm verborgen', async () => {
    vi.mocked(befehleApi.ladeBefehl).mockResolvedValue(befehl('freigegeben') as never);
    renderAt(7);
    await screen.findByRole('button', { name: 'Fortschreiben' });
    const kopf = document.querySelector<HTMLElement>('[data-lfh="druckkopf"]');
    expect(kopf).not.toBeNull();
    expect(document.querySelector('[data-lfh="druckwurzel"]')).toContainElement(kopf);
    expect(kopf).toHaveClass('druckkopf--nur-druck');
    expect(within(kopf!).getByRole('heading', { level: 1, hidden: true })).toHaveTextContent(
      'Befehl – Befehl 1',
    );
    expect(within(kopf!).getByText('Freigegeben · Version 1')).toBeInTheDocument();
  });

  it('ruft window.print erst nach geladener Organisation', async () => {
    const drucke = vi.spyOn(window, 'print').mockImplementation(() => {});
    let freigeben!: () => void;
    const tor = new Promise<void>((fertig) => {
      freigeben = fertig;
    });
    server.use(
      http.get('/api/organisation', async () => {
        await tor;
        return HttpResponse.json({ id: 1, name: 'Testorganisation', tz_organisation: null });
      }),
    );
    vi.mocked(befehleApi.ladeBefehl).mockResolvedValue(befehl('freigegeben') as never);
    renderAt(7);
    await userEvent.click(await screen.findByRole('button', { name: 'Drucken / als PDF' }));
    await new Promise((fertig) => setTimeout(fertig, 30));
    expect(drucke).not.toHaveBeenCalled();
    freigeben();
    await waitFor(() => expect(drucke).toHaveBeenCalledTimes(1));
    drucke.mockRestore();
  });
});
