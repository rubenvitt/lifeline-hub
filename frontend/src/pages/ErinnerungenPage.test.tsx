import { describe, it, expect, vi, beforeEach, onTestFinished } from 'vitest';
import { act, render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Routes, Route, useLocation, useNavigate } from 'react-router';
import { App as AntApp } from 'antd';
import ErinnerungenPage from './ErinnerungenPage';
import {
  erledigeErinnerung,
  ladeErinnerungKennzahlen,
  legeErinnerungAn,
  listeAbgeschlosseneErinnerungen,
  listeOffeneErinnerungen,
  oeffneErinnerung,
  quittiereErinnerung,
} from '../api/erinnerungen';
import { ApiError } from '../api/client';
import type { Erinnerung } from '../api/types';
import { erinnerungenPfad } from '../routing/deeplinks';
import { einsatzKeys } from '../api/queryKeys';
import { ladeEinsatz } from '../api/einsaetze';
import { setzeOnline } from '../test/utils';

vi.mock('../live/useEinsatzLiveStream', () => ({ useEinsatzLiveStream: () => {} }));
vi.mock('../auth/AuthContext', () => ({ useAuth: () => ({ benutzer: { id: 1 } }) }));
vi.mock('../api/einsaetze', () => ({
  ladeEinsatz: vi.fn().mockResolvedValue({
    id: 1,
    bezeichnung: 'Hochwasser',
    status: 'aktiv',
    meine_rolle: 'einsatzleitung',
  }),
}));
vi.mock('../api/erinnerungen', () => {
  const basis = {
    einsatz_id: 1,
    beschreibung: null,
    intervall_minuten: 30,
    empfaenger_funktion: null,
    bezug_typ: null,
    bezug_id: null,
    quelle: 'manuell',
    erstellt_von_id: 1,
    erstellt_at: '2026-06-11 09:00:00',
    quittiert_at: null,
    quittiert_von_id: null,
    vollzug_status: 'offen',
    vollzogen_at: null,
    vollzogen_von_id: null,
  };
  const offen = {
    ...basis,
    id: 7,
    titel: 'Lagemeldung',
    faellig_at: '2026-06-11 10:00:00',
    status: 'offen',
    erledigt_at: null,
    ist_faellig: true,
  };
  const erledigt = {
    ...basis,
    id: 8,
    titel: 'Ablöse erledigt',
    faellig_at: '2026-06-10 10:00:00',
    status: 'erledigt',
    erledigt_at: '2026-06-10 11:00:00',
    ist_faellig: false,
  };
  const quittiert = {
    ...basis,
    id: 9,
    titel: 'Zur Kenntnis',
    faellig_at: '2026-06-10 12:00:00',
    status: 'quittiert',
    erledigt_at: null,
    quittiert_at: '2026-06-10 12:30:00',
    ist_faellig: false,
  };
  return {
    ERINNERUNGEN_SEITE: 100,
    erinnerungCursor: (e: typeof quittiert) => ({
      zeit: e.erledigt_at ?? e.quittiert_at ?? e.erstellt_at,
      id: e.id,
    }),
    // Getrennte Abrufe (LFH-940): offene per Vorgabe, abgeschlossene in Server-Ordnung.
    listeOffeneErinnerungen: vi.fn().mockResolvedValue([offen]),
    listeAbgeschlosseneErinnerungen: vi.fn().mockResolvedValue([quittiert, erledigt]),
    ladeErinnerungKennzahlen: vi.fn().mockResolvedValue({ offen: 1, abgeschlossen: 2 }),
    legeErinnerungAn: vi.fn(),
    erledigeErinnerung: vi.fn(),
    quittiereErinnerung: vi.fn(),
    // Rückweg der beiden Abschluss-Aktionen. Fehlte der Eintrag, wäre der Import zur Laufzeit
    // `undefined`, und der Bruch fiele erst beim Klick auf „Rückgängig" auf.
    oeffneErinnerung: vi.fn(),
  };
});

/** Wechselt in einen anderen Einsatz, ohne die Seite neu einzuhängen (Route ohne `key`). */
function ZuEinsatz2() {
  const navigate = useNavigate();
  return (
    <button type="button" onClick={() => navigate('/einsaetze/2/erinnerungen')}>
      Zu Einsatz 2
    </button>
  );
}

/** Zeigt die aktuelle Adresse, damit ein Test das Räumen des Parameters sieht. */
function Ort() {
  const ort = useLocation();
  return <div data-testid="ort">{ort.pathname + ort.search}</div>;
}

function renderPage(
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } }),
  start = '/einsaetze/1/erinnerungen',
) {
  return render(
    <QueryClientProvider client={qc}>
      <AntApp>
        <MemoryRouter initialEntries={[start]}>
          <ZuEinsatz2 />
          <Ort />
          <Routes>
            <Route path="/einsaetze/:id/erinnerungen" element={<ErinnerungenPage />} />
          </Routes>
        </MemoryRouter>
      </AntApp>
    </QueryClientProvider>,
  );
}

