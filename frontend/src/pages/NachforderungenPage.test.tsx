import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App as AntApp } from 'antd';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router';
import NachforderungenPage from './NachforderungenPage';
import { AuthProvider } from '../auth/AuthContext';
import { ApiError } from '../api/client';
import { ladeEinsatz } from '../api/einsaetze';
import { nachforderungenPfad } from '../routing/deeplinks';
import { einsatzKeys } from '../api/queryKeys';
import type { EinsatzMaterial, Nachforderung } from '../api/types';
import { http, HttpResponse } from 'msw';
import { server } from '../test/server';
import { freigabenFixture } from '../test/fixtures';

vi.mock('../api/einsaetze', () => ({
  ladeEinsatz: vi.fn().mockResolvedValue({
    id: 1,
    bezeichnung: 'Lage',
    status: 'aktiv',
    meine_rolle: 'einsatzleitung',
  }),
  ladeModulFreigaben: (...a: unknown[]) => ladeModulFreigaben(...a),
}));
const ladeModulFreigaben = vi.fn();

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
  material_ids: [],
  ...over,
});

/** Spiegelt die aktuelle Adresse, damit ein Test das Räumen der URL sehen kann. */
function OrtSonde() {
  const ort = useLocation();
  return <output data-testid="ort">{ort.pathname + ort.search}</output>;
}

/** Der Query-Client des letzten `renderPage`, für Abwesenheits-Prüfungen am Cache. */
let zuletztClient: QueryClient | null = null;

