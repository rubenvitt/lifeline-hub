import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App as AntApp } from 'antd';
import BefehlDetailPage from './BefehlDetailPage';
import { AuthProvider } from '../auth/AuthContext';
import * as befehleApi from '../api/befehle';
import * as einsaetzeApi from '../api/einsaetze';
import { EinsatzAnzeigeProvider } from '../anzeige/AnzeigeKonventionenContext';
import { einsatzKeys } from '../api/queryKeys';

vi.mock('../api/befehle');
vi.mock('../api/einsaetze');

const einsatz = { id: 1, bezeichnung: 'Übung', status: 'aktiv', meine_rolle: 'einsatzleitung' };

function renderAt(bid: number | string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const ergebnis = render(
    <QueryClientProvider client={qc}>
      <AntApp>
        <AuthProvider>
          <MemoryRouter initialEntries={[`/einsaetze/1/auftraege/befehle/${bid}`]}>
            <Routes>
              <Route path="/einsaetze/:id/auftraege" element={<div>AUFTRAEGE-LISTE</div>} />
              <Route path="/einsaetze/:id/auftraege/befehle/:befehlId" element={<BefehlDetailPage />} />
            </Routes>
          </MemoryRouter>
        </AuthProvider>
      </AntApp>
    </QueryClientProvider>,
  );
  return {
    ...ergebnis,
    /**
     * Stellt den Serverstand um und löst denselben Weg aus wie der SSE-Listener:
     * Invalidierung → Refetch → neues `befehlQuery.data`.
     *
     * Ein `vi.fn()`-Ersatz oder ein bloßes `rerender` träfe den Fall NICHT — der
     * gemessene Fehlermodus entsteht genau dann, wenn ein FRISCHER Datensatz eine
     * Runde später eintrifft, während im Formular schon getippt wurde.
     */
    rerenderMitBefehl: async (neu: object) => {
      const vorher = vi.mocked(befehleApi.ladeBefehl).mock.calls.length;
      vi.mocked(befehleApi.ladeBefehl).mockResolvedValue(neu as never);
      await act(async () => {
        await qc.invalidateQueries();
      });
      /*
       * Auf den ABGESCHLOSSENEN Refetch warten, nicht bloß auf das Invalidieren.
       * Ohne das besteht ein nachfolgendes `waitFor(… 'Meine Fassung')` beim ERSTEN
       * Versuch — der alte Wert steht ja noch da —, und die Zusicherung wäre grün,
       * auch wenn der Refetch das Feld gleich darauf überschriebe (gemessen: der
       * Test war ohne diese Zeile grün, bevor es einen Riegel gab).
       */
      await waitFor(() =>
        expect(vi.mocked(befehleApi.ladeBefehl).mock.calls.length).toBeGreaterThan(vorher));
    },
  };
}

beforeEach(() => {
  vi.mocked(einsaetzeApi.ladeEinsatz).mockResolvedValue(einsatz as never);
});

function befehl(status: 'entwurf' | 'freigegeben') {
  return {
    id: 7, einsatz_id: 1, vorlage: 'befehl_ladef', titel: 'Befehl 1',
    zeitstand: '2026-06-02 10:00:00', status, abschnitte: [],
    version: 1, vorgaenger_id: null, ersteller_id: 1, ersteller_name: 'EL',
    erstellt_at: '', aktualisiert_at: '', freigegeben_von_id: null,
    freigegeben_von_name: null, freigegeben_at: null, etb_eintrag_id: status === 'freigegeben' ? 5 : null,
  };
}