describe('ErinnerungenPage', () => {
  beforeEach(() => vi.clearAllMocks());

  it('zeigt standardmäßig die offenen Erinnerungen, abgeschlossene erst nach Umschalten', async () => {
    renderPage();
    // Offen-Ansicht (Default): nur die offene Erinnerung.
    await waitFor(() => expect(screen.getByText('Lagemeldung')).toBeInTheDocument());
    expect(screen.queryByText('Ablöse erledigt')).not.toBeInTheDocument();
    expect(screen.queryByText('Zur Kenntnis')).not.toBeInTheDocument();

    // Segmented zeigt die Counts: 1 offen, 2 abgeschlossen (erledigt + quittiert).
    expect(screen.getByText('Offen (1)')).toBeInTheDocument();
    expect(screen.getByText('Abgeschlossen (2)')).toBeInTheDocument();

    // Die abgeschlossenen kommen erst mit ihrer Ansicht (LFH-940).
    expect(listeAbgeschlosseneErinnerungen).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('Abgeschlossen (2)'));
    expect(await screen.findByText('Ablöse erledigt')).toBeInTheDocument();
    expect(screen.getByText('Zur Kenntnis')).toBeInTheDocument();
    expect(screen.queryByText('Lagemeldung')).not.toBeInTheDocument();
    expect(listeOffeneErinnerungen).toHaveBeenCalledWith(1);
    // Eine kurze Seite ist die letzte: kein Nachladen.
    expect(screen.queryByRole('button', { name: 'Ältere laden' })).not.toBeInTheDocument();
  });

  it('lädt ältere abgeschlossene mit dem Cursor der letzten Zeile nach (LFH-940)', async () => {
    const seite = (von: number, n: number) =>
      Array.from({ length: n }, (_, i) => ({
        id: 1000 - von - i,
        einsatz_id: 1,
        titel: `Alt ${von + i}`,
        status: 'erledigt',
        faellig_at: '2026-06-10 10:00:00',
        erledigt_at: `2026-06-10 ${String(23 - Math.floor((von + i) / 60)).padStart(2, '0')}:${String(59 - ((von + i) % 60)).padStart(2, '0')}:00`,
        erstellt_at: '2026-06-10 09:00:00',
        quittiert_at: null,
        ist_faellig: false,
      })) as unknown as Erinnerung[];
    vi.mocked(listeAbgeschlosseneErinnerungen)
      .mockResolvedValueOnce(seite(0, 100))
      .mockResolvedValueOnce(seite(100, 3));
    vi.mocked(ladeErinnerungKennzahlen).mockResolvedValueOnce({ offen: 1, abgeschlossen: 103 });
    renderPage();
    await screen.findByText('Lagemeldung');
    fireEvent.click(await screen.findByText('Abgeschlossen (103)'));
    expect(await screen.findByText('Alt 0')).toBeInTheDocument();
    fireEvent.click(await screen.findByRole('button', { name: 'Ältere laden' }));
    expect(await screen.findByText('Alt 102')).toBeInTheDocument();
    const letzte = seite(99, 1)[0];
    expect(listeAbgeschlosseneErinnerungen).toHaveBeenLastCalledWith(1, {
      zeit: letzte.erledigt_at,
      id: letzte.id,
    });
    expect(screen.queryByRole('button', { name: 'Ältere laden' })).not.toBeInTheDocument();
  });

  it('hält höchstens fünf Seiten und führt über „Zu den neuesten springen“ zurück (LLH-1687)', async () => {
    const seite = (von: number, n: number) =>
      Array.from({ length: n }, (_, i) => ({
        id: 1000 - von - i,
        einsatz_id: 1,
        titel: `Alt ${von + i}`,
        status: 'erledigt',
        faellig_at: '2026-06-10 10:00:00',
        erledigt_at: `2026-06-10 ${String(23 - Math.floor((von + i) / 60)).padStart(2, '0')}:${String(59 - ((von + i) % 60)).padStart(2, '0')}:00`,
        erstellt_at: '2026-06-10 09:00:00',
        quittiert_at: null,
        ist_faellig: false,
      })) as unknown as Erinnerung[];
    // Die Vorgaben der Mocks gelten für die übrigen Tests der Datei (`clearAllMocks` setzt
    // Implementierungen nicht zurück): am Ende wiederherstellen.
    const listeVorher = vi.mocked(listeAbgeschlosseneErinnerungen).getMockImplementation();
    const zahlenVorher = vi.mocked(ladeErinnerungKennzahlen).getMockImplementation();
    onTestFinished(() => {
      vi.mocked(listeAbgeschlosseneErinnerungen).mockImplementation(listeVorher!);
      vi.mocked(ladeErinnerungKennzahlen).mockImplementation(zahlenVorher!);
    });
    // Seite n beginnt bei 100·n; der Kopf (ohne Cursor) ist Seite 0.
    vi.mocked(listeAbgeschlosseneErinnerungen).mockImplementation(async (_e, cursor) => {
      if (!cursor) return seite(0, 100);
      return seite(1000 - cursor.id + 1, 100);
    });
    vi.mocked(ladeErinnerungKennzahlen).mockResolvedValue({ offen: 1, abgeschlossen: 1000 });
    renderPage();
    await screen.findByText('Lagemeldung');
    fireEvent.click(await screen.findByText('Abgeschlossen (1000)'));
    expect(await screen.findByText('Alt 0')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Zu den neuesten springen' }),
    ).not.toBeInTheDocument();

    for (let n = 1; n <= 5; n++) {
      fireEvent.click(await screen.findByRole('button', { name: 'Ältere laden' }));
      expect(await screen.findByText(`Alt ${n * 100}`)).toBeInTheDocument();
    }
    // Die sechste Seite schob die neueste aus dem Fenster; ohne Kopf nennt die Zeile keine
    // Gesamtzahl, die Fensterlänge wäre keine Position.
    expect(screen.queryByText('Alt 0')).not.toBeInTheDocument();
    expect(screen.getByText('500 geladen')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ältere laden' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Zu den neuesten springen' }));
    expect(await screen.findByText('Alt 0')).toBeInTheDocument();
    expect(screen.queryByText('Alt 500')).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Zu den neuesten springen' }),
    ).not.toBeInTheDocument();
  }, 60_000);

  /** Beide Abschluss-Aktionen schalten mit dem ersten Klick; der Rückweg steht im Toast. */
  it('erledigt mit einem Klick und nimmt es über den Rückgängig-Knopf zurück', async () => {
    vi.mocked(erledigeErinnerung).mockResolvedValue(
      {} as Awaited<ReturnType<typeof erledigeErinnerung>>,
    );
    renderPage();
    await waitFor(() => expect(screen.getByText('Lagemeldung')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'Erledigt (durchgeführt)' }));
    await waitFor(() => expect(erledigeErinnerung).toHaveBeenCalledWith(1, 7));

    fireEvent.click(await screen.findByRole('button', { name: 'Rückgängig' }));
    await waitFor(() => expect(oeffneErinnerung).toHaveBeenCalledWith(1, 7));
  });

  it('erübrigt mit einem Klick und bietet denselben Rückweg an', async () => {
    vi.mocked(quittiereErinnerung).mockResolvedValue(
      {} as Awaited<ReturnType<typeof quittiereErinnerung>>,
    );
    renderPage();
    await waitFor(() => expect(screen.getByText('Lagemeldung')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'Erübrigt (zur Kenntnis)' }));
    await waitFor(() => expect(quittiereErinnerung).toHaveBeenCalledWith(1, 7));
    // Der Toast sagt, was geschah, im Wortlaut der Erinnerung (LFH-959).
    expect(await screen.findByText('Erinnerung erübrigt')).toBeInTheDocument();

    fireEvent.click(await screen.findByRole('button', { name: 'Rückgängig' }));
    await waitFor(() => expect(oeffneErinnerung).toHaveBeenCalledWith(1, 7));
  });
});

