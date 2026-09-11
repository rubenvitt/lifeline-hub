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

vi.mock('../api/befehle');
vi.mock('../api/einsaetze');

const einsatz = { id: 1, bezeichnung: 'Übung', status: 'aktiv', meine_rolle: 'einsatzleitung' };

function renderAt(bid: number | string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createMemoryRouter([
    { path: '/einsaetze', element: <div>EINSATZ-LISTE</div> },
    { path: '/einsaetze/:id/auftraege', element: <div>AUFTRAEGE-LISTE</div> },
    { path: '/einsaetze/:id/auftraege/befehle/:befehlId', element: <BefehlDetailPage /> },
  ], { initialEntries: ['/einsaetze/1/auftraege', `/einsaetze/1/auftraege/befehle/${bid}`] });
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

/**
 * ── EINSTIEGSFOKUS (LFH-495, Nachzug C13/N3) ───────────────────────────────────
 *
 * Die Bedienentscheidung ist der ERSTE LEERE Abschnitt; Mechanik und Begründungen stehen in
 * `entwurf/Einstiegsfokus.tsx` samt eigenem Test. Hier steht, dass die SEITE das Ziel aus dem
 * SERVERSTAND ableitet und nicht aus den Formularwerten — die sind beim Mount noch leer, der
 * Sync-Effekt füllt sie erst danach. Eine Ableitung aus dem Formular träfe deshalb immer den
 * ersten Abschnitt und wäre von der richtigen Wahl nicht zu unterscheiden.
 *
 * Anders als im Lagebericht gibt es hier kein Akkordeon: alle fünf Editoren stehen gestapelt,
 * der Fokus scrollt die Seite bis zu seinem Ziel (die verankerte Aktionsleiste hält es über
 * `scroll-padding-block-end` frei, LFH-465).
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
   * Der Kopf trägt die Phasenfarbe der gemeinsamen Achse, nicht das Preset-Grün
   * (LFH-493). Die Farbe ist hier die einzige im DOM sichtbare Hälfte der
   * Umstellung: der Wortlaut ist vorher wie nachher „Freigegeben" — dass er
   * GELESEN statt abgeschrieben wird, pinnt `kommunikation/kopfStatus.guard.test.ts`.
   *
   * Der Entwurfs-Zustand ist bewusst NICHT die Probe: `PHASE_META.offen.color` ist
   * `'default'` und damit byte-gleich zum abgelösten Preset — ein Test darauf bliebe
   * auch ohne den Fix grün.
   */
  it('malt den freigegebenen Status in der Phasenfarbe, nicht im Preset-Grün', async () => {
    vi.mocked(befehleApi.ladeBefehl).mockResolvedValue(befehl('freigegeben') as never);
    renderAt(7);
    const etikett = (await screen.findByText('Freigegeben')).closest('.ant-tag');
    expect(etikett).toHaveClass('ant-tag-success');
    expect(etikett).not.toHaveClass('ant-tag-green');
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
            <RouterProvider router={createMemoryRouter([
              { path: '/einsaetze/:id/auftraege/befehle/:befehlId', element: <BefehlDetailPage /> },
            ], { initialEntries: [`/einsaetze/1/auftraege/befehle/${bid}`] })} />
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


describe('BefehlDetailPage — Router-Blocker (LFH-462)', () => {
  beforeEach(() => {
    vi.mocked(befehleApi.ladeBefehl).mockResolvedValue(befehl('entwurf') as never);
    vi.mocked(befehleApi.aktualisiereBefehl).mockReset();
    vi.mocked(befehleApi.aktualisiereBefehl).mockResolvedValue(befehl('entwurf') as never);
  });

  function halteSpeichernAn() {
    let resolve!: (wert: never) => void;
    let reject!: (fehler: Error) => void;
    vi.mocked(befehleApi.aktualisiereBefehl).mockImplementation(() =>
      new Promise((ja, nein) => { resolve = ja; reject = nein; }));
    return {
      erfolg: () => act(async () => { resolve(befehl('entwurf') as never); }),
      fehler: () => act(async () => { reject(new Error('Netz unterbrochen')); }),
      /** Wie `fehler`, aber mit einem bestimmten Grund — der Wortlaut trägt die Aussage. */
      ablehnen: (e: Error) => act(async () => { reject(e); }),
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
    expect(befehleApi.aktualisiereBefehl).toHaveBeenLastCalledWith(1, 7,
      expect.objectContaining({ titel: 'Befehl 1 neu' }));
    expect(screen.queryByText('AUFTRAEGE-LISTE')).toBeNull();
    await erneut.erfolg();
    expect(await screen.findByText('AUFTRAEGE-LISTE')).toBeInTheDocument();
  });

  /**
   * Der Grund muss IM Dialog stehen, nicht auf der Seite dahinter (LFH-494, Review-Befund).
   *
   * Der Blocker-Dialog trägt `mask={{ closable: false }}`: alles hinter ihm ist abgedunkelt
   * und unbedienbar. Solange der Fehler über `message.error` lief, war genau das der Kanal,
   * der über einem offenen Modal funktioniert — beim Umbau auf den Seiten-Alert wäre diese
   * eine Stelle sonst ohne jede Rückmeldung geblieben: `loading` fällt, der Dialog steht
   * unverändert da. Das ist die H14-Diagnose, die dieses Ticket schliesst, an einem Pfad
   * wieder aufgemacht. Anders als im Freigabe-Flow kann die Seite hier nicht „beides"
   * melden — `autosaveJetzt()` liefert `void`, es gibt nichts zum Awaiten.
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
    await act(async () => { await router.navigate(-1); });
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
    await act(async () => { await router.navigate('/einsaetze/1/auftraege'); });
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
    expect(befehleApi.aktualisiereBefehl).toHaveBeenLastCalledWith(1, 7,
      expect.objectContaining({ titel: 'Befehl 1 a b' }));
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
    await act(async () => { await router.navigate('?ansicht=test#lage'); });
    expect(screen.getByLabelText('Titel')).toHaveValue('Befehl 1 neu');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(router.state.location.hash).toBe('#lage');
  });

  it.each(['entwurf', 'freigegeben'] as const)('lässt die unveränderte Fassung %s direkt gehen', async (status) => {
    vi.mocked(befehleApi.ladeBefehl).mockResolvedValue(befehl(status) as never);
    renderAt(7);
    await userEvent.click(await screen.findByRole('link', { name: 'Aufträge/Befehle' }));
    expect(await screen.findByText('AUFTRAEGE-LISTE')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

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
 * Verankerte Aktionsleiste unterhalb des Tablet-Breakpoints (LFH-465, Nachzug aus
 * LFH-343 · C8, Prüflisten-Zeile 13).
 *
 * WAS HIER FÄLLT UND WAS NICHT: die STRUKTUR — ein Aktionsblock, zwei Orte, der
 * Autosave-Beleg geht mit. Die GEOMETRIE (klebt die Leiste wirklich unten, verdeckt sie
 * ein Fokusziel) kann jsdom nicht beantworten, es rechnet kein Layout; die trägt
 * `e2e/befehl-aktionsleiste.spec.ts`.
 *
 * DIE UNGLEICHHEIT IST DIE AUSSAGE. Ein Bau, der die Leiste in jeder Breite verankert,
 * erfüllte „bei 390 px verankert" ebenfalls und wäre trotzdem falsch — oberhalb der
 * Schwelle gehören dieselben Aktionen in den Kopf. Beide Zweige stehen deshalb als Paar.
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
   * Genau EINE Kopie, in beiden Breiten. Der naheliegende Fehlbau — beide Orte rendern,
   * einer per CSS versteckt — liefert zwei gleichnamige Knöpfe im Baum: die
   * Vorlesereihenfolge bekäme „Freigeben" doppelt, und der Tabulaturdurchlauf des
   * Verdeckungsnachweises liefe auf ein unsichtbares Ziel.
   */
  it.each([390, 1024])('rendert die Aktionen bei %ipx genau einmal', async (breite) => {
    setzeViewportBreite(breite);
    renderAt(7);
    expect(await screen.findAllByRole('button', { name: 'Freigeben' })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: 'Entwurf speichern' })).toHaveLength(1);
    expect(document.querySelectorAll('[data-lfh="befehl-aktionen"]')).toHaveLength(1);
  });

  /**
   * Der Autosave-Beleg (LFH-342 · C7) muss sichtbar bleiben, WO IMMER die Knöpfe landen —
   * das ist der zweite Aufzählungspunkt des Tickets. Ein Beleg, der oben im Kopf
   * stehenbliebe, während die Knöpfe unten kleben, wäre auf 390 px aus dem Bild gescrollt,
   * genau während man tippt.
   */
  it.each([390, 1024])('trägt den Autosave-Beleg bei %ipx im selben Block wie die Knöpfe', async (breite) => {
    setzeViewportBreite(breite);
    renderAt(7);
    await userEvent.type(await screen.findByLabelText('Titel'), ' x');
    expect(within(aktionsblock()!).getByText('ungespeicherte Änderungen')).toBeInTheDocument();
  });
});

/**
 * ── SPEICHERFEHLER IN DER SEITE (LFH-494, Nachzug C13/N2) ──────────────────────
 *
 * Der Zwilling der Probe in `LageberichtePage.test.tsx`. Beide Entwurfsseiten teilen sich
 * den Verlustschutz-Hook — wer nur eine umstellt, öffnet die Divergenz wieder, die C13 mit
 * dem gemeinsamen Hook geschlossen hat.
 *
 * Die `.ant-message`-Abgrenzung trägt die Aussage: antds Toast rendert INNERHALB des
 * RTL-Containers, ein blosses `findByText` bliebe mit zurückgedrehtem Umbau grün.
 */
describe('BefehlDetailPage — Speicherfehler in der Seite (LFH-494)', () => {
  it('lässt den Grund eines gescheiterten Autosave in der Seite stehen, nicht nur im Toast', async () => {
    vi.mocked(befehleApi.ladeBefehl).mockResolvedValue(befehl('entwurf') as never);
    vi.mocked(befehleApi.aktualisiereBefehl)
      .mockRejectedValue(new ApiError(503, 'Dienst nicht erreichbar'));
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
      expect(screen.queryByText('Dienst nicht erreichbar')).not.toBeInTheDocument());
  });

  it('behandelt das Verlassen des Editors nicht als Speicherfehler', async () => {
    // `speichern` bricht noch nicht gestartete Aufträge mit einem `AbortError` ab. Ein
    // Alert dafür behauptete einen Verlust, den es nicht gab — und stünde auf der Seite,
    // die man gerade verlassen hat.
    vi.mocked(befehleApi.ladeBefehl).mockResolvedValue(befehl('entwurf') as never);
    vi.mocked(befehleApi.aktualisiereBefehl)
      .mockRejectedValue(new DOMException('Editor verlassen', 'AbortError'));
    renderAt(7);
    await userEvent.type(await screen.findByLabelText('Titel'), 'x');
    await userEvent.tab();
    await act(async () => {});
    expect(screen.queryByText('Nicht gespeichert')).not.toBeInTheDocument();
  });
});

