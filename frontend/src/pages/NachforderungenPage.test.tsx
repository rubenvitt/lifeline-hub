import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App as AntApp } from 'antd';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router';
import NachforderungenPage from './NachforderungenPage';
import { AuthProvider } from '../auth/AuthContext';
import { ladeEinsatz } from '../api/einsaetze';
import { nachforderungenPfad } from '../routing/deeplinks';
import type { Nachforderung } from '../api/types';

vi.mock('../api/einsaetze', () => ({
  ladeEinsatz: vi.fn().mockResolvedValue({
    id: 1,
    bezeichnung: 'Lage',
    status: 'aktiv',
    meine_rolle: 'einsatzleitung',
  }),
}));

const listeNachforderungen = vi.fn();
const legeNachforderungAn = vi.fn();
const setzeNachforderungStatus = vi.fn();
const lehneNachforderungAb = vi.fn();
vi.mock('../api/nachforderungen', () => ({
  listeNachforderungen: (...a: unknown[]) => listeNachforderungen(...a),
  legeNachforderungAn: (...a: unknown[]) => legeNachforderungAn(...a),
  setzeNachforderungStatus: (...a: unknown[]) => setzeNachforderungStatus(...a),
  lehneNachforderungAb: (...a: unknown[]) => lehneNachforderungAb(...a),
}));

const nf = (over: Partial<Nachforderung> = {}): Nachforderung => ({
  id: 1,
  einsatz_id: 1,
  art: 'RTW',
  bezeichnung: '2 RTW zur Verstärkung',
  anzahl: 2,
  adressat_kategorie: 'leitstelle',
  adressat_bezeichnung: 'Leitstelle Nord',
  begruendung: null,
  prioritaet: 'dringend',
  status: 'angefordert',
  zugesagt_at: null,
  unterwegs_at: null,
  eingetroffen_at: null,
  abgelehnt_at: null,
  abgelehnt_grund: null,
  angefordert_at: '2026-06-12 09:00:00',
  etb_nachforderung_id: 7,
  erstellt_von_id: 1,
  erstellt_at: '2026-06-12 09:00:00',
  erstellt_von_name: 'Leit',
  ist_offen: true,
  ...over,
});

/** Spiegelt die aktuelle Adresse, damit ein Test das Räumen der URL sehen kann. */
function OrtSonde() {
  const ort = useLocation();
  return <output data-testid="ort">{ort.pathname + ort.search}</output>;
}

function renderPage(url = '/einsaetze/1/nachforderungen') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <AntApp>
        <AuthProvider>
          <MemoryRouter initialEntries={[url]}>
            <Routes>
              <Route
                path="/einsaetze/:id/nachforderungen"
                element={
                  <>
                    <NachforderungenPage />
                    <OrtSonde />
                  </>
                }
              />
            </Routes>
          </MemoryRouter>
        </AuthProvider>
      </AntApp>
    </QueryClientProvider>,
  );
}

