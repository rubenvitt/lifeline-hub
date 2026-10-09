import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Routes, Route, useNavigate } from 'react-router';
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

function renderPage(qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
  return render(
    <QueryClientProvider client={qc}>
      <AntApp>
        <MemoryRouter initialEntries={['/einsaetze/1/erinnerungen']}>
          <ZuEinsatz2 />
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