/**
 * ── GESCHEITERTE FREIGABE (LFH-535, Nachzug N5 aus LFH-348 · C13) ──────────────
 *
 * Dieselbe H14-Diagnose wie beim Speichern, nur am Zustandsübergang: schlägt
 * `POST …/freigeben` fehl, bleibt der Bestätigungsdialog stehen — und solange der Grund
 * nur im Toast stand, war er nach rund drei Sekunden weg und der unveränderte Dialog von
 * „nichts passiert" nicht zu unterscheiden. Der Dialog trägt `mask={{ closable: false }}`,
 * ein Seiten-Alert dahinter wäre unsichtbar.
 *
 * Die Zusicherung hat zwei Hälften, und die zweite trägt sie: der Grund steht IM Dialog
 * UND nicht in der Message-Queue. Ohne `closest('.ant-message')` bliebe der Test grün,
 * wenn der Toast zurückkäme.
 */
describe('BefehlDetailPage — gescheiterte Freigabe (LFH-535)', () => {
  beforeEach(() => {
    vi.mocked(befehleApi.ladeBefehl).mockResolvedValue(befehl('entwurf') as never);
    vi.mocked(befehleApi.aktualisiereBefehl).mockResolvedValue(befehl('entwurf') as never);
    // Die Suite fährt ohne `clearMocks`: der Zähler liefe sonst über die Tests dieser
    // Datei weiter, und „nicht aufgerufen" wäre nach dem ersten Test nie wieder grün
    // (gemessen: 2 Aufrufe aus den Tests darüber).
    vi.mocked(befehleApi.gibBefehlFrei).mockClear();
  });

  async function oeffneFreigabe() {
    await userEvent.click(await screen.findByRole('button', { name: 'Freigeben' }));
    return screen.findByRole('dialog', { name: 'Befehl freigeben?' });
  }

  /**
   * Die Message-Queue nach diesem Wortlaut absuchen — die Hälfte der Zusicherung, die den
   * Umbau trägt.
   *
   * `within(dialog).findByText(...)` allein belegt sie NICHT: käme der Toast zurück,
   * stünde der Wortlaut an ZWEI Stellen, und die Abfrage im Dialog fände ihren Alert
   * weiter. Ein `getAllByText(...)`-Zähler taugt ebenfalls nicht überall — beim
   * gescheiterten Speicher-Vorlauf steht der Grund zu Recht doppelt (Dialog UND
   * Seiten-Alert, der das Schliessen überlebt). Gezählt wird deshalb genau die Queue.
   */
  function toastsMit(wortlaut: string) {
    return [...document.querySelectorAll('.ant-message')]
      .filter((n) => n.textContent?.includes(wortlaut));
  }

  it('zeigt den Grund IM Dialog statt im Toast und lässt ihn offen', async () => {
    vi.mocked(befehleApi.gibBefehlFrei)
      .mockRejectedValue(new ApiError(422, 'Abschnitt „Auftrag" ist leer'));
    renderAt(7);
    const dialog = await oeffneFreigabe();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Freigeben' }));

    const treffer = await within(dialog).findByText('Abschnitt „Auftrag" ist leer');
    expect(treffer.closest('.ant-message')).toBeNull();
    expect(toastsMit('Abschnitt „Auftrag" ist leer')).toHaveLength(0);
    expect(within(dialog).getByText('Freigabe fehlgeschlagen')).toBeInTheDocument();
    // „Offen" heisst in jsdom „nicht in der Verlassen-Bewegung": antds Modal räumt seinen
    // Knoten erst am Ende der Zoom-Animation ab, und jsdom feuert kein `transitionend`
    // (gemessen, `MaterialPage.test.tsx:556`). `queryByRole('dialog')` wäre hier blind.
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
   * Der Speicher-Vorlauf ist die ERSTE Fehlerquelle des Flows: `/freigeben` prüft den
   * persistierten Stand. Scheitert er, darf die Freigabe gar nicht erst laufen — und der
   * Grund trägt eine andere Überschrift, weil er der Person etwas anderes sagt.
   */
  it('hält die Freigabe zurück, wenn schon der Speicher-Vorlauf scheitert', async () => {
    vi.mocked(befehleApi.aktualisiereBefehl)
      .mockRejectedValue(new ApiError(503, 'Dienst nicht erreichbar'));
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
   * react-query hält `error` bis zum nächsten `mutate()`. Ohne `reset()` beim Öffnen trüge
   * ein abgebrochener Versuch seinen Grund in den nächsten, frisch geöffneten Dialog —
   * eine Meldung über etwas, das gerade gar nicht passiert ist.
   */
  it('öffnet nach Abbrechen ohne den Grund des vorigen Versuchs', async () => {
    vi.mocked(befehleApi.gibBefehlFrei)
      .mockRejectedValue(new ApiError(422, 'Abschnitt „Auftrag" ist leer'));
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