/**
 * Ablehnungen am Ort (LFH-1077, `frontend/AGENTS.md`, „Rückwege und Fehler“): Anlegen im Paneel,
 * Erledigt/Erübrigt an der Karte, Rückgängig im Seitenhinweis; kein Fehler-Toast.
 */
describe('ErinnerungenPage · Ablehnung am Ort (LFH-1077)', () => {
  beforeEach(() => vi.clearAllMocks());

  const karte = (titel: string) =>
    screen.getByText(titel).closest('[data-lfh="komm-karte"]') as HTMLElement;
  const seitenHinweis = () =>
    waitFor(() => {
      const h = document.querySelector<HTMLElement>('[data-lfh="seiten-beschreibung"]');
      expect(h).not.toBeNull();
      return h as HTMLElement;
    });
  const paneel = () => within(screen.getByRole('region', { name: 'Neue Erinnerung' }));

  async function legeAn() {
    await userEvent.click(screen.getByRole('button', { name: /Erinnerung anlegen/ }));
    await userEvent.type(paneel().getByLabelText('Titel'), 'Funkcheck');
    await userEvent.click(paneel().getByRole('button', { name: 'Anlegen' }));
  }

  it('Anlegen: der Grund steht im Paneel, die Eingabe bleibt, kein Toast', async () => {
    vi.mocked(legeErinnerungAn).mockRejectedValueOnce(new ApiError(422, 'Fälligkeit liegt zurück'));
    renderPage();
    await screen.findByText('Lagemeldung');
    await legeAn();

    const grund = await paneel().findByRole('alert');
    expect(grund).toHaveTextContent('Erinnerung nicht angelegt');
    expect(grund).toHaveTextContent('Fälligkeit liegt zurück');
    expect(paneel().getByLabelText('Titel')).toHaveValue('Funkcheck');
    expect(document.querySelectorAll('.ant-message-notice')).toHaveLength(0);
  });

  it('Anlegen: das nächste Absenden räumt den Grund', async () => {
    vi.mocked(legeErinnerungAn)
      .mockRejectedValueOnce(new ApiError(422, 'Fälligkeit liegt zurück'))
      .mockImplementationOnce(() => new Promise(() => {}));
    renderPage();
    await screen.findByText('Lagemeldung');
    await legeAn();
    await paneel().findByText('Fälligkeit liegt zurück');

    await userEvent.click(paneel().getByRole('button', { name: 'Anlegen' }));
    await waitFor(() => expect(legeErinnerungAn).toHaveBeenCalledTimes(2));
    expect(paneel().queryByText('Fälligkeit liegt zurück')).toBeNull();
    // Solange die Antwort aussteht, bleibt das Paneel offen.
    expect(paneel().getByRole('button', { name: 'Formular schließen' })).toBeDisabled();
  });

  it('Anlegen: Zuklappen und erneutes Öffnen zeigen keinen alten Grund', async () => {
    vi.mocked(legeErinnerungAn).mockRejectedValueOnce(new ApiError(422, 'Fälligkeit liegt zurück'));
    renderPage();
    await screen.findByText('Lagemeldung');
    await legeAn();
    await paneel().findByText('Fälligkeit liegt zurück');

    await userEvent.click(paneel().getByRole('button', { name: 'Formular schließen' }));
    await userEvent.click(screen.getByRole('button', { name: /Erinnerung anlegen/ }));
    expect(paneel().queryByRole('alert')).toBeNull();
  });

  it('Erledigt: der Grund steht an genau dieser Karte, kein Toast', async () => {
    vi.mocked(erledigeErinnerung).mockRejectedValueOnce(new ApiError(409, 'Bereits erledigt'));
    renderPage();
    await screen.findByText('Lagemeldung');
    await userEvent.click(
      within(karte('Lagemeldung')).getByRole('button', { name: 'Erledigt (durchgeführt)' }),
    );

    expect(await within(karte('Lagemeldung')).findByText('Bereits erledigt')).toHaveAttribute(
      'data-fehler',
    );
    expect(document.querySelectorAll('.ant-message-notice')).toHaveLength(0);
  });

  /** `useMutation` verfolgt nur den letzten Aufruf; der Grund kommt aus den Callbacks. */
  it('Erledigt: zwei Karten nebenläufig, die Ablehnung steht an ihrer Karte', async () => {
    const zweite = {
      id: 10,
      einsatz_id: 1,
      titel: 'Funkcheck',
      beschreibung: null,
      faellig_at: '2026-06-11 11:00:00',
      status: 'offen',
      ist_faellig: false,
      quelle: 'manuell',
      vollzug_status: 'offen',
    } as unknown as Erinnerung;
    const [erste] = await listeOffeneErinnerungen(1);
    vi.mocked(listeOffeneErinnerungen).mockResolvedValueOnce([erste, zweite]);
    let lehneAb: (e: Error) => void = () => {};
    vi.mocked(erledigeErinnerung).mockImplementation((_e, eid) =>
      eid === 7
        ? new Promise((_r, reject) => (lehneAb = reject))
        : Promise.resolve({} as Awaited<ReturnType<typeof erledigeErinnerung>>),
    );
    renderPage();
    await screen.findByText('Funkcheck');
    await userEvent.click(
      within(karte('Lagemeldung')).getByRole('button', { name: 'Erledigt (durchgeführt)' }),
    );
    await userEvent.click(
      within(karte('Funkcheck')).getByRole('button', { name: 'Erledigt (durchgeführt)' }),
    );
    await waitFor(() => expect(erledigeErinnerung).toHaveBeenCalledTimes(2));
    await act(async () => lehneAb(new ApiError(409, 'Bereits erledigt')));

    expect(await within(karte('Lagemeldung')).findByText('Bereits erledigt')).toHaveAttribute(
      'data-fehler',
    );
    expect(document.querySelectorAll('[data-fehler]')).toHaveLength(1);
    // Die zweite Karte hat Erfolg und damit ihren Rückgängig-Toast; ein Fehler-Toast fehlt.
    expect(document.querySelectorAll('.ant-message-error')).toHaveLength(0);
    vi.mocked(erledigeErinnerung).mockReset();
  });

  it('Erübrigt nach abgelehntem Erledigt räumt den Grund an der Karte', async () => {
    vi.mocked(erledigeErinnerung).mockRejectedValueOnce(new ApiError(409, 'Bereits erledigt'));
    vi.mocked(quittiereErinnerung).mockImplementationOnce(() => new Promise(() => {}));
    renderPage();
    await screen.findByText('Lagemeldung');
    await userEvent.click(
      within(karte('Lagemeldung')).getByRole('button', { name: 'Erledigt (durchgeführt)' }),
    );
    await within(karte('Lagemeldung')).findByText('Bereits erledigt');

    await userEvent.click(
      within(karte('Lagemeldung')).getByRole('button', { name: 'Erübrigt (zur Kenntnis)' }),
    );
    await waitFor(() => expect(quittiereErinnerung).toHaveBeenCalledTimes(1));
    expect(within(karte('Lagemeldung')).queryByText('Bereits erledigt')).toBeNull();
  });

  it('Erledigt: nach Ansichtswechsel vor der Antwort steht der Grund im Seitenhinweis', async () => {
    let lehneAb: (e: Error) => void = () => {};
    vi.mocked(erledigeErinnerung).mockImplementationOnce(
      () => new Promise((_r, reject) => (lehneAb = reject)),
    );
    renderPage();
    await screen.findByText('Lagemeldung');
    await userEvent.click(screen.getByRole('button', { name: 'Erledigt (durchgeführt)' }));
    await userEvent.click(screen.getByText('Abgeschlossen (2)'));
    await screen.findByText('Ablöse erledigt');
    await act(async () => lehneAb(new ApiError(409, 'Bereits erledigt')));

    const grund = await within(await seitenHinweis()).findByRole('alert');
    expect(grund).toHaveTextContent('„Lagemeldung“ nicht geändert');
    expect(grund).toHaveTextContent('Bereits erledigt');
    expect(document.querySelectorAll('.ant-message-notice')).toHaveLength(0);

    // Zurück in der Ansicht der Karte steht er an ihr, nicht doppelt oben.
    await userEvent.click(screen.getByText('Offen (1)'));
    expect(await within(karte('Lagemeldung')).findByText('Bereits erledigt')).toHaveAttribute(
      'data-fehler',
    );
    expect(document.querySelector('[data-lfh="seiten-beschreibung"] [role="alert"]')).toBeNull();
  });

  /** Gewandert in „Abgeschlossen“ hat die Karte keine Aktion mehr, die den Grund räumte. */
  it('Erledigt: wandert die Karte nach der Ablehnung, lässt sich der Hinweis schließen', async () => {
    vi.mocked(erledigeErinnerung).mockRejectedValueOnce(new ApiError(409, 'Bereits erledigt'));
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    renderPage(qc);
    await screen.findByText('Lagemeldung');
    const [lage] = await listeOffeneErinnerungen(1);
    const frueher = await listeAbgeschlosseneErinnerungen(1);
    await userEvent.click(screen.getByRole('button', { name: 'Erledigt (durchgeführt)' }));
    await within(karte('Lagemeldung')).findByText('Bereits erledigt');

    // Ein fremder Abschluss kommt als Ereignis an: die Karte steht nun unter „Abgeschlossen“.
    const erledigt = { ...lage, status: 'erledigt', erledigt_at: '2026-06-11 10:30:00' };
    vi.mocked(listeOffeneErinnerungen).mockResolvedValueOnce([]);
    vi.mocked(listeAbgeschlosseneErinnerungen).mockResolvedValueOnce([
      erledigt as Erinnerung,
      ...frueher,
    ]);
    vi.mocked(ladeErinnerungKennzahlen).mockResolvedValueOnce({ offen: 0, abgeschlossen: 3 });
    await act(() => qc.invalidateQueries());

    const hinweis = await seitenHinweis();
    const grund = await within(hinweis).findByRole('alert');
    expect(grund).toHaveTextContent('„Lagemeldung“ nicht geändert');
    expect(grund).toHaveTextContent('Bereits erledigt');

    await userEvent.click(within(hinweis).getByRole('button', { name: 'Hinweis schließen' }));
    await waitFor(() =>
      expect(document.querySelector('[data-lfh="seiten-beschreibung"] [role="alert"]')).toBeNull(),
    );
    // Verworfen, nicht nur ausgeblendet: auch an der Karte steht er nicht mehr.
    await userEvent.click(screen.getByText('Abgeschlossen (3)'));
    await screen.findByText('Ablöse erledigt');
    expect(within(karte('Lagemeldung')).queryByText('Bereits erledigt')).toBeNull();
    expect(document.querySelector('[data-lfh="seiten-beschreibung"] [role="alert"]')).toBeNull();
  });

  it('Erledigt: alle Gründe ohne gezeigte Karte stehen im Seitenhinweis', async () => {
    const zweite = {
      id: 10,
      einsatz_id: 1,
      titel: 'Funkcheck',
      beschreibung: null,
      faellig_at: '2026-06-11 11:00:00',
      status: 'offen',
      ist_faellig: false,
      quelle: 'manuell',
      vollzug_status: 'offen',
    } as unknown as Erinnerung;
    const [erste] = await listeOffeneErinnerungen(1);
    vi.mocked(listeOffeneErinnerungen).mockResolvedValueOnce([erste, zweite]);
    vi.mocked(erledigeErinnerung)
      .mockRejectedValueOnce(new ApiError(409, 'Bereits erledigt'))
      .mockRejectedValueOnce(new ApiError(409, 'Schon erübrigt'));
    renderPage();
    await screen.findByText('Funkcheck');
    await userEvent.click(
      within(karte('Lagemeldung')).getByRole('button', { name: 'Erledigt (durchgeführt)' }),
    );
    await userEvent.click(
      within(karte('Funkcheck')).getByRole('button', { name: 'Erledigt (durchgeführt)' }),
    );
    await within(karte('Funkcheck')).findByText('Schon erübrigt');

    await userEvent.click(screen.getByText('Abgeschlossen (2)'));
    await screen.findByText('Ablöse erledigt');
    const grund = await within(await seitenHinweis()).findByRole('alert');
    expect(grund).toHaveTextContent('„Lagemeldung“ · Bereits erledigt');
    expect(grund).toHaveTextContent('„Funkcheck“ · Schon erübrigt');
  });

  it('Erledigt: solange die andere Ansicht lädt, springt kein Grund in den Seitenhinweis', async () => {
    vi.mocked(erledigeErinnerung).mockRejectedValueOnce(new ApiError(409, 'Bereits erledigt'));
    renderPage();
    await screen.findByText('Lagemeldung');
    await userEvent.click(screen.getByRole('button', { name: 'Erledigt (durchgeführt)' }));
    await within(karte('Lagemeldung')).findByText('Bereits erledigt');

    const frueher = await listeAbgeschlosseneErinnerungen(1);
    let liefere: (l: Erinnerung[]) => void = () => {};
    vi.mocked(listeAbgeschlosseneErinnerungen).mockImplementationOnce(
      () => new Promise((r) => (liefere = r)),
    );
    await userEvent.click(screen.getByText('Abgeschlossen (2)'));
    await waitFor(() => expect(listeAbgeschlosseneErinnerungen).toHaveBeenCalledTimes(2));
    expect(document.querySelector('[data-lfh="seiten-beschreibung"] [role="alert"]')).toBeNull();

    await act(async () => liefere(frueher));
    const grund = await within(await seitenHinweis()).findByRole('alert');
    expect(grund).toHaveTextContent('Bereits erledigt');
  });

  it('Rückgängig: abgelehnte Rücknahme im Seitenhinweis, die nächste räumt', async () => {
    vi.mocked(erledigeErinnerung).mockResolvedValue(
      {} as Awaited<ReturnType<typeof erledigeErinnerung>>,
    );
    vi.mocked(oeffneErinnerung)
      .mockRejectedValueOnce(new ApiError(409, 'Schon wieder offen'))
      .mockImplementationOnce(() => new Promise(() => {}));
    renderPage();
    await screen.findByText('Lagemeldung');
    await userEvent.click(screen.getByRole('button', { name: 'Erledigt (durchgeführt)' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Rückgängig' }));

    const grund = await within(await seitenHinweis()).findByRole('alert');
    expect(grund).toHaveTextContent('Nicht wieder geöffnet');
    expect(grund).toHaveTextContent('Schon wieder offen');
    expect(document.querySelectorAll('[data-fehler]')).toHaveLength(0);
    expect(document.querySelectorAll('.ant-message-error')).toHaveLength(0);

    await userEvent.click(screen.getByRole('button', { name: 'Erledigt (durchgeführt)' }));
    const rueckgaengig = await screen.findAllByRole('button', { name: 'Rückgängig' });
    await userEvent.click(rueckgaengig[rueckgaengig.length - 1]);
    await waitFor(() => expect(oeffneErinnerung).toHaveBeenCalledTimes(2));
    expect(screen.queryByText('Schon wieder offen')).toBeNull();
    vi.mocked(erledigeErinnerung).mockReset();
  });

  it('meldet Ablehnungen aus dem vorigen Einsatz nicht im neuen', async () => {
    let lehneErledigtAb: (e: Error) => void = () => {};
    let lehneAnlegenAb: (e: Error) => void = () => {};
    vi.mocked(erledigeErinnerung).mockImplementationOnce(
      () => new Promise((_r, reject) => (lehneErledigtAb = reject)),
    );
    vi.mocked(legeErinnerungAn).mockImplementationOnce(
      () => new Promise((_r, reject) => (lehneAnlegenAb = reject)),
    );
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    renderPage(qc);
    await screen.findByText('Lagemeldung');
    await userEvent.click(screen.getByRole('button', { name: 'Erledigt (durchgeführt)' }));
    await legeAn();
    await waitFor(() => expect(legeErinnerungAn).toHaveBeenCalledTimes(1));

    await userEvent.click(screen.getByRole('button', { name: 'Zu Einsatz 2' }));
    await waitFor(() => expect(listeOffeneErinnerungen).toHaveBeenCalledWith(2));
    act(() => {
      lehneErledigtAb(new ApiError(409, 'Bereits erledigt'));
      lehneAnlegenAb(new ApiError(422, 'Fälligkeit liegt zurück'));
    });
    // Erst prüfen, wenn beide Ablehnungen angekommen sind und die Beobachter sie gesehen haben.
    await waitFor(() =>
      expect(
        qc.getMutationCache().findAll({ predicate: (m) => m.state.status === 'error' }),
      ).toHaveLength(2),
    );
    await act(() => new Promise((r) => setTimeout(r, 20)));
    await screen.findByText('Lagemeldung');
    expect(screen.queryByText('Bereits erledigt')).toBeNull();
    expect(screen.queryByText('Fälligkeit liegt zurück')).toBeNull();
    // Das laufende Anlegen des vorigen Einsatzes hält das Paneel hier nicht offen.
    expect(paneel().getByRole('button', { name: 'Formular schließen' })).toBeEnabled();
  });
});

describe('ErinnerungenPage · Sprung ?erinnerung= (LLH-1429)', () => {
  beforeEach(() => vi.clearAllMocks());

  /** Die Karte einer Erinnerung, sobald sie im DOM steht. */
  const karteVon = (id: number) =>
    waitFor(() => {
      const k = document.querySelector(`[data-erinnerung-id="${id}"]`);
      expect(k).not.toBeNull();
      return k as HTMLElement;
    });

  it('?erinnerung= auf eine offene hebt ihre Karte hervor, rollt sie ins Bild und räumt den Parameter (LLH-1429)', async () => {
    const scroll = vi.fn();
    const vorher = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = scroll;
    try {
      renderPage(undefined, erinnerungenPfad(1, { erinnerung: 7 }));
      const karte = await karteVon(7);
      expect(karte).toHaveAttribute('data-hervorgehoben', 'true');
      await waitFor(() => expect(scroll).toHaveBeenCalled());
      expect(scroll.mock.contexts[0]).toBe(karte);
      await waitFor(() =>
        expect(screen.getByTestId('ort')).toHaveTextContent(/^\/einsaetze\/1\/erinnerungen$/),
      );
      // Die abgeschlossenen braucht der Sprung auf eine offene nicht.
      expect(listeAbgeschlosseneErinnerungen).not.toHaveBeenCalled();
    } finally {
      Element.prototype.scrollIntoView = vorher;
    }
  });

  it('?erinnerung= auf eine abgeschlossene wechselt in ihre Ansicht und hebt nur sie hervor (LLH-1429)', async () => {
    renderPage(undefined, erinnerungenPfad(1, { erinnerung: 9 }));
    const karte = await karteVon(9);
    expect(karte).toHaveAttribute('data-hervorgehoben', 'true');
    expect(screen.getByText('Zur Kenntnis')).toBeInTheDocument();
    expect(screen.queryByText('Lagemeldung')).not.toBeInTheDocument();
    expect(document.querySelector('[data-erinnerung-id="8"]')).not.toHaveAttribute(
      'data-hervorgehoben',
    );
    await waitFor(() =>
      // Der Sprung räumt `?erinnerung=`, die Ansicht bleibt Zustand der Adresse (LLH-1826).
      expect(screen.getByTestId('ort')).toHaveTextContent(
        /^\/einsaetze\/1\/erinnerungen\?sicht=abgeschlossen$/,
      ),
    );
  });

  // Review a12ms7g9 (F5): ein alter Stand der offenen im Cache kennt eine eben angelegte
  // Erinnerung nicht. Der erste Schritt wartet auf die frische Antwort, statt in die abgeschlossenen
  // zu suchen und „gibt es nicht“ zu melden.
  it('?erinnerung= mit altem Stand im Cache: kein Hinweis, die Karte der frischen Antwort ist hervorgehoben', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    qc.setQueryData(einsatzKeys.erinnerungenPhase(1, 'offen'), [], { updatedAt: 0 });
    // Der Einsatz frisch im Cache: sonst wartete der Sprung schon auf ihn.
    qc.setQueryData(einsatzKeys.einsatz(1), {
      id: 1,
      bezeichnung: 'Hochwasser',
      status: 'aktiv',
      meine_rolle: 'einsatzleitung',
    });
    renderPage(qc, erinnerungenPfad(1, { erinnerung: 7 }));
    const karte = await karteVon(7);
    await waitFor(() => expect(karte).toHaveAttribute('data-hervorgehoben', 'true'));
    await waitFor(() =>
      expect(screen.getByTestId('ort')).toHaveTextContent(/^\/einsaetze\/1\/erinnerungen$/),
    );
    await act(() => new Promise((r) => setTimeout(r, 20)));
    expect(screen.queryByText(/gibt es nicht \(mehr\)/)).toBeNull();
    expect(listeAbgeschlosseneErinnerungen).not.toHaveBeenCalled();
  });

  it('?erinnerung= mit unbekannter Kennung: Ansicht und Hervorhebung bleiben, der Parameter wird geräumt, der Hinweis steht (LLH-1429, LLH-1827)', async () => {
    renderPage(undefined, erinnerungenPfad(1, { erinnerung: 99 }));
    await screen.findByText('Lagemeldung');
    await waitFor(() =>
      expect(screen.getByTestId('ort')).toHaveTextContent(/^\/einsaetze\/1\/erinnerungen$/),
    );
    await waitFor(() => expect(listeAbgeschlosseneErinnerungen).toHaveBeenCalled());
    await act(() => new Promise((r) => setTimeout(r, 20)));
    expect(screen.getByText('Lagemeldung')).toBeInTheDocument();
    expect(screen.queryByText('Zur Kenntnis')).not.toBeInTheDocument();
    expect(document.querySelector('[data-hervorgehoben="true"]')).toBeNull();
    expect(screen.getByText('Erinnerung #99 gibt es nicht (mehr)')).toBeInTheDocument();
  });
});

/** LLH-1826: die Ansicht steht in der Adresse und überlebt Weg und Zurück. */
describe('ErinnerungenPage — Ansicht in der Adresse (LLH-1826)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('die Wahl „Abgeschlossen“ steht in der Adresse', async () => {
    renderPage();
    await userEvent.click(await screen.findByRole('radio', { name: /^Abgeschlossen/ }));
    await waitFor(() =>
      expect(screen.getByTestId('ort')).toHaveTextContent(
        '/einsaetze/1/erinnerungen?sicht=abgeschlossen',
      ),
    );
  });

  it('?sicht=abgeschlossen zeigt die abgeschlossenen', async () => {
    renderPage(undefined, '/einsaetze/1/erinnerungen?sicht=abgeschlossen');
    expect(await screen.findByRole('radio', { name: /^Abgeschlossen/ })).toBeChecked();
  });
});