describe('NachforderungenPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listeNachforderungen.mockResolvedValue([nf()]);
  });

  it('zeigt offene Nachforderungen', async () => {
    renderPage();
    expect(await screen.findByText('2 RTW zur Verstärkung')).toBeInTheDocument();
    expect(
      screen.getByText('Angefordert', { selector: '[data-lfh="status-chip"] span' }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText(/^Datenstand \d{2}:\d{2}$/)).toBeInTheDocument();
  });

  it('setzt eine Nachforderung ab', async () => {
    legeNachforderungAn.mockResolvedValue(nf());
    renderPage();
    await screen.findByText('2 RTW zur Verstärkung');
    // Formular liegt jetzt hinter dem Kopf-Toggle (LFH-112) → erst aufklappen.
    await userEvent.click(screen.getByRole('button', { name: /Nachforderung anlegen/ }));
    await userEvent.type(screen.getByLabelText('Art'), 'SEG');
    await userEvent.type(screen.getByLabelText('Bezeichnung'), 'Eine SEG');
    await userEvent.click(screen.getByRole('button', { name: 'Nachforderung absetzen' }));
    await waitFor(() =>
      expect(legeNachforderungAn).toHaveBeenCalledWith(
        1,
        expect.objectContaining({
          art: 'SEG',
          bezeichnung: 'Eine SEG',
          adressat_kategorie: 'leitstelle',
        }),
      ),
    );
  });

  /**
   * Vorher öffnete der Knopf einen `Popconfirm`, und erst dessen „Bestätigen"
   * schaltete. Seit LFH-343 · C8 schaltet der erste Klick — der Rückweg steht im
   * Rückgängig-Toast, und `uebergang_erlaubt` nimmt seit derselben Änderung die
   * Rücknahme um eine Stufe an.
   */
  it('schaltet den Status mit EINEM Klick linear weiter', async () => {
    setzeNachforderungStatus.mockResolvedValue(nf({ status: 'zugesagt' }));
    renderPage();
    await screen.findByText('2 RTW zur Verstärkung');
    await userEvent.click(screen.getByRole('button', { name: '→ Zugesagt' }));
    await waitFor(() => expect(setzeNachforderungStatus).toHaveBeenCalledWith(1, 1, 'zugesagt'));
    expect(document.querySelector('.ant-popconfirm')).toBeNull();
  });

  it('bietet den Rückweg als Rückgängig-Knopf an und nimmt genau eine Stufe zurück', async () => {
    setzeNachforderungStatus.mockResolvedValue(nf({ status: 'zugesagt' }));
    renderPage();
    await screen.findByText('2 RTW zur Verstärkung');
    await userEvent.click(screen.getByRole('button', { name: '→ Zugesagt' }));
    await waitFor(() => expect(setzeNachforderungStatus).toHaveBeenCalledTimes(1));

    await userEvent.click(await screen.findByRole('button', { name: 'Rückgängig' }));
    // Zurück auf den Zustand VOR dem Klick — nicht auf den Anfang der Kette.
    await waitFor(() =>
      expect(setzeNachforderungStatus).toHaveBeenLastCalledWith(1, 1, 'angefordert'),
    );
  });

  it('lehnt eine Nachforderung mit Grund ab (über Dialog)', async () => {
    lehneNachforderungAb.mockResolvedValue(nf({ status: 'abgelehnt' }));
    renderPage();
    await screen.findByText('2 RTW zur Verstärkung');
    // Listen-Aktion „Ablehnen" (link-button) öffnet das Modal.
    await userEvent.click(screen.getByRole('button', { name: 'Ablehnen' }));
    // Dialog öffnet: Grund erfassen und bestätigen. „Ablehnen" existiert nun
    // doppelt (Listen-Aktion + Modal-OK) → im Dialog scopen.
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText('Ablehnungsgrund'), 'keine Reserven');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Ablehnen' }));
    await waitFor(() => expect(lehneNachforderungAb).toHaveBeenCalledWith(1, 1, 'keine Reserven'));
  });

  it('trennt Offen und Abgeschlossen clientseitig', async () => {
    // Eine offene + eine eingetroffene Nachforderung in EINER Antwort (kein Status-Filter mehr).
    listeNachforderungen.mockResolvedValue([
      nf({ id: 1, bezeichnung: '2 RTW zur Verstärkung', status: 'angefordert', ist_offen: true }),
      nf({
        id: 2,
        bezeichnung: 'Eingetroffene SEG',
        status: 'eingetroffen',
        ist_offen: false,
        eingetroffen_at: '2026-06-12 10:00:00',
      }),
    ]);
    renderPage();
    // Default = Offen: nur die offene ist sichtbar.
    expect(await screen.findByText('2 RTW zur Verstärkung')).toBeInTheDocument();
    expect(screen.queryByText('Eingetroffene SEG')).not.toBeInTheDocument();
    // Page lädt alle (ohne Status-Filter).
    expect(listeNachforderungen).toHaveBeenCalledWith(1, {});
    // Auf Abgeschlossen wechseln → eingetroffene erscheint, offene verschwindet.
    await userEvent.click(screen.getByText(/Abgeschlossen \(/));
    expect(await screen.findByText('Eingetroffene SEG')).toBeInTheDocument();
    expect(screen.queryByText('2 RTW zur Verstärkung')).not.toBeInTheDocument();
  });

  it('eingetroffene Nachforderung zeigt keine Aktionen', async () => {
    listeNachforderungen.mockResolvedValue([
      nf({ status: 'eingetroffen', ist_offen: false, eingetroffen_at: '2026-06-12 10:00:00' }),
    ]);
    renderPage();
    // Eingetroffen landet in der Abgeschlossen-Ansicht → dorthin wechseln.
    await userEvent.click(await screen.findByText(/Abgeschlossen \(/));
    await screen.findByText('2 RTW zur Verstärkung');
    expect(screen.queryByRole('button', { name: 'Ablehnen' })).not.toBeInTheDocument();
    expect(
      screen.getByText('Eingetroffen', { selector: '[data-lfh="status-chip"] span' }),
    ).toBeInTheDocument();
  });

  describe('Vorbelegung per Deeplink (LFH-634)', () => {
    const vorbelegung = {
      art: 'Verpflegung',
      bezeichnung: 'Essensportionen \u201aMittag\u2018 12:00\u201313:30',
      anzahl: 20,
      begruendung: 'Unterdeckung Verpflegung \u201aMittag\u2018: Bedarf 250, ausgegeben 230.',
    };
    const deeplink = nachforderungenPfad(1, { vorbelegung });

    const begruendungFeld = () => screen.getByLabelText('Begründung / Lagebezug');

    it('öffnet die Erfassung vorbelegt und räumt die Adresse', async () => {
      renderPage(deeplink);
      expect(await screen.findByLabelText('Art')).toHaveValue('Verpflegung');
      expect(screen.getByLabelText('Bezeichnung')).toHaveValue(vorbelegung.bezeichnung);
      expect(screen.getByLabelText('Anzahl')).toHaveValue('20');
      expect(begruendungFeld()).toHaveValue(vorbelegung.begruendung);
      await waitFor(() =>
        expect(screen.getByTestId('ort')).toHaveTextContent(/^\/einsaetze\/1\/nachforderungen$/),
      );
    });

    it('ein Neuladen mit der geräumten Adresse öffnet nichts', async () => {
      const erster = renderPage(deeplink);
      await screen.findByLabelText('Art');
      await waitFor(() => expect(screen.getByTestId('ort').textContent).not.toContain('?'));
      const geraeumt = screen.getByTestId('ort').textContent ?? '';
      erster.unmount();

      renderPage(geraeumt);
      await screen.findByText('2 RTW zur Verstärkung');
      expect(screen.queryByLabelText('Art')).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Nachforderung anlegen/ })).toBeInTheDocument();
    });

    it('eine unbrauchbare Vorbelegung wird ganz verworfen, die Erfassung öffnet leer', async () => {
      // Art ist brauchbar, die Anzahl nicht — die Art darf trotzdem NICHT übernommen werden.
      renderPage(deeplink.replace('anzahl=20', 'anzahl=0'));
      expect(await screen.findByLabelText('Art')).toHaveValue('');
      expect(screen.getByLabelText('Bezeichnung')).toHaveValue('');
      expect(screen.getByLabelText('Anzahl')).toHaveValue('');
      expect(begruendungFeld()).toHaveValue('');
      await waitFor(() =>
        expect(screen.getByTestId('ort')).toHaveTextContent(/^\/einsaetze\/1\/nachforderungen$/),
      );
    });

    it('nach dem Absetzen füllt sich die Erfassung NICHT erneut mit der Vorbelegung', async () => {
      legeNachforderungAn.mockResolvedValue(nf());
      renderPage(deeplink);
      expect(await screen.findByLabelText('Art')).toHaveValue('Verpflegung');
      await userEvent.click(screen.getByRole('button', { name: 'Nachforderung absetzen' }));
      await waitFor(() =>
        expect(legeNachforderungAn).toHaveBeenCalledWith(
          1,
          expect.objectContaining({ art: 'Verpflegung', anzahl: 20 }),
        ),
      );
      // Eine wieder vorbelegte Maske stünde einen Druck vor der Dublette.
      await waitFor(() => expect(screen.getByLabelText('Art')).toHaveValue(''));
      expect(screen.getByLabelText('Anzahl')).toHaveValue('');
      expect(begruendungFeld()).toHaveValue('');
    });

    it('Schließen und erneutes Öffnen zeigt eine leere Erfassung', async () => {
      renderPage(deeplink);
      expect(await screen.findByLabelText('Art')).toHaveValue('Verpflegung');
      await userEvent.click(screen.getByRole('button', { name: 'Formular schließen' }));
      await waitFor(() => expect(screen.queryByLabelText('Art')).not.toBeInTheDocument());
      await userEvent.click(screen.getByRole('button', { name: /Nachforderung anlegen/ }));
      expect(await screen.findByLabelText('Art')).toHaveValue('');
      expect(screen.getByLabelText('Anzahl')).toHaveValue('');
    });

    it('ohne Schreibrecht öffnet nichts, die Adresse wird trotzdem geräumt', async () => {
      vi.mocked(ladeEinsatz).mockResolvedValueOnce({
        id: 1,
        bezeichnung: 'Lage',
        status: 'aktiv',
        meine_rolle: 'beobachter',
      } as Awaited<ReturnType<typeof ladeEinsatz>>);
      renderPage(deeplink);
      await screen.findByText('2 RTW zur Verstärkung');
      await waitFor(() =>
        expect(screen.getByTestId('ort')).toHaveTextContent(/^\/einsaetze\/1\/nachforderungen$/),
      );
      expect(screen.queryByLabelText('Art')).not.toBeInTheDocument();
    });
  });
});