function renderPage(url = '/einsaetze/1/nachforderungen') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  zuletztClient = client;
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
    ladeModulFreigaben.mockResolvedValue(freigabenFixture());
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
    // Das Formular liegt hinter dem Kopf-Toggle → erst aufklappen.
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
   * Der erste Klick schaltet ohne Rückfrage; der Rückweg steht im Rückgängig-Toast
   * (`uebergang_erlaubt` nimmt die Rücknahme um eine Stufe an).
   */
  it('schaltet den Status mit EINEM Klick linear weiter', async () => {
    setzeNachforderungStatus.mockResolvedValue(nf({ status: 'zugesagt' }));
    renderPage();
    await screen.findByText('2 RTW zur Verstärkung');
    await userEvent.click(screen.getByRole('button', { name: 'Zusage erfassen' }));
    await waitFor(() => expect(setzeNachforderungStatus).toHaveBeenCalledWith(1, 1, 'zugesagt'));
    expect(document.querySelector('.ant-popconfirm')).toBeNull();
  });

  it('bietet den Rückweg als Rückgängig-Knopf an und nimmt genau eine Stufe zurück', async () => {
    setzeNachforderungStatus.mockResolvedValue(nf({ status: 'zugesagt' }));
    renderPage();
    await screen.findByText('2 RTW zur Verstärkung');
    await userEvent.click(screen.getByRole('button', { name: 'Zusage erfassen' }));
    await waitFor(() => expect(setzeNachforderungStatus).toHaveBeenCalledTimes(1));

    await userEvent.click(await screen.findByRole('button', { name: 'Rückgängig' }));
    // Zurück auf den Zustand vor dem Klick — nicht auf den Anfang der Kette.
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
    // „Ablehnen" existiert doppelt (Listen-Aktion + Modal-OK) → im Dialog scopen.
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText('Ablehnungsgrund'), 'keine Reserven');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Ablehnen' }));
    await waitFor(() => expect(lehneNachforderungAb).toHaveBeenCalledWith(1, 1, 'keine Reserven'));
  });

  it('trennt Offen und Abgeschlossen clientseitig', async () => {
    // Eine offene + eine eingetroffene Nachforderung in einer Antwort (kein Status-Filter).
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

  it('eingetroffene Nachforderung zeigt nur noch die Übernahme als Material (LLH-1226)', async () => {
    listeNachforderungen.mockResolvedValue([
      nf({ status: 'eingetroffen', ist_offen: false, eingetroffen_at: '2026-06-12 10:00:00' }),
    ]);
    renderPage();
    // Eingetroffen landet in der Abgeschlossen-Ansicht → dorthin wechseln.
    await userEvent.click(await screen.findByText(/Abgeschlossen \(/));
    await screen.findByText('2 RTW zur Verstärkung');
    expect(screen.queryByRole('button', { name: 'Ablehnen' })).not.toBeInTheDocument();
    const karte = screen.getByText('2 RTW zur Verstärkung').closest('[data-lfh="komm-karte"]');
    expect(
      within(karte as HTMLElement)
        .getAllByRole('button')
        .map((b) => b.textContent),
    ).toEqual(['Als Material übernehmen']);
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

    /**
     * Wartet, bis ALLE vier Felder den erwarteten Stand zeigen, statt nach dem ersten Feld
     * synchron weiterzuprüfen (LFH-789). Die Felder kommen nicht im selben Render an:
     * `InputNumber` zieht seine Anzeige erst über einen `useLayoutUpdateEffect` von
     * `@rc-component/util` nach, und der ist unter `NODE_ENV=test` ein `useEffect`, also eine
     * Task später als die Textfelder. Unter Last stand „Art“ schon da, „Anzahl“ noch leer.
     */
    const erwarteMaske = (w: {
      art: string;
      bezeichnung: string;
      anzahl: string;
      begruendung: string;
    }) =>
      waitFor(() => {
        expect(screen.getByLabelText('Art')).toHaveValue(w.art);
        expect(screen.getByLabelText('Bezeichnung')).toHaveValue(w.bezeichnung);
        expect(screen.getByLabelText('Anzahl')).toHaveValue(w.anzahl);
        expect(begruendungFeld()).toHaveValue(w.begruendung);
      });
    const erwarteVorbelegt = () => erwarteMaske({ ...vorbelegung, anzahl: '20' });
    const erwarteLeer = () =>
      erwarteMaske({ art: '', bezeichnung: '', anzahl: '', begruendung: '' });

    it('öffnet die Erfassung vorbelegt und räumt die Adresse', async () => {
      renderPage(deeplink);
      await erwarteVorbelegt();
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
      // Art ist brauchbar, die Anzahl nicht — die Art darf trotzdem nicht übernommen werden.
      renderPage(deeplink.replace('anzahl=20', 'anzahl=0'));
      await erwarteLeer();
      await waitFor(() =>
        expect(screen.getByTestId('ort')).toHaveTextContent(/^\/einsaetze\/1\/nachforderungen$/),
      );
    });

    it('eine Teil-Vorbelegung (Fehlmenge an der UHS) setzt Art und Begründung, Bezeichnung und Anzahl bleiben leer', async () => {
      renderPage(
        nachforderungenPfad(1, {
          vorbelegung: { art: 'Material', begruendung: 'Fehlmenge UHS «Turnhalle»' },
        }),
      );
      await erwarteMaske({
        art: 'Material',
        bezeichnung: '',
        anzahl: '',
        begruendung: 'Fehlmenge UHS «Turnhalle»',
      });
    });

    it('nach dem Absetzen füllt sich die Erfassung NICHT erneut mit der Vorbelegung', async () => {
      legeNachforderungAn.mockResolvedValue(nf());
      renderPage(deeplink);
      await erwarteVorbelegt();
      await userEvent.click(screen.getByRole('button', { name: 'Nachforderung absetzen' }));
      await waitFor(() =>
        expect(legeNachforderungAn).toHaveBeenCalledWith(
          1,
          expect.objectContaining({ art: 'Verpflegung', anzahl: 20 }),
        ),
      );
      // Eine wieder vorbelegte Maske stünde einen Druck vor der Dublette.
      await erwarteLeer();
    });

    it('Schließen und erneutes Öffnen zeigt eine leere Erfassung', async () => {
      renderPage(deeplink);
      await erwarteVorbelegt();
      // Zwei Knöpfe schließen die Erfassung: der im Seitenkopf und das Kreuz am Paneel. Bis
      // LFH-595 schob antds Icon `aria-label="up"` in den Namen des Kopfknopfs; die Icons des
      // Satzes sind `aria-hidden`, beide heißen jetzt gleich. Geklickt wird der Kopfknopf.
      const schliessen = screen.getAllByRole('button', { name: 'Formular schließen' });
      expect(schliessen).toHaveLength(2);
      await userEvent.click(schliessen[0]);
      await waitFor(() => expect(screen.queryByLabelText('Art')).not.toBeInTheDocument());
      await userEvent.click(screen.getByRole('button', { name: /Nachforderung anlegen/ }));
      await erwarteLeer();
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

/**
 * Speicherfehler am Ort (LFH-1077, `frontend/AGENTS.md`, „Rückwege und Fehler“): Anlegen am
 * Formular, Fortschalten an der Karte, Rückgängig im Seitenhinweis, Ablehnen im Dialog. Kein
 * Fehler-Toast; Erfolgs- und Rückgängig-Toasts bleiben.
 */
describe('NachforderungenPage — Speicherfehler am Ort (LFH-1077)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listeNachforderungen.mockResolvedValue([nf()]);
  });

  const karte = (bezeichnung: string) =>
    screen.getByText(bezeichnung).closest('[data-lfh="komm-karte"]') as HTMLElement;
  const zweiNachforderungen = () =>
    listeNachforderungen.mockResolvedValue([
      nf({ id: 1, bezeichnung: 'Bedarf eins' }),
      nf({ id: 2, bezeichnung: 'Bedarf zwei' }),
    ]);
  const seitenHinweis = () =>
    waitFor(() => {
      const h = document.querySelector<HTMLElement>('[data-lfh="seiten-beschreibung"]');
      expect(h).not.toBeNull();
      return h as HTMLElement;
    });

  async function setzeAb() {
    await userEvent.click(screen.getByRole('button', { name: 'Nachforderung absetzen' }));
  }

  it('Anlegen: der Grund steht am Formular, die Eingabe bleibt, kein Toast', async () => {
    legeNachforderungAn.mockRejectedValue(new ApiError(422, 'Art unbekannt'));
    renderPage();
    await screen.findByText('2 RTW zur Verstärkung');
    await userEvent.click(screen.getByRole('button', { name: /Nachforderung anlegen/ }));
    await userEvent.type(screen.getByLabelText('Art'), 'SEG');
    await userEvent.type(screen.getByLabelText('Bezeichnung'), 'Eine SEG');
    await setzeAb();

    expect(await screen.findByRole('alert')).toHaveTextContent('Art unbekannt');
    expect(screen.getByLabelText('Art')).toHaveValue('SEG');
    expect(document.querySelectorAll('.ant-message-notice')).toHaveLength(0);
  });

  it('Anlegen: das nächste Absetzen räumt den Grund', async () => {
    legeNachforderungAn
      .mockRejectedValueOnce(new ApiError(422, 'Art unbekannt'))
      .mockImplementationOnce(() => new Promise(() => {}));
    renderPage();
    await screen.findByText('2 RTW zur Verstärkung');
    await userEvent.click(screen.getByRole('button', { name: /Nachforderung anlegen/ }));
    await userEvent.type(screen.getByLabelText('Art'), 'SEG');
    await userEvent.type(screen.getByLabelText('Bezeichnung'), 'Eine SEG');
    await setzeAb();
    await screen.findByText('Art unbekannt');

    await setzeAb();
    await waitFor(() => expect(screen.queryByText('Art unbekannt')).not.toBeInTheDocument());
  });

  it('Anlegen: Zuklappen und erneutes Öffnen zeigen keinen alten Grund', async () => {
    legeNachforderungAn.mockRejectedValue(new ApiError(422, 'Art unbekannt'));
    renderPage();
    await screen.findByText('2 RTW zur Verstärkung');
    await userEvent.click(screen.getByRole('button', { name: /Nachforderung anlegen/ }));
    await userEvent.type(screen.getByLabelText('Art'), 'SEG');
    await userEvent.type(screen.getByLabelText('Bezeichnung'), 'Eine SEG');
    await setzeAb();
    await screen.findByText('Art unbekannt');

    await userEvent.click(screen.getAllByRole('button', { name: 'Formular schließen' })[0]);
    await userEvent.click(screen.getByRole('button', { name: /Nachforderung anlegen/ }));
    await screen.findByLabelText('Art');
    expect(screen.queryByText('Art unbekannt')).not.toBeInTheDocument();
  });

  it('Fortschalten: der Grund steht an genau dieser Karte', async () => {
    zweiNachforderungen();
    setzeNachforderungStatus.mockRejectedValue(new ApiError(422, 'Übergang nicht erlaubt'));
    renderPage();
    await screen.findByText('Bedarf zwei');
    await userEvent.click(
      within(karte('Bedarf eins')).getByRole('button', { name: 'Zusage erfassen' }),
    );

    expect(await within(karte('Bedarf eins')).findByText('Übergang nicht erlaubt')).toHaveAttribute(
      'data-fehler',
    );
    expect(karte('Bedarf zwei').querySelector('[data-fehler]')).toBeNull();
    expect(document.querySelectorAll('.ant-message-notice')).toHaveLength(0);
  });

  /**
   * `useMutation` verfolgt nur den LETZTEN Aufruf: schaltet Karte 2, bevor Karte 1 geantwortet
   * hat, ginge die Ablehnung von Karte 1 über `mutation.error` verloren.
   */
  it('Fortschalten: zwei Karten nebenläufig, die Ablehnung steht an ihrer Karte', async () => {
    zweiNachforderungen();
    let lehneAb: (e: Error) => void = () => {};
    setzeNachforderungStatus.mockImplementation((_e: number, nfId: number) =>
      nfId === 1
        ? new Promise((_r, reject) => (lehneAb = reject))
        : Promise.resolve(nf({ id: 2, status: 'zugesagt' })),
    );
    renderPage();
    await screen.findByText('Bedarf zwei');
    await userEvent.click(
      within(karte('Bedarf eins')).getByRole('button', { name: 'Zusage erfassen' }),
    );
    await userEvent.click(
      within(karte('Bedarf zwei')).getByRole('button', { name: 'Zusage erfassen' }),
    );
    await waitFor(() => expect(setzeNachforderungStatus).toHaveBeenCalledTimes(2));
    await act(async () => lehneAb(new ApiError(409, 'Zwischenzeitlich geändert')));

    expect(
      await within(karte('Bedarf eins')).findByText('Zwischenzeitlich geändert'),
    ).toHaveAttribute('data-fehler');
    expect(karte('Bedarf zwei').querySelector('[data-fehler]')).toBeNull();
    // Karte 2 hat Erfolg und damit ihren Rückgängig-Toast; ein Fehler-Toast fehlt.
    expect(document.querySelectorAll('.ant-message-error')).toHaveLength(0);
  });

  it('Fortschalten: die nächste Aktion an derselben Karte räumt den Grund', async () => {
    setzeNachforderungStatus
      .mockRejectedValueOnce(new ApiError(422, 'Übergang nicht erlaubt'))
      .mockImplementationOnce(() => new Promise(() => {}));
    renderPage();
    await screen.findByText('2 RTW zur Verstärkung');
    await userEvent.click(screen.getByRole('button', { name: 'Zusage erfassen' }));
    await screen.findByText('Übergang nicht erlaubt');

    await userEvent.click(screen.getByRole('button', { name: 'Zusage erfassen' }));
    await waitFor(() =>
      expect(screen.queryByText('Übergang nicht erlaubt')).not.toBeInTheDocument(),
    );
  });

  /**
   * Nach der Ablehnung lädt die Seite neu (optimistische Sperre, 422): hat ein anderer Arbeitsplatz
   * das Eintreffen schon gemeldet, wandert die Karte nach „Abgeschlossen“ und mit ihr ihr Grund.
   * Solange sie in der gezeigten Liste fehlt, steht er im Seitenhinweis.
   */
  it('Fortschalten: wandert die Karte aus der gezeigten Liste, steht ihr Grund im Seitenhinweis', async () => {
    const unterwegs = nf({ status: 'unterwegs', unterwegs_at: '2026-06-12 09:30:00' });
    listeNachforderungen.mockResolvedValue([unterwegs]);
    setzeNachforderungStatus.mockImplementation(() => {
      listeNachforderungen.mockResolvedValue([
        nf({ status: 'eingetroffen', ist_offen: false, eingetroffen_at: '2026-06-12 10:00:00' }),
      ]);
      return Promise.reject(new ApiError(422, 'Bereits eingetroffen gemeldet'));
    });
    renderPage();
    await screen.findByText('2 RTW zur Verstärkung');
    await userEvent.click(screen.getByRole('button', { name: 'Eintreffen melden' }));

    await waitFor(() => expect(screen.queryByText('2 RTW zur Verstärkung')).toBeNull());
    const hinweis = await seitenHinweis();
    const grund = await within(hinweis).findByRole('alert');
    expect(grund).toHaveTextContent('Bereits eingetroffen gemeldet');
    // Der Titel nennt die Nachforderung: oben steht nicht mehr, welche Karte gemeint ist.
    expect(grund).toHaveTextContent('Status von „2 RTW zur Verstärkung“ nicht geändert');
    expect(document.querySelectorAll('.ant-message-error')).toHaveLength(0);

    // In der Ansicht, die die Karte zeigt, steht der Grund wieder an ihr, nicht doppelt oben.
    await userEvent.click(screen.getByText(/Abgeschlossen \(/));
    expect(
      await within(karte('2 RTW zur Verstärkung')).findByText('Bereits eingetroffen gemeldet'),
    ).toHaveAttribute('data-fehler');
    expect(document.querySelector('[data-lfh="seiten-beschreibung"] [role="alert"]')).toBeNull();
  });

  /** Rückgängig kommt aus dem Toast; die Karte ist dann oft gewandert. */
  it('Rückgängig: eine abgelehnte Rücknahme steht im Seitenhinweis, nicht an der Karte', async () => {
    setzeNachforderungStatus
      .mockResolvedValueOnce(nf({ status: 'zugesagt' }))
      .mockRejectedValueOnce(new ApiError(422, 'Rücknahme nicht erlaubt'));
    renderPage();
    await screen.findByText('2 RTW zur Verstärkung');
    await userEvent.click(screen.getByRole('button', { name: 'Zusage erfassen' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Rückgängig' }));

    const hinweis = await seitenHinweis();
    expect(await within(hinweis).findByRole('alert')).toHaveTextContent('Rücknahme nicht erlaubt');
    expect(document.querySelectorAll('[data-fehler]')).toHaveLength(0);
    expect(document.querySelectorAll('.ant-message-error')).toHaveLength(0);
  });

  it('Rückgängig: die nächste Rücknahme räumt den Seitenhinweis', async () => {
    setzeNachforderungStatus
      .mockResolvedValueOnce(nf({ status: 'zugesagt' }))
      .mockRejectedValueOnce(new ApiError(422, 'Rücknahme nicht erlaubt'))
      .mockResolvedValueOnce(nf({ status: 'zugesagt' }))
      .mockImplementationOnce(() => new Promise(() => {}));
    renderPage();
    await screen.findByText('2 RTW zur Verstärkung');
    await userEvent.click(screen.getByRole('button', { name: 'Zusage erfassen' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Rückgängig' }));
    await screen.findByText('Rücknahme nicht erlaubt');

    await userEvent.click(screen.getByRole('button', { name: 'Zusage erfassen' }));
    await waitFor(() => expect(setzeNachforderungStatus).toHaveBeenCalledTimes(3));
    const rueckgaengig = await screen.findAllByRole('button', { name: 'Rückgängig' });
    await userEvent.click(rueckgaengig[rueckgaengig.length - 1]);
    await waitFor(() => expect(setzeNachforderungStatus).toHaveBeenCalledTimes(4));
    await waitFor(() =>
      expect(screen.queryByText('Rücknahme nicht erlaubt')).not.toBeInTheDocument(),
    );
  });

  async function lehneAbImDialog(grund = 'keine Reserven') {
    await userEvent.click(screen.getByRole('button', { name: 'Ablehnen' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText('Ablehnungsgrund'), grund);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Ablehnen' }));
    return dialog;
  }

  /** Der Dialog wartet auf die Antwort (design.md D3): bis dahin bleibt der Grund getippt. */
  it('Ablehnen: der Dialog bleibt bei einer Ablehnung offen, mit Grund und Fehler', async () => {
    lehneNachforderungAb.mockRejectedValue(new ApiError(409, 'Bereits zugesagt'));
    renderPage();
    await screen.findByText('2 RTW zur Verstärkung');
    const dialog = await lehneAbImDialog();

    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Bereits zugesagt');
    expect(within(dialog).getByLabelText('Ablehnungsgrund')).toHaveValue('keine Reserven');
    expect(dialog.closest('.ant-zoom-leave')).toBeNull();
    expect(document.querySelectorAll('.ant-message-notice')).toHaveLength(0);
  });

  it('Ablehnen: der Dialog wartet auf die Antwort und schließt erst beim Erfolg', async () => {
    let antworte: (n: Nachforderung) => void = () => {};
    lehneNachforderungAb.mockImplementation(() => new Promise((r) => (antworte = r)));
    renderPage();
    await screen.findByText('2 RTW zur Verstärkung');
    const dialog = await lehneAbImDialog();

    await waitFor(() => expect(lehneNachforderungAb).toHaveBeenCalledTimes(1));
    expect(within(dialog).getByLabelText('Ablehnungsgrund')).toHaveValue('keine Reserven');
    expect(within(dialog).getByRole('button', { name: 'Abbrechen' })).toBeDisabled();
    expect(dialog.closest('.ant-zoom-leave')).toBeNull();

    await act(async () => antworte(nf({ status: 'abgelehnt' })));
    await waitFor(() => expect(dialog.closest('.ant-zoom-leave')).not.toBeNull());
    expect(await screen.findByText('Nachforderung abgelehnt')).toBeInTheDocument();
  });

  it('Ablehnen: das nächste Absenden räumt den Fehler', async () => {
    lehneNachforderungAb
      .mockRejectedValueOnce(new ApiError(409, 'Bereits zugesagt'))
      .mockImplementationOnce(() => new Promise(() => {}));
    renderPage();
    await screen.findByText('2 RTW zur Verstärkung');
    const dialog = await lehneAbImDialog();
    await within(dialog).findByRole('alert');

    await userEvent.click(within(dialog).getByRole('button', { name: 'Ablehnen' }));
    await waitFor(() => expect(within(dialog).queryByRole('alert')).toBeNull());
  });

  it('Ablehnen: Abbrechen und erneutes Öffnen zeigen keinen alten Fehler', async () => {
    lehneNachforderungAb.mockRejectedValue(new ApiError(409, 'Bereits zugesagt'));
    renderPage();
    await screen.findByText('2 RTW zur Verstärkung');
    const dialog = await lehneAbImDialog();
    await within(dialog).findByRole('alert');

    // Kein Warten auf das Verschwinden: rc-dialog friert den Inhalt eines schließenden Dialogs
    // ein, und jsdom beendet die Animation nie.
    await userEvent.click(within(dialog).getByRole('button', { name: 'Abbrechen' }));
    await userEvent.click(screen.getAllByRole('button', { name: 'Ablehnen' })[0]);
    const wieder = await waitFor(() => {
      const offen = screen.getAllByRole('dialog').find((d) => d.closest('.ant-zoom-leave') == null);
      expect(offen).toBeDefined();
      return offen as HTMLElement;
    });
    expect(within(wieder).getByLabelText('Ablehnungsgrund')).toHaveValue('');
    expect(within(wieder).queryByRole('alert')).toBeNull();
  });
});

describe('NachforderungenPage — Material übernehmen (LLH-1226 Teil II)', () => {
  const sandsaecke = (over: Partial<Nachforderung> = {}) =>
    nf({
      id: 4,
      art: 'Sandsäcke',
      bezeichnung: 'Sandsäcke Deich Nord',
      anzahl: 2000,
      status: 'eingetroffen',
      ist_offen: false,
      eingetroffen_at: '2026-06-12 10:00:00',
      ...over,
    });
  const posten = (over: Partial<EinsatzMaterial> = {}) =>
    ({
      id: 7,
      einsatz_id: 1,
      bezeichnung: 'Sandsäcke',
      art: 'verbrauchsgut',
      menge: 1200,
      ausgegeben: 0,
      status: 'einsatzbereit',
      ist_adhoc: true,
      ist_demo: false,
      einheit_id: null,
      einsatz_fahrzeug_id: null,
      uhs_id: null,
      br_id: null,
      beendet_at: null,
      nachforderung_id: 4,
      ...over,
    }) as unknown as EinsatzMaterial;

  /** Materialliste und Orte über MSW; liefert die gesendeten POST-Körper und gezählte Abrufe. */
  function materialServer(liste: () => EinsatzMaterial[], post?: () => Response) {
    const koerper: unknown[] = [];
    const abrufe: string[] = [];
    server.use(
      http.get('/api/einsaetze/1/material', ({ request }) => {
        abrufe.push(request.url);
        return HttpResponse.json(
          new URL(request.url).searchParams.has('entlassene') ? [] : liste(),
        );
      }),
      http.post('/api/einsaetze/1/material', async ({ request }) => {
        koerper.push(await request.json());
        return post ? post() : HttpResponse.json(posten({ id: 8 }), { status: 201 });
      }),
      http.get('/api/einsaetze/1/einheiten', () => HttpResponse.json([])),
      http.get('/api/einsaetze/1/uhs', () => HttpResponse.json([])),
      http.get('/api/einsaetze/1/fahrzeuge', () => HttpResponse.json([])),
      http.get('/api/einsaetze/1/bereitstellungsraeume', () => HttpResponse.json([])),
    );
    return { koerper, abrufe };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    ladeModulFreigaben.mockResolvedValue(freigabenFixture());
  });

  it('übernimmt eine eingetroffene Nachforderung: vorbelegter Dialog, POST mit Bezug, Neuladen', async () => {
    listeNachforderungen.mockResolvedValue([sandsaecke()]);
    const { koerper } = materialServer(() => []);
    renderPage();
    await userEvent.click(await screen.findByText(/Abgeschlossen \(/));
    await userEvent.click(await screen.findByRole('button', { name: 'Als Material übernehmen' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('„Sandsäcke“ als Material übernehmen');
    await waitFor(() => expect(within(dialog).getByLabelText('Menge')).toHaveValue('2000'));
    const vorher = listeNachforderungen.mock.calls.length;
    await userEvent.click(within(dialog).getByRole('button', { name: 'Übernehmen' }));
    await waitFor(() =>
      expect(koerper).toEqual([
        {
          adhoc: { bezeichnung: 'Sandsäcke' },
          menge: 2000,
          art: 'verbrauchsgut',
          nachforderung_id: 4,
        },
      ]),
    );
    await waitFor(() => expect(listeNachforderungen.mock.calls.length).toBeGreaterThan(vorher));
    await waitFor(() => expect(dialog.closest('.ant-zoom-leave')).not.toBeNull());
    expect(await screen.findByText('Material übernommen')).toBeInTheDocument();
  });

  it('409: der Dialog bleibt, lädt neu und bietet „Weiteren Posten übernehmen“ mit dem Rest an', async () => {
    let schonUebernommen = false;
    listeNachforderungen.mockImplementation(() =>
      Promise.resolve([sandsaecke({ material_ids: schonUebernommen ? [7] : [] })]),
    );
    let antwort409 = true;
    const { koerper } = materialServer(
      () => (schonUebernommen ? [posten()] : []),
      () => {
        if (antwort409) {
          antwort409 = false;
          schonUebernommen = true;
          return HttpResponse.json(
            { error: 'Aus dieser Nachforderung ist schon Material übernommen' },
            { status: 409 },
          );
        }
        return HttpResponse.json(posten({ id: 8, menge: 800 }), { status: 201 });
      },
    );
    renderPage();
    await userEvent.click(await screen.findByText(/Abgeschlossen \(/));
    await userEvent.click(await screen.findByRole('button', { name: 'Als Material übernehmen' }));
    const dialog = await screen.findByRole('dialog');
    await waitFor(() => expect(within(dialog).getByLabelText('Menge')).toHaveValue('2000'));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Übernehmen' }));

    expect(
      await within(dialog).findByText(/Aus dieser Nachforderung ist schon Material übernommen/),
    ).toBeInTheDocument();
    const weiter = await within(dialog).findByRole('button', {
      name: 'Weiteren Posten übernehmen',
    });
    await waitFor(() => expect(within(dialog).getByLabelText('Menge')).toHaveValue('800'));
    await userEvent.click(weiter);
    await waitFor(() => expect(koerper).toHaveLength(2));
    expect(koerper[1]).toMatchObject({ menge: 800, nachforderung_id: 4, ergaenzen: true });
    expect(koerper[0]).not.toHaveProperty('ergaenzen');
  });

  it('mit Freigabe zeigt die Karte ihre Posten aus der Materialliste', async () => {
    listeNachforderungen.mockResolvedValue([sandsaecke({ material_ids: [7] })]);
    materialServer(() => [posten()]);
    renderPage();
    await userEvent.click(await screen.findByText(/Abgeschlossen \(/));
    expect(await screen.findByText('Sandsäcke · 1200 · ohne Ort')).toBeInTheDocument();
    expect(screen.getByText('übernommen 1200 von 2000')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Weiteren Posten übernehmen' })).toBeInTheDocument();
  });

  it('ohne Material-Freigabe: kein Abruf der Materialliste, Knopf gesperrt, nur die Zahl', async () => {
    ladeModulFreigaben.mockResolvedValue(freigabenFixture({ material: { zugriff: false } }));
    listeNachforderungen.mockResolvedValue([sandsaecke({ material_ids: [7] })]);
    const { abrufe } = materialServer(() => [posten()]);
    renderPage();
    await userEvent.click(await screen.findByText(/Abgeschlossen \(/));
    const knopf = await screen.findByRole('button', { name: 'Weiteren Posten übernehmen' });
    await waitFor(() => expect(knopf).toBeDisabled());
    expect(screen.getByText('Keine Berechtigung')).toBeInTheDocument();
    expect(screen.getByText('1 Posten übernommen')).toBeInTheDocument();
    await userEvent.click(knopf);
    expect(screen.queryByRole('dialog')).toBeNull();
    await freigabenAufgeloest();
    keinMaterialAbruf(abrufe);
  });

  /**
   * Wartet, bis die Freigaben aufgelöst sind und ein Tick vergangen ist: erst dann hätte ein
   * Abruf, den nur die Freigabe-Bedingung aufhält, schon begonnen.
   */
  async function freigabenAufgeloest() {
    await waitFor(() =>
      expect(zuletztClient?.getQueryState(einsatzKeys.modulFreigaben(1))?.status).toBe('success'),
    );
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
  /** Die Materialliste wurde weder abgerufen noch begonnen (vor MSW sichtbar am Cache). */
  function keinMaterialAbruf(abrufe: string[]) {
    const stand = zuletztClient?.getQueryState(einsatzKeys.material(1));
    expect(stand?.fetchStatus ?? 'idle').toBe('idle');
    expect(stand?.dataUpdateCount ?? 0).toBe(0);
    expect(abrufe).toEqual([]);
  }

  it('ohne Übernahme ruft die Seite die Materialliste nicht ab', async () => {
    listeNachforderungen.mockResolvedValue([sandsaecke(), nf()]);
    const { abrufe } = materialServer(() => []);
    renderPage();
    await screen.findByText('2 RTW zur Verstärkung');
    await freigabenAufgeloest();
    keinMaterialAbruf(abrufe);
  });

  it('Modul Material ausgeblendet (nur Zugriff, etwa Admin): Knopf gesperrt, kein Abruf', async () => {
    ladeModulFreigaben.mockResolvedValue(
      freigabenFixture({ material: { sichtbar: false, zugriff: true } }),
    );
    listeNachforderungen.mockResolvedValue([sandsaecke({ material_ids: [7] })]);
    const { abrufe } = materialServer(() => [posten()]);
    renderPage();
    await userEvent.click(await screen.findByText(/Abgeschlossen \(/));
    const knopf = await screen.findByRole('button', { name: 'Weiteren Posten übernehmen' });
    await freigabenAufgeloest();
    expect(knopf).toBeDisabled();
    expect(screen.getByText('Keine Berechtigung')).toBeInTheDocument();
    await userEvent.click(knopf);
    expect(screen.queryByRole('dialog')).toBeNull();
    keinMaterialAbruf(abrufe);
  });

  it('solange die Freigaben laden, steht kein Übernahme-Knopf (auch kein gesperrter)', async () => {
    ladeModulFreigaben.mockReturnValue(new Promise(() => {}));
    listeNachforderungen.mockResolvedValue([sandsaecke()]);
    materialServer(() => []);
    renderPage();
    await userEvent.click(await screen.findByText(/Abgeschlossen \(/));
    await screen.findByText('Sandsäcke Deich Nord');
    expect(screen.queryByRole('button', { name: 'Als Material übernehmen' })).toBeNull();
    expect(screen.queryByText('Keine Berechtigung')).toBeNull();
  });

  it('422 „erst nach dem Eintreffen“: der Dialog bleibt offen auf „Übernehmen“ und nennt den Grund', async () => {
    listeNachforderungen.mockResolvedValue([sandsaecke()]);
    materialServer(
      () => [],
      () =>
        HttpResponse.json(
          { error: 'Material wird erst nach dem Eintreffen übernommen' },
          { status: 422 },
        ),
    );
    renderPage();
    await userEvent.click(await screen.findByText(/Abgeschlossen \(/));
    await userEvent.click(await screen.findByRole('button', { name: 'Als Material übernehmen' }));
    const dialog = await screen.findByRole('dialog');
    await waitFor(() => expect(within(dialog).getByLabelText('Menge')).toHaveValue('2000'));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Übernehmen' }));
    expect(
      await within(dialog).findByText(/Material wird erst nach dem Eintreffen übernommen/),
    ).toBeInTheDocument();
    expect(dialog).toHaveTextContent('„Sandsäcke“ als Material übernehmen');
    expect(within(dialog).getByRole('button', { name: 'Übernehmen' })).toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: 'Weiteren Posten übernehmen' })).toBeNull();
    expect(dialog.closest('.ant-zoom-leave')).toBeNull();
  });

  it('?nachforderung= wählt die Ansicht der Nachforderung, hebt ihre Karte hervor und räumt den Parameter', async () => {
    listeNachforderungen.mockResolvedValue([nf(), sandsaecke()]);
    materialServer(() => []);
    renderPage(nachforderungenPfad(1, { nachforderung: 4 }));
    const karte = await waitFor(() => {
      const k = document.querySelector('[data-nachforderung-id="4"]');
      expect(k).not.toBeNull();
      return k as HTMLElement;
    });
    expect(karte).toHaveAttribute('data-hervorgehoben', 'true');
    expect(screen.getByRole('radio', { name: /Abgeschlossen/ })).toBeChecked();
    await waitFor(() =>
      expect(screen.getByTestId('ort')).toHaveTextContent(/^\/einsaetze\/1\/nachforderungen$/),
    );
  });

  it('?nachforderung= mit unbekannter Kennung: Ansicht und Hervorhebung bleiben, der Parameter wird geräumt', async () => {
    listeNachforderungen.mockResolvedValue([nf(), sandsaecke()]);
    materialServer(() => []);
    renderPage(nachforderungenPfad(1, { nachforderung: 99 }));
    await screen.findByText('2 RTW zur Verstärkung');
    await waitFor(() =>
      expect(screen.getByTestId('ort')).toHaveTextContent(/^\/einsaetze\/1\/nachforderungen$/),
    );
    expect(screen.getByRole('radio', { name: /Offen/ })).toBeChecked();
    expect(document.querySelector('[data-hervorgehoben="true"]')).toBeNull();
  });

  it('?nachforderung= beim Kaltstart: antwortet die Liste vor dem Einsatz, rollt die Karte trotzdem sofort ins Bild', async () => {
    const scroll = vi.fn();
    const vorher = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = scroll;
    try {
      let einsatzDa: () => void = () => {};
      vi.mocked(ladeEinsatz).mockImplementationOnce(
        () =>
          new Promise((r) => {
            einsatzDa = () =>
              r({
                id: 1,
                bezeichnung: 'Lage',
                status: 'aktiv',
                meine_rolle: 'einsatzleitung',
              } as Awaited<ReturnType<typeof ladeEinsatz>>);
          }),
      );
      listeNachforderungen.mockResolvedValue([nf(), sandsaecke()]);
      materialServer(() => []);
      renderPage(nachforderungenPfad(1, { nachforderung: 4 }));
      await waitFor(() => expect(listeNachforderungen).toHaveBeenCalled());
      await act(async () => {
        await listeNachforderungen.mock.results[0]?.value;
        await new Promise((r) => setTimeout(r, 0));
      });
      await act(async () => einsatzDa());
      const karte = await waitFor(() => {
        const k = document.querySelector('[data-nachforderung-id="4"]');
        expect(k).not.toBeNull();
        return k as HTMLElement;
      });
      await waitFor(() => expect(scroll).toHaveBeenCalled());
      expect(scroll.mock.contexts[0]).toBe(karte);
      expect(karte).toHaveAttribute('data-hervorgehoben', 'true');
    } finally {
      Element.prototype.scrollIntoView = vorher;
    }
  });

  it('Rücknahme nach Übernahme: der Grund steht im Seitenhinweis', async () => {
    listeNachforderungen.mockResolvedValue([nf({ id: 4, status: 'unterwegs' })]);
    setzeNachforderungStatus
      .mockResolvedValueOnce(nf({ id: 4, status: 'eingetroffen' }))
      .mockRejectedValueOnce(new ApiError(422, 'Aus der Nachforderung ist Material übernommen'));
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Eintreffen melden' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Rückgängig' }));
    const hinweis = await waitFor(() => {
      const h = document.querySelector<HTMLElement>('[data-lfh="seiten-beschreibung"]');
      expect(h).not.toBeNull();
      return h as HTMLElement;
    });
    expect(await within(hinweis).findByRole('alert')).toHaveTextContent(
      'Aus der Nachforderung ist Material übernommen',
    );
  });
});