describe('BefehlDetailPage', () => {
  it('zeigt im Entwurf editierbare Felder mit Hilfetext', async () => {
    vi.mocked(befehleApi.ladeBefehl).mockResolvedValue(befehl('entwurf') as never);
    renderAt(7);
    expect(await screen.findByText('Einsatzunterstützung')).toBeInTheDocument();
    expect(screen.getByText(/a\. Allgemeine Lage/)).toBeInTheDocument();
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
});

/**
 * Verlustschutz am Befehlsentwurf (LFH-342 · C7, Befund N18).
 *
 * Ein Befehl entsteht in mehreren Minuten Schreibarbeit, und der Entwurf lag bis hierher
 * ausschließlich im Formularspeicher: kein Autosave, kein Verlassen-Schutz — und der
 * SSE-Refetch schrieb bei jeder Invalidierung den Serverstand über das, was gerade
 * getippt wurde.
 */
describe('BefehlDetailPage — Verlustschutz (LFH-342 · C7, Befund N18)', () => {
  beforeEach(() => {
    // `mockClear` ist hier nicht Kosmetik: die Suite läuft ohne `clearMocks`, und die
    // Aufrufzählungen dieses Blocks sind die Zusicherung. Ohne das Räumen zählte
    // „speichert nichts" die Aufrufe des vorigen Falls mit und wäre rot, ohne dass am
    // Produktivcode etwas falsch ist (gemessen).
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
     * ZUERST warten, bis der neue Stand nachweislich ANGEKOMMEN ist — die Überschrift
     * kommt aus `befehlQuery.data` und nicht aus dem Formular, sie ist also der
     * unabhängige Zeuge. Ohne diesen Schritt bestünde die Zusicherung darunter beim
     * ersten Versuch (der alte Wert steht ja noch im Feld) und wäre auch ohne jeden
     * Riegel grün — gemessen.
     */
    await screen.findByRole('heading', { name: 'Fremde Fassung' });
    expect(screen.getByLabelText('Titel')).toHaveValue('Meine Fassung');
  });

  it('übernimmt den Serverstand weiterhin, solange nichts berührt wurde', async () => {
    // Die Gegenaussage, und sie ist die eigentliche Prüfung: ein Riegel, der IMMER
    // blockiert, machte die Seite still veraltet — und wäre mit dem Test darüber
    // allein nicht davon zu unterscheiden.
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
      // Und der Zeitstempel sagt es sichtbar — ein Autosave, den niemand sieht,
      // ist von „nicht gespeichert" nicht zu unterscheiden.
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
      // Ein Autosave ohne Änderung erzeugte alle 30 s ein PATCH samt Invalidierung
      // und Live-Ereignis — für nichts.
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
    // Ein verlassenes Feld ist der Moment, in dem ein Abschnitt fertig gedacht ist —
    // und der Griff, der einem In-App-Seitenwechsel IMMER vorausgeht: der Klick auf
    // die Brotkrume blurrt das Feld zuerst.
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
    // Die Gegenaussage: ein Warner, der immer hängt, macht jeden Reload zur Rückfrage
    // und wird nach dem dritten Mal weggeklickt, ohne gelesen zu werden.
    vi.mocked(befehleApi.ladeBefehl).mockResolvedValue(befehl('entwurf') as never);
    renderAt(7);
    await screen.findByLabelText('Titel');

    const ereignis = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(ereignis);
    expect(ereignis.defaultPrevented).toBe(false);
  });
});

/**
 * ── ZEITSTAND IN DER ANZEIGEZONE (LFH-350 · H60) ────────────────────────────────
 *
 * Gleiche Sache wie auf der Lagebericht-Detailseite: `zeitstand` ist ein UTC-Wirestring
 * ohne Zonenkennung und stand roh ausgegeben um den Zonenversatz falsch.
 *
 * Die Zone wird AUSDRÜCKLICH gestellt und der Cache dafür VORBELEGT — beides ist gemessen
 * nötig: (1) ohne Provider fällt `useAnzeigeKonventionen` auf `DEFAULT_KONVENTIONEN` und
 * damit auf die LOKALE Zone der ausführenden Maschine zurück; (2) nur den Provider
 * einzuhängen genügt nicht, weil die Einstellungs-Abfrage ERST NACH dem ersten Render
 * auflöst — `findByText` hat dann längst getroffen, und auf einem Berliner Rechner wäre der
 * Test auch mit `zeitzone: 'UTC'` grün geblieben (Gegenprobe gefahren: 4 von 5 Tests
 * blieben es). `setQueryData` stellt die Zone vor dem ersten Render.
 */
function renderMitZone(bid: number) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(einsatzKeys.einstellungen(1), {
    einsatz_id: 1, zeitzone: 'Europe/Berlin', org_defaults: { org_id: 1 },
  });
  return render(
    <QueryClientProvider client={qc}>
      <AntApp>
        <AuthProvider>
          <EinsatzAnzeigeProvider einsatzId={1}>
            <MemoryRouter initialEntries={[`/einsaetze/1/auftraege/befehle/${bid}`]}>
              <Routes>
                <Route path="/einsaetze/:id/auftraege/befehle/:befehlId" element={<BefehlDetailPage />} />
              </Routes>
            </MemoryRouter>
          </EinsatzAnzeigeProvider>
        </AuthProvider>
      </AntApp>
    </QueryClientProvider>,
  );
}

describe('BefehlDetailPage — Zeitstand (LFH-350 · H60)', () => {
  it('zeigt die taktische DTG in der Anzeigezone, nicht den rohen UTC-Wirestring', async () => {
    vi.mocked(einsaetzeApi.ladeEinstellungen).mockResolvedValue(
      { einsatz_id: 1, zeitzone: 'Europe/Berlin', org_defaults: { org_id: 1 } } as never,
    );
    vi.mocked(befehleApi.ladeBefehl).mockResolvedValue(
      { ...befehl('freigegeben'), zeitstand: '2026-07-25 12:00:00' } as never,
    );
    renderMitZone(7);

    // 12:00 UTC → 14:00 Sommerzeit in Berlin.
    expect(await screen.findByText('Zeitstand: 251400JUL2026')).toBeInTheDocument();
    expect(screen.queryByText(/2026-07-25 12:00:00/)).toBeNull();
  });
});