/**
 * LLH-1959 (Muster aus LLH-1823): Beim ersten Laden und bei einem gescheiterten Abruf ist die Lage
 * unbekannt, nicht leer. „0 offen“, „Offen (0)“ und „Keine Erinnerungen“ wären eine falsche Aussage.
 */
describe('ErinnerungenPage · Laden und Fehler ohne Bestand (LLH-1959)', () => {
  const OHNE_PLATZHALTER = 'script, style, [data-lfh="meta-platzhalter"]';

  beforeEach(() => {
    vi.clearAllMocks();
    setzeOnline(true);
    onTestFinished(() => setzeOnline(true));
  });

  it('zeigt beim ersten Laden das Skelett, keine Null und keinen Leerzustand', async () => {
    vi.mocked(listeOffeneErinnerungen).mockImplementationOnce(() => new Promise(() => {}));
    vi.mocked(ladeErinnerungKennzahlen).mockImplementationOnce(() => new Promise(() => {}));
    renderPage();
    expect(await screen.findByLabelText('Inhalt wird geladen')).toBeInTheDocument();
    expect(screen.queryByText('Keine Erinnerungen')).not.toBeInTheDocument();
    expect(screen.queryByText(/0 offen/, { ignore: OHNE_PLATZHALTER })).not.toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Offen' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Abgeschlossen' })).toBeInTheDocument();
  });

  it('zeigt bei 500 den Abruffehler mit „Erneut abrufen“ und „—“ im Kopf', async () => {
    vi.mocked(listeOffeneErinnerungen).mockRejectedValueOnce(new ApiError(500, 'Interner Fehler'));
    vi.mocked(ladeErinnerungKennzahlen).mockRejectedValueOnce(new ApiError(500, 'Interner Fehler'));
    renderPage();
    expect(
      await screen.findByText('Erinnerungen konnten nicht geladen werden'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Erneut abrufen' })).toBeInTheDocument();
    expect(screen.queryByText('Keine Erinnerungen')).not.toBeInTheDocument();
    expect(screen.queryByText(/\b0 offen/, { ignore: OHNE_PLATZHALTER })).not.toBeInTheDocument();
    expect(screen.getByText('— offen · — abgeschlossen')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Offen' })).toBeInTheDocument();

    // Erneut abrufen holt die Liste; danach steht sie normal da.
    await userEvent.click(screen.getByRole('button', { name: 'Erneut abrufen' }));
    expect(await screen.findByText('Lagemeldung')).toBeInTheDocument();
  });

  it('zeigt bei einem Fehler mit Bestand die Karten und den veralteten Stand', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    renderPage(client);
    await screen.findByText('Lagemeldung');
    vi.mocked(listeOffeneErinnerungen).mockRejectedValueOnce(new ApiError(500, 'Interner Fehler'));
    await act(() => client.refetchQueries({ queryKey: einsatzKeys.erinnerungenPhase(1, 'offen') }));
    expect(
      await screen.findByText('Aktualisierung fehlgeschlagen · Stand womöglich veraltet'),
    ).toBeInTheDocument();
    expect(screen.getByText('Lagemeldung')).toBeInTheDocument();
  });

  it('zeigt ohne Netz und ohne Stand den Abruffehler mit „Erneut abrufen“ und „—“ im Kopf', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryDefaults(einsatzKeys.einsatz(1), { staleTime: Infinity });
    client.setQueryData(einsatzKeys.einsatz(1), await ladeEinsatz(1));
    setzeOnline(false);
    renderPage(client);
    expect(
      await screen.findByText('Erinnerungen konnten nicht geladen werden'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Erneut abrufen' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Inhalt wird geladen')).not.toBeInTheDocument();
    expect(screen.getByText('— offen · — abgeschlossen')).toBeInTheDocument();
  });

  it('zeigt im Normalfall Zahlen in Kopf und Segmenten wie bisher', async () => {
    renderPage();
    await screen.findByText('Lagemeldung');
    expect(screen.getByText('1 offen · 2 abgeschlossen')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Offen (1)' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Abgeschlossen (2)' })).toBeInTheDocument();
  });
});
