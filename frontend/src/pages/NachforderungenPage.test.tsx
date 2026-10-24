import { afterEach, describe, it, expect, vi, beforeEach } from 'vitest';
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
import { setzeViewportBreite } from '../test/viewport';
import { waehleMenueEintrag } from '../test/menue';
import {
  NACHFORDERUNG_ABLEHNEN_GRUND_MAX,
  NACHFORDERUNG_ZURUECKZIEHEN_GRUND_MAX,
} from '../api/eingabegrenzen';
import { waehle } from '../test/auswahlListe';

/*
 * Die Uhr steht auf dem Einsatztag (nur `Date`): „Eingetroffen“ zeigt die letzten 12 h, die
 * Zeitpunkte der Fixtures liegen am 12.06.2026 vormittags (UTC).
 */
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-06-12T12:00:00Z'));
  // Vorschläge und Ziele der Erfassung (LLH-1089): leer, wenn ein Test nichts anderes setzt.
  server.use(
    http.get('/api/einheit-typen', () => HttpResponse.json([])),
    http.get('/api/einsaetze/1/bereitstellungsraeume', () => HttpResponse.json([])),
    http.get('/api/einsaetze/1/abschnitte', () => HttpResponse.json([])),
  );
});
afterEach(() => {
  vi.useRealTimers();
});

/** Die Spalte (bzw. am Handy das Feld) einer Stufe im Board. */
const spalte = (stufe: string) =>
  document.querySelector<HTMLElement>(`[data-lfh="board-spalte"][data-stufe="${stufe}"]`);
const stufeVon = (text: string) =>
  screen.getByText(text).closest('[data-lfh="board-spalte"]')?.getAttribute('data-stufe');
/**
 * Ein Eintrag im ⋮-Menü einer Karte (LLH-1097 D10); ohne Karte die erste. Gewählt wird erst, wenn
 * das Menü seinen Fokus hat (`test/menue.ts`): sonst zieht ihn der späte `autoFocus` des Menüs aus
 * dem danach geöffneten Dialog, und der getippte Grund ginge verloren (LLH-1390).
 */
async function waehleImMenue(eintrag: string, karte?: HTMLElement) {
  const ort = karte ? within(karte) : screen;
  await waehleMenueEintrag(
    ort.getAllByRole('button', { name: /^Aktionen zu Nachforderung / })[0],
    eintrag,
  );
}

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
const listeUeblicheArten = vi.fn();
const legeNachforderungAn = vi.fn();
const setzeNachforderungStatus = vi.fn();
const lehneNachforderungAb = vi.fn();
const erfasseZusage = vi.fn();
const zieheNachforderungZurueck = vi.fn();
const patcheNachforderung = vi.fn();
vi.mock('../api/nachforderungen', () => ({
  erfasseZusage: (...a: unknown[]) => erfasseZusage(...a),
  zieheNachforderungZurueck: (...a: unknown[]) => zieheNachforderungZurueck(...a),
  patcheNachforderung: (...a: unknown[]) => patcheNachforderung(...a),
  listeNachforderungen: (...a: unknown[]) => listeNachforderungen(...a),
  // Übliche Arten der Organisation (LLH-1379): ohne eigene Vorgabe leer.
  listeUeblicheArten: (...a: unknown[]) => listeUeblicheArten(...a) ?? Promise.resolve([]),
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
  einheit_ids: [],
  einheit_ids_am_raum: [],
  zusage_rufnamen: [],
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

  it('zeigt offene Nachforderungen in der Spalte ihrer Stufe', async () => {
    renderPage();
    expect(await screen.findByText('2 RTW zur Verstärkung')).toBeInTheDocument();
    expect(stufeVon('2 RTW zur Verstärkung')).toBe('angefordert');
    // Die Stufe nennt der Spaltenkopf, nicht die Karte.
    expect(
      screen.queryByText('Angefordert', { selector: '[data-lfh="status-chip"] span' }),
    ).toBeNull();
    expect(screen.getByLabelText(/^Datenstand \d{4}$/)).toBeInTheDocument();
  });

  it('der Seitenkopf liest den Server-Zähler: offen und davon unterwegs', async () => {
    server.use(
      http.get('/api/einsaetze/:einsatzId/modul-zaehler', () =>
        HttpResponse.json({
          nachforderungen: { offen: 5, angefordert: 1, zugesagt: 2, unterwegs: 2, ueberfaellig: 0 },
        }),
      ),
    );
    renderPage();
    expect(await screen.findByText('5 offen · 2 unterwegs')).toBeInTheDocument();
  });

  it('ohne Server-Zahl steht keine Zahl im Kopf', async () => {
    renderPage();
    await screen.findByText('2 RTW zur Verstärkung');
    expect(screen.queryByText(/\d+ offen/)).toBeNull();
  });

  it('die Schnellwahl füllt mit den üblichen Arten der Organisation (LLH-1379)', async () => {
    listeUeblicheArten.mockResolvedValueOnce([{ art: 'Sandsäcke', einsaetze: 3 }]);
    renderPage();
    await screen.findByText('2 RTW zur Verstärkung');
    expect(listeUeblicheArten).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: /Nachforderung anlegen/ }));
    const gruppe = await screen.findByRole('group', { name: 'Schnellwahl' });
    await waitFor(() =>
      expect(
        Array.from(gruppe.querySelectorAll('button')).map((b) => b.textContent?.trim()),
      ).toEqual(['RTW', 'Sandsäcke', 'KTW', 'NEF', 'LF 10', 'HLF 20']),
    );
    expect(listeUeblicheArten).toHaveBeenCalledWith(1);
  });

  it('setzt eine Nachforderung ab', async () => {
    legeNachforderungAn.mockResolvedValue(nf());
    renderPage();
    await screen.findByText('2 RTW zur Verstärkung');
    // Das Formular liegt hinter dem Kopf-Toggle → erst aufklappen.
    await userEvent.click(screen.getByRole('button', { name: /Nachforderung anlegen/ }));
    await userEvent.type(screen.getByLabelText('Was'), 'SEG');
    await userEvent.type(screen.getByLabelText('Details / Zweck'), 'Eine SEG');
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
    listeNachforderungen.mockResolvedValue([nf({ status: 'zugesagt' })]);
    setzeNachforderungStatus.mockResolvedValue(nf({ status: 'unterwegs' }));
    renderPage();
    await screen.findByText('2 RTW zur Verstärkung');
    await userEvent.click(screen.getByRole('button', { name: 'Abfahrt melden' }));
    await waitFor(() => expect(setzeNachforderungStatus).toHaveBeenCalledWith(1, 1, 'unterwegs'));
    expect(document.querySelector('.ant-popconfirm')).toBeNull();
  });

  it('bietet den Rückweg als Rückgängig-Knopf an und nimmt genau eine Stufe zurück', async () => {
    listeNachforderungen.mockResolvedValue([nf({ status: 'zugesagt' })]);
    setzeNachforderungStatus.mockResolvedValue(nf({ status: 'unterwegs' }));
    renderPage();
    await screen.findByText('2 RTW zur Verstärkung');
    await userEvent.click(screen.getByRole('button', { name: 'Abfahrt melden' }));
    await waitFor(() => expect(setzeNachforderungStatus).toHaveBeenCalledTimes(1));

    await userEvent.click(await screen.findByRole('button', { name: 'Rückgängig' }));
    // Zurück auf den Zustand vor dem Klick — nicht auf den Anfang der Kette.
    await waitFor(() =>
      expect(setzeNachforderungStatus).toHaveBeenLastCalledWith(1, 1, 'zugesagt'),
    );
  });

  /**
   * LLH-1395: mit am Raum gebuchter Einheit lehnt der Server jede Rücknahme mit 422 ab (LLH-1387
   * D5), aus „eingetroffen“ ebenso mit übernommenem Material (LLH-1226 D9). Der Toast bestätigt
   * dann den Status und nennt den Grund, ein Rückgängig-Knopf fehlt.
   */
  it.each([
    {
      fall: 'verknüpfte Einheit',
      vorher: nf({ status: 'unterwegs', einheit_ids: [11] }),
      knopf: 'Eintreffen melden',
      nachher: nf({ status: 'eingetroffen', ist_offen: false, einheit_ids: [11] }),
    },
    {
      fall: 'am Raum gebucht, während die Karte stand',
      vorher: nf({ status: 'zugesagt' }),
      knopf: 'Abfahrt melden',
      nachher: nf({ status: 'unterwegs', einheit_ids: [11] }),
    },
  ])('ohne Rückgängig-Knopf bei $fall', async ({ vorher, knopf, nachher }) => {
    listeNachforderungen.mockResolvedValue([vorher]);
    setzeNachforderungStatus.mockResolvedValue(nachher);
    renderPage();
    await screen.findByText('2 RTW zur Verstärkung');
    await userEvent.click(screen.getByRole('button', { name: knopf }));
    await waitFor(() => expect(setzeNachforderungStatus).toHaveBeenCalledTimes(1));
    expect(await screen.findByText(/Einheiten verknüpft, kein Rückgängig/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Rückgängig' })).toBeNull();
  });

  it('lehnt eine Nachforderung mit Grund ab (über Dialog)', async () => {
    lehneNachforderungAb.mockResolvedValue(nf({ status: 'abgelehnt' }));
    renderPage();
    await screen.findByText('2 RTW zur Verstärkung');
    // „Ablehnen“ im ⋮-Menü der Karte öffnet das Modal (LLH-1097 D10).
    await waehleImMenue('Ablehnen');
    const dialog = await screen.findByRole('dialog');
    const grund = within(dialog).getByLabelText('Ablehnungsgrund');
    await userEvent.type(grund, 'keine Reserven');
    expect(grund).toHaveValue('keine Reserven');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Ablehnen' }));
    await waitFor(() => expect(lehneNachforderungAb).toHaveBeenCalledWith(1, 1, 'keine Reserven'));
  });

  /** LLH-1097 D10: die Zusage über das Formular an der Karte, danach der Rückweg im Toast. */
  it('erfasst eine Teilzusage über das Formular an der Karte und bietet den Rückweg an', async () => {
    erfasseZusage.mockResolvedValue(nf({ status: 'zugesagt', anzahl: 1 }));
    setzeNachforderungStatus.mockResolvedValue(nf());
    renderPage();
    await screen.findByText('2 RTW zur Verstärkung');
    await userEvent.click(screen.getByRole('button', { name: 'Zusage erfassen' }));
    const menge = await screen.findByRole('spinbutton', { name: 'Zugesagt' });
    expect(menge).toHaveValue('2');
    await userEvent.clear(menge);
    await userEvent.type(menge, '1');
    await userEvent.type(screen.getByRole('combobox', { name: 'Wer' }), '83-1{Enter}');
    await userEvent.click(screen.getByRole('button', { name: 'Zusage erfassen' }));
    await waitFor(() =>
      expect(erfasseZusage).toHaveBeenCalledWith(1, 1, { anzahl: 1, rufnamen: ['83-1'] }),
    );
    expect(setzeNachforderungStatus).not.toHaveBeenCalled();
    await userEvent.click(await screen.findByRole('button', { name: 'Rückgängig' }));
    await waitFor(() => expect(setzeNachforderungStatus).toHaveBeenCalledWith(1, 1, 'angefordert'));
  });

  it('eine abgelehnte Zusage steht im Formular, die Eingabe bleibt', async () => {
    erfasseZusage.mockRejectedValue(new ApiError(422, 'Mehr Rufnamen als zugesagt'));
    renderPage();
    await screen.findByText('2 RTW zur Verstärkung');
    await userEvent.click(screen.getByRole('button', { name: 'Zusage erfassen' }));
    await userEvent.type(await screen.findByRole('combobox', { name: 'Wer' }), '83-1{Enter}');
    await userEvent.click(screen.getByRole('button', { name: 'Zusage erfassen' }));
    const formular = screen.getByRole('region', { name: /^Zusage zu / });
    expect(await within(formular).findByText('Mehr Rufnamen als zugesagt')).toBeInTheDocument();
    expect(within(formular).getByText('83-1')).toBeInTheDocument();
    expect(document.querySelectorAll('.ant-message-error')).toHaveLength(0);
  });

  /** LLH-1097 D8: Zurückziehen im ⋮-Menü, Rückfrage mit Grund im Dialog, kein Rückgängig. */
  it('zieht eine Nachforderung mit Grund zurück (über Dialog)', async () => {
    zieheNachforderungZurueck.mockResolvedValue(nf({ status: 'zurueckgezogen', ist_offen: false }));
    renderPage();
    await screen.findByText('2 RTW zur Verstärkung');
    await waehleImMenue('Zurückziehen');
    const dialog = await screen.findByRole('dialog', { name: 'Nachforderung zurückziehen' });
    const grund = within(dialog).getByLabelText('Grund des Zurückziehens');
    await userEvent.type(grund, 'nicht mehr benötigt');
    expect(grund).toHaveValue('nicht mehr benötigt');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Zurückziehen' }));
    await waitFor(() =>
      expect(zieheNachforderungZurueck).toHaveBeenCalledWith(1, 1, 'nicht mehr benötigt'),
    );
    expect(await screen.findByText('Nachforderung zurückgezogen')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Rückgängig' })).toBeNull();
  });

  /**
   * LLH-1385: beide Gründe tragen die Grenze des Servers als Zähler (`zeichenGrenze`), ohne zu
   * kürzen; über der Grenze sperrt der Knopf, und nichts geht an den Server.
   */
  it.each([
    {
      eintrag: 'Ablehnen',
      titel: 'Nachforderung ablehnen',
      feld: 'Ablehnungsgrund',
      max: NACHFORDERUNG_ABLEHNEN_GRUND_MAX,
      aufruf: () => lehneNachforderungAb,
    },
    {
      eintrag: 'Zurückziehen',
      titel: 'Nachforderung zurückziehen',
      feld: 'Grund des Zurückziehens',
      max: NACHFORDERUNG_ZURUECKZIEHEN_GRUND_MAX,
      aufruf: () => zieheNachforderungZurueck,
    },
  ])('$eintrag: ein zu langer Grund bleibt stehen und sperrt das Senden', async (fall) => {
    renderPage();
    await screen.findByText('2 RTW zur Verstärkung');
    await waehleImMenue(fall.eintrag);
    const dialog = await screen.findByRole('dialog', { name: fall.titel });
    const grund = within(dialog).getByLabelText(fall.feld);
    await userEvent.click(grund);
    await userEvent.paste('x'.repeat(fall.max + 1));
    expect(grund).toHaveValue('x'.repeat(fall.max + 1));
    expect(within(dialog).getByText(/zu lang/)).toBeInTheDocument();
    const knopf = within(dialog).getByRole('button', { name: fall.eintrag });
    expect(knopf).toBeDisabled();
    await userEvent.click(knopf);
    expect(fall.aufruf()).not.toHaveBeenCalled();

    await userEvent.type(grund, '{Backspace}');
    expect(knopf).toBeEnabled();
  });

  /** LLH-1097 D9: Bearbeiten im ⋮-Menü sendet nur Geändertes. */
  it('bearbeitet eine offene Nachforderung an der Karte (PATCH nur mit Geändertem)', async () => {
    patcheNachforderung.mockResolvedValue(nf({ prioritaet: 'sofort' }));
    renderPage();
    await screen.findByText('2 RTW zur Verstärkung');
    await waehleImMenue('Bearbeiten');
    const formular = await screen.findByRole('region', { name: /bearbeiten$/ });
    const details = within(formular).getByRole('textbox', { name: 'Details / Zweck' });
    await userEvent.clear(details);
    await userEvent.type(details, 'Transport aus der UHS');
    await userEvent.click(within(formular).getByRole('button', { name: 'Änderung speichern' }));
    await waitFor(() =>
      expect(patcheNachforderung).toHaveBeenCalledWith(1, 1, {
        bezeichnung: 'Transport aus der UHS',
      }),
    );
    expect(await screen.findByText('Änderung gespeichert')).toBeInTheDocument();
  });

  it('ordnet jede Nachforderung in die Spalte ihrer Stufe; Abgelehnt ist eingeklappt', async () => {
    listeNachforderungen.mockResolvedValue([
      nf({ id: 1, bezeichnung: 'Bedarf angefordert' }),
      nf({ id: 2, bezeichnung: 'Bedarf zugesagt', status: 'zugesagt' }),
      nf({ id: 3, bezeichnung: 'Bedarf unterwegs', status: 'unterwegs' }),
      nf({
        id: 4,
        bezeichnung: 'Bedarf eingetroffen',
        status: 'eingetroffen',
        ist_offen: false,
        eingetroffen_at: '2026-06-12 10:00:00',
      }),
      nf({
        id: 5,
        bezeichnung: 'Bedarf abgelehnt',
        status: 'abgelehnt',
        ist_offen: false,
        abgelehnt_at: '2026-06-12 10:00:00',
      }),
    ]);
    renderPage();
    await screen.findByText('Bedarf angefordert');
    // Alle laden (ohne Status-Filter), getrennt wird im Board.
    expect(listeNachforderungen).toHaveBeenCalledWith(1, {});
    expect(stufeVon('Bedarf angefordert')).toBe('angefordert');
    expect(stufeVon('Bedarf zugesagt')).toBe('zugesagt');
    expect(stufeVon('Bedarf unterwegs')).toBe('unterwegs');
    expect(stufeVon('Bedarf eingetroffen')).toBe('eingetroffen');
    expect(within(spalte('eingetroffen')!).getByText(/letzte 12 h/)).toBeInTheDocument();
    expect(screen.queryByText('Bedarf abgelehnt')).toBeNull();
    const zu = within(spalte('abgelehnt')!).getByRole('button', { name: /Abgelehnt/ });
    expect(zu).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(zu);
    expect(stufeVon('Bedarf abgelehnt')).toBe('abgelehnt');
  });

  it('Eingetroffene älter als 12 h stehen gesammelt unter „Ältere eingetroffen“', async () => {
    listeNachforderungen.mockResolvedValue([
      nf({
        id: 4,
        bezeichnung: 'Gestern eingetroffen',
        status: 'eingetroffen',
        ist_offen: false,
        eingetroffen_at: '2026-06-11 20:00:00',
      }),
    ]);
    renderPage();
    const knopf = await screen.findByRole('button', { name: 'Ältere eingetroffen (1)' });
    expect(screen.queryByText('Gestern eingetroffen')).toBeNull();
    await userEvent.click(knopf);
    expect(stufeVon('Gestern eingetroffen')).toBe('eingetroffen');
  });

  it('am Handy eine Segmentleiste der Stufen mit Zahl, Vorgabe die erste offene Stufe mit Karten', async () => {
    setzeViewportBreite(390);
    listeNachforderungen.mockResolvedValue([
      nf({ id: 2, bezeichnung: 'Bedarf zugesagt', status: 'zugesagt' }),
      nf({ id: 3, bezeichnung: 'Bedarf unterwegs', status: 'unterwegs' }),
    ]);
    renderPage();
    const leiste = await screen.findByRole('tablist', { name: 'Stufe' });
    expect(within(leiste).getByRole('tab', { name: 'Zugesagt 1' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(screen.getByText('Bedarf zugesagt')).toBeInTheDocument();
    expect(screen.queryByText('Bedarf unterwegs')).toBeNull();
    await userEvent.click(within(leiste).getByRole('tab', { name: 'Unterwegs 1' }));
    expect(screen.getByText('Bedarf unterwegs')).toBeInTheDocument();
    expect(screen.queryByText('Bedarf zugesagt')).toBeNull();
  });

  /**
   * Die eigene Fortschaltung trägt die Karte sofort in ihre neue Spalte, ohne Sprung der übrigen:
   * die Schleuse gibt den neuen Stand als Benutzeraktion frei, der Fokus folgt der Karte.
   */
  it('Fortschalten trägt die Karte in die nächste Spalte und den Fokus mit', async () => {
    listeNachforderungen.mockResolvedValue([
      nf({ id: 1, bezeichnung: 'Bedarf eins', status: 'zugesagt' }),
      nf({ id: 2, bezeichnung: 'Bedarf zwei', status: 'zugesagt' }),
    ]);
    setzeNachforderungStatus.mockImplementation(() => {
      listeNachforderungen.mockResolvedValue([
        nf({ id: 1, bezeichnung: 'Bedarf eins', status: 'unterwegs' }),
        nf({ id: 2, bezeichnung: 'Bedarf zwei', status: 'zugesagt' }),
      ]);
      return Promise.resolve(nf({ id: 1, status: 'unterwegs' }));
    });
    renderPage();
    await screen.findByText('Bedarf eins');
    const eins = screen.getByText('Bedarf eins').closest('[data-lfh="komm-karte"]') as HTMLElement;
    await userEvent.click(within(eins).getByRole('button', { name: 'Abfahrt melden' }));
    await waitFor(() => expect(stufeVon('Bedarf eins')).toBe('unterwegs'));
    expect(stufeVon('Bedarf zwei')).toBe('zugesagt');
    await waitFor(() =>
      expect(document.activeElement).toBe(document.querySelector('[data-nachforderung-id="1"]')),
    );
    expect(document.querySelector('[data-lfh="sammelbanner"]')).toBeNull();
  });

  /** Fremde Änderungen rücken nicht unter dem Fokus: der Sammelbanner nennt sie. */
  it('eine fremde Fortschaltung wartet hinter dem Sammelbanner, solange der Fokus im Board ist', async () => {
    listeNachforderungen.mockResolvedValue([
      nf({ id: 1, bezeichnung: 'Bedarf eins' }),
      nf({ id: 2, bezeichnung: 'Bedarf zwei' }),
    ]);
    renderPage();
    await screen.findByText('Bedarf eins');
    const zwei = screen.getByText('Bedarf zwei').closest('[data-lfh="komm-karte"]') as HTMLElement;
    act(() => within(zwei).getByRole('button', { name: 'Zusage erfassen' }).focus());
    act(() => {
      zuletztClient!.setQueryData(einsatzKeys.nachforderungen(1), [
        nf({ id: 1, bezeichnung: 'Bedarf eins', status: 'unterwegs' }),
        nf({ id: 2, bezeichnung: 'Bedarf zwei' }),
        nf({ id: 3, bezeichnung: 'Bedarf drei' }),
      ]);
    });
    const banner = await screen.findByText('1 neue Nachforderung · 1 in anderer Stufe');
    expect(stufeVon('Bedarf eins')).toBe('angefordert');
    expect(screen.queryByText('Bedarf drei')).toBeNull();
    await userEvent.click(
      within(banner.closest('[data-lfh="sammelbanner"]') as HTMLElement).getByRole('button', {
        name: 'anzeigen',
      }),
    );
    expect(stufeVon('Bedarf eins')).toBe('unterwegs');
    expect(screen.getByText('Bedarf drei')).toBeInTheDocument();
  });

  it('eingetroffene Nachforderung zeigt nur noch die Übernahme als Einheit oder Material (LLH-1226, LLH-1383)', async () => {
    listeNachforderungen.mockResolvedValue([
      nf({ status: 'eingetroffen', ist_offen: false, eingetroffen_at: '2026-06-12 10:00:00' }),
    ]);
    renderPage();
    await screen.findByText('2 RTW zur Verstärkung');
    expect(screen.queryByRole('button', { name: 'Ablehnen' })).not.toBeInTheDocument();
    const karte = screen.getByText('2 RTW zur Verstärkung').closest('[data-lfh="komm-karte"]');
    expect(
      within(karte as HTMLElement)
        .getAllByRole('button')
        .map((b) => b.textContent),
    ).toEqual(['Als Einheit übernehmen', 'Als Material übernehmen', 'Erfassten Posten zuordnen …']);
    expect(stufeVon('2 RTW zur Verstärkung')).toBe('eingetroffen');
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
        expect(screen.getByLabelText('Was')).toHaveValue(w.art);
        expect(screen.getByLabelText('Details / Zweck')).toHaveValue(w.bezeichnung);
        expect(screen.getByLabelText('Anzahl')).toHaveValue(w.anzahl);
        expect(begruendungFeld()).toHaveValue(w.begruendung);
      });
    const erwarteVorbelegt = () => erwarteMaske({ ...vorbelegung, anzahl: '20' });
    const erwarteLeer = () =>
      erwarteMaske({ art: '', bezeichnung: '', anzahl: '1', begruendung: '' });

    it('öffnet die Erfassung vorbelegt und räumt die Adresse', async () => {
      renderPage(deeplink);
      await erwarteVorbelegt();
      await waitFor(() =>
        expect(screen.getByTestId('ort')).toHaveTextContent(/^\/einsaetze\/1\/nachforderungen$/),
      );
    });

    it('ein Neuladen mit der geräumten Adresse öffnet nichts', async () => {
      const erster = renderPage(deeplink);
      await screen.findByLabelText('Was');
      await waitFor(() => expect(screen.getByTestId('ort').textContent).not.toContain('?'));
      const geraeumt = screen.getByTestId('ort').textContent ?? '';
      erster.unmount();

      renderPage(geraeumt);
      await screen.findByText('2 RTW zur Verstärkung');
      expect(screen.queryByLabelText('Was')).not.toBeInTheDocument();
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
      await waitFor(() => expect(screen.queryByLabelText('Was')).not.toBeInTheDocument());
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
      expect(screen.queryByLabelText('Was')).not.toBeInTheDocument();
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
  // Zugesagt: die Fortschaltung „Abfahrt melden“ ist ein Klick (die Zusage hat ihr Formular).
  const zweiNachforderungen = () =>
    listeNachforderungen.mockResolvedValue([
      nf({ id: 1, bezeichnung: 'Bedarf eins', status: 'zugesagt' }),
      nf({ id: 2, bezeichnung: 'Bedarf zwei', status: 'zugesagt' }),
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
    await userEvent.type(screen.getByLabelText('Was'), 'SEG');
    await userEvent.type(screen.getByLabelText('Details / Zweck'), 'Eine SEG');
    await setzeAb();

    expect(await screen.findByRole('alert')).toHaveTextContent('Art unbekannt');
    expect(screen.getByLabelText('Was')).toHaveValue('SEG');
    expect(document.querySelectorAll('.ant-message-notice')).toHaveLength(0);
  });

  it('Anlegen: das nächste Absetzen räumt den Grund', async () => {
    legeNachforderungAn
      .mockRejectedValueOnce(new ApiError(422, 'Art unbekannt'))
      .mockImplementationOnce(() => new Promise(() => {}));
    renderPage();
    await screen.findByText('2 RTW zur Verstärkung');
    await userEvent.click(screen.getByRole('button', { name: /Nachforderung anlegen/ }));
    await userEvent.type(screen.getByLabelText('Was'), 'SEG');
    await userEvent.type(screen.getByLabelText('Details / Zweck'), 'Eine SEG');
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
    await userEvent.type(screen.getByLabelText('Was'), 'SEG');
    await userEvent.type(screen.getByLabelText('Details / Zweck'), 'Eine SEG');
    await setzeAb();
    await screen.findByText('Art unbekannt');

    await userEvent.click(screen.getAllByRole('button', { name: 'Formular schließen' })[0]);
    await userEvent.click(screen.getByRole('button', { name: /Nachforderung anlegen/ }));
    await screen.findByLabelText('Was');
    expect(screen.queryByText('Art unbekannt')).not.toBeInTheDocument();
  });

  it('Fortschalten: der Grund steht an genau dieser Karte', async () => {
    zweiNachforderungen();
    setzeNachforderungStatus.mockRejectedValue(new ApiError(422, 'Übergang nicht erlaubt'));
    renderPage();
    await screen.findByText('Bedarf zwei');
    await userEvent.click(
      within(karte('Bedarf eins')).getByRole('button', { name: 'Abfahrt melden' }),
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
        : Promise.resolve(nf({ id: 2, status: 'unterwegs' })),
    );
    renderPage();
    await screen.findByText('Bedarf zwei');
    await userEvent.click(
      within(karte('Bedarf eins')).getByRole('button', { name: 'Abfahrt melden' }),
    );
    await userEvent.click(
      within(karte('Bedarf zwei')).getByRole('button', { name: 'Abfahrt melden' }),
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
    listeNachforderungen.mockResolvedValue([nf({ status: 'zugesagt' })]);
    setzeNachforderungStatus
      .mockRejectedValueOnce(new ApiError(422, 'Übergang nicht erlaubt'))
      .mockImplementationOnce(() => new Promise(() => {}));
    renderPage();
    await screen.findByText('2 RTW zur Verstärkung');
    await userEvent.click(screen.getByRole('button', { name: 'Abfahrt melden' }));
    await screen.findByText('Übergang nicht erlaubt');

    await userEvent.click(screen.getByRole('button', { name: 'Abfahrt melden' }));
    await waitFor(() =>
      expect(screen.queryByText('Übergang nicht erlaubt')).not.toBeInTheDocument(),
    );
  });

  /**
   * Nach der Ablehnung lädt die Seite neu (optimistische Sperre, 422): hat ein anderer Arbeitsplatz
   * das Eintreffen schon gemeldet, ist die Karte weiter. Solange der Fokus im Board ist, hält die
   * Schleuse sie in ihrer Spalte, mit ihrer neuen Stufe und dem Grund an der Karte.
   */
  const schonEingetroffen = () => {
    const unterwegs = nf({ status: 'unterwegs', unterwegs_at: '2026-06-12 09:30:00' });
    listeNachforderungen.mockResolvedValue([unterwegs]);
    setzeNachforderungStatus.mockImplementation(() => {
      listeNachforderungen.mockResolvedValue([
        nf({ status: 'eingetroffen', ist_offen: false, eingetroffen_at: '2026-06-12 10:00:00' }),
      ]);
      return Promise.reject(new ApiError(422, 'Bereits eingetroffen gemeldet'));
    });
  };
  const zeigeNeueOrdnung = async () => {
    const banner = await screen.findByText(/in anderer Stufe/);
    await userEvent.click(
      within(banner.closest('[data-lfh="sammelbanner"]') as HTMLElement).getByRole('button', {
        name: 'anzeigen',
      }),
    );
  };

  it('Fortschalten abgelehnt, weil schon weiter: die gehaltene Karte nennt ihre Stufe und den Grund', async () => {
    schonEingetroffen();
    renderPage();
    await screen.findByText('2 RTW zur Verstärkung');
    await userEvent.click(screen.getByRole('button', { name: 'Eintreffen melden' }));

    const k = karte('2 RTW zur Verstärkung');
    expect(await within(k).findByText('Bereits eingetroffen gemeldet')).toHaveAttribute(
      'data-fehler',
    );
    expect(stufeVon('2 RTW zur Verstärkung')).toBe('unterwegs');
    expect(within(k).getByText('Eingetroffen', { selector: '[data-lfh="status-chip"] span' }));
    // Die neue Ordnung bietet der Sammelbanner an; danach steht die Karte mit ihrem Grund dort.
    await zeigeNeueOrdnung();
    expect(stufeVon('2 RTW zur Verstärkung')).toBe('eingetroffen');
    expect(
      within(karte('2 RTW zur Verstärkung')).getByText('Bereits eingetroffen gemeldet'),
    ).toHaveAttribute('data-fehler');
    expect(document.querySelector('[data-lfh="seiten-beschreibung"] [role="alert"]')).toBeNull();
  });

  /** Am Handy kann die Karte aus der gezeigten Stufe wandern: dann steht ihr Grund oben. */
  it('Fortschalten: steht die Karte in einer anderen Stufe als der gezeigten, steht ihr Grund im Seitenhinweis', async () => {
    setzeViewportBreite(390);
    schonEingetroffen();
    renderPage();
    await screen.findByText('2 RTW zur Verstärkung');
    await userEvent.click(screen.getByRole('button', { name: 'Eintreffen melden' }));
    await zeigeNeueOrdnung();

    await waitFor(() => expect(screen.queryByText('2 RTW zur Verstärkung')).toBeNull());
    const hinweis = await seitenHinweis();
    const grund = await within(hinweis).findByRole('alert');
    expect(grund).toHaveTextContent('Bereits eingetroffen gemeldet');
    // Der Titel nennt die Nachforderung: oben steht nicht mehr, welche Karte gemeint ist.
    expect(grund).toHaveTextContent('Status von „2× RTW — 2 RTW zur Verstärkung“ nicht geändert');
    expect(document.querySelectorAll('.ant-message-error')).toHaveLength(0);

    // In der Stufe, die die Karte zeigt, steht der Grund wieder an ihr, nicht doppelt oben.
    await userEvent.click(screen.getByRole('tab', { name: 'Eingetroffen 1' }));
    expect(
      await within(karte('2 RTW zur Verstärkung')).findByText('Bereits eingetroffen gemeldet'),
    ).toHaveAttribute('data-fehler');
    expect(document.querySelector('[data-lfh="seiten-beschreibung"] [role="alert"]')).toBeNull();
  });

  /** Rückgängig kommt aus dem Toast; die Karte ist dann oft gewandert. */
  it('Rückgängig: eine abgelehnte Rücknahme steht im Seitenhinweis, nicht an der Karte', async () => {
    listeNachforderungen.mockResolvedValue([nf({ status: 'zugesagt' })]);
    setzeNachforderungStatus
      .mockResolvedValueOnce(nf({ status: 'unterwegs' }))
      .mockRejectedValueOnce(new ApiError(422, 'Rücknahme nicht erlaubt'));
    renderPage();
    await screen.findByText('2 RTW zur Verstärkung');
    await userEvent.click(screen.getByRole('button', { name: 'Abfahrt melden' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Rückgängig' }));

    const hinweis = await seitenHinweis();
    expect(await within(hinweis).findByRole('alert')).toHaveTextContent('Rücknahme nicht erlaubt');
    expect(document.querySelectorAll('[data-fehler]')).toHaveLength(0);
    expect(document.querySelectorAll('.ant-message-error')).toHaveLength(0);
  });

  it('Rückgängig: die nächste Rücknahme räumt den Seitenhinweis', async () => {
    listeNachforderungen.mockResolvedValue([nf({ status: 'zugesagt' })]);
    setzeNachforderungStatus
      .mockResolvedValueOnce(nf({ status: 'unterwegs' }))
      .mockRejectedValueOnce(new ApiError(422, 'Rücknahme nicht erlaubt'))
      .mockResolvedValueOnce(nf({ status: 'unterwegs' }))
      .mockImplementationOnce(() => new Promise(() => {}));
    renderPage();
    await screen.findByText('2 RTW zur Verstärkung');
    await userEvent.click(screen.getByRole('button', { name: 'Abfahrt melden' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Rückgängig' }));
    await screen.findByText('Rücknahme nicht erlaubt');

    await userEvent.click(screen.getByRole('button', { name: 'Abfahrt melden' }));
    await waitFor(() => expect(setzeNachforderungStatus).toHaveBeenCalledTimes(3));
    const rueckgaengig = await screen.findAllByRole('button', { name: 'Rückgängig' });
    await userEvent.click(rueckgaengig[rueckgaengig.length - 1]);
    await waitFor(() => expect(setzeNachforderungStatus).toHaveBeenCalledTimes(4));
    await waitFor(() =>
      expect(screen.queryByText('Rücknahme nicht erlaubt')).not.toBeInTheDocument(),
    );
  });

  async function lehneAbImDialog(grund = 'keine Reserven') {
    await waehleImMenue('Ablehnen');
    const dialog = await screen.findByRole('dialog');
    const feld = within(dialog).getByLabelText('Ablehnungsgrund');
    await userEvent.type(feld, grund);
    expect(feld).toHaveValue(grund);
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
    await waehleImMenue('Ablehnen');
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
    expect(await screen.findByText('Sandsäcke · 1200 · ohne Ort')).toBeInTheDocument();
    expect(screen.getByText('übernommen 1200 von 2000')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Weiteren Posten übernehmen' })).toBeInTheDocument();
  });

  // LLH-1259 D5: ein schon von Hand erfasster Posten wird zugeordnet, die Karte zählt ihn danach.
  it('ordnet einen vorhandenen Posten zu: POST an den eigenen Schreibweg, die Karte zählt ihn', async () => {
    let verknuepft = false;
    listeNachforderungen.mockImplementation(() =>
      Promise.resolve([sandsaecke({ material_ids: verknuepft ? [7] : [] })]),
    );
    materialServer(() => [posten({ nachforderung_id: verknuepft ? 4 : null })]);
    const aufrufe: { em: string; koerper: unknown }[] = [];
    server.use(
      http.post('/api/einsaetze/1/material/:em/nachforderung', async ({ request, params }) => {
        aufrufe.push({ em: String(params.em), koerper: await request.json() });
        verknuepft = true;
        return HttpResponse.json(posten());
      }),
    );
    renderPage();
    await userEvent.click(
      await screen.findByRole('button', { name: 'Erfassten Posten zuordnen …' }),
    );
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('Erfassten Posten „Sandsäcke“ zuordnen');
    await within(dialog).findByRole('combobox', { name: 'Posten' });
    await waehle('Posten', 'Sandsäcke · 1200 · ohne Ort');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Zuordnen' }));
    await waitFor(() => expect(aufrufe).toEqual([{ em: '7', koerper: { nachforderung_id: 4 } }]));
    expect(await screen.findByText('Posten zugeordnet')).toBeInTheDocument();
    expect(await screen.findByText('übernommen 1200 von 2000')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Weiteren Posten übernehmen' })).toBeInTheDocument();
  });

  it('ohne Material-Freigabe: kein Abruf der Materialliste, Knopf gesperrt, nur die Zahl', async () => {
    ladeModulFreigaben.mockResolvedValue(freigabenFixture({ material: { zugriff: false } }));
    listeNachforderungen.mockResolvedValue([sandsaecke({ material_ids: [7] })]);
    const { abrufe } = materialServer(() => [posten()]);
    renderPage();
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

  it('?nachforderung= zeigt die Stufe der Nachforderung, hebt ihre Karte hervor und räumt den Parameter', async () => {
    listeNachforderungen.mockResolvedValue([nf(), sandsaecke()]);
    materialServer(() => []);
    renderPage(nachforderungenPfad(1, { nachforderung: 4 }));
    const karte = await waitFor(() => {
      const k = document.querySelector('[data-nachforderung-id="4"]');
      expect(k).not.toBeNull();
      return k as HTMLElement;
    });
    expect(karte).toHaveAttribute('data-hervorgehoben', 'true');
    expect(karte.closest('[data-lfh="board-spalte"]')).toHaveAttribute(
      'data-stufe',
      'eingetroffen',
    );
    await waitFor(() =>
      expect(screen.getByTestId('ort')).toHaveTextContent(/^\/einsaetze\/1\/nachforderungen$/),
    );
  });

  it('?nachforderung= auf eine abgelehnte klappt Abgelehnt auf, am Handy wählt es ihre Stufe', async () => {
    setzeViewportBreite(390);
    listeNachforderungen.mockResolvedValue([
      nf(),
      sandsaecke({
        status: 'abgelehnt',
        eingetroffen_at: null,
        abgelehnt_at: '2026-06-12 10:00:00',
      }),
    ]);
    materialServer(() => []);
    renderPage(nachforderungenPfad(1, { nachforderung: 4 }));
    const karte = await waitFor(() => {
      const k = document.querySelector('[data-nachforderung-id="4"]');
      expect(k).not.toBeNull();
      return k as HTMLElement;
    });
    expect(karte).toHaveAttribute('data-hervorgehoben', 'true');
    expect(screen.getByRole('tab', { name: 'Abgelehnt 1' })).toHaveAttribute(
      'aria-selected',
      'true',
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
    expect(spalte('abgelehnt')!.querySelector('[aria-expanded="false"]')).not.toBeNull();
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

describe('NachforderungenPage — Als Einheit übernehmen (LLH-1383)', () => {
  const rtw = (over: Partial<Nachforderung> = {}) =>
    nf({
      id: 4,
      art: 'RTW',
      bezeichnung: '2 RTW zur Verstärkung',
      anzahl: 2,
      status: 'eingetroffen',
      ist_offen: false,
      eingetroffen_at: '2026-06-12 10:00:00',
      zusage_rufnamen: ['83-1', '83-2'],
      ziel_br_id: 3,
      ...over,
    });
  const einheit = (id: number, name: string, over: Record<string, unknown> = {}) => ({
    id,
    einsatz_id: 1,
    name,
    funkrufname: null,
    nachforderung_id: null,
    aufgeloest_at: null,
    ...over,
  });

  /** Einheiten, Typen und Räume über MSW; liefert die gesendeten POST-Körper. */
  function einheitServer(einheiten: () => unknown[]) {
    const koerper: unknown[] = [];
    server.use(
      http.get('/api/einsaetze/1/einheiten', () => HttpResponse.json(einheiten())),
      http.get('/api/einheit-typen', () =>
        HttpResponse.json([
          { id: 1, label: 'KTW', sortier: 1 },
          { id: 2, label: 'RTW', sortier: 2 },
        ]),
      ),
      http.get('/api/einsaetze/1/bereitstellungsraeume', () =>
        HttpResponse.json([{ id: 3, einsatz_id: 1, bezeichnung: 'Nord' }]),
      ),
      http.post('/api/einsaetze/1/einheiten/aus-nachforderung', async ({ request }) => {
        koerper.push(await request.json());
        return HttpResponse.json(rtw({ einheit_ids: [11, 12] }), { status: 201 });
      }),
    );
    return { koerper };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    ladeModulFreigaben.mockResolvedValue(freigabenFixture());
  });

  it('übernimmt mit Ziel BR Nord: Rufnamen und Typ vorbelegt, Haken gesetzt, ein POST', async () => {
    listeNachforderungen.mockResolvedValue([rtw()]);
    const { koerper } = einheitServer(() => []);
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Als Einheit übernehmen' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('„RTW“ als Einheit übernehmen');
    expect(within(dialog).getByText('83-1')).toBeInTheDocument();
    expect(within(dialog).getByText('83-2')).toBeInTheDocument();
    await within(dialog).findByText('RTW');
    const haken = await within(dialog).findByRole('checkbox', { name: 'In BR Nord eintragen' });
    expect(haken).toBeChecked();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Übernehmen' }));
    await waitFor(() =>
      expect(koerper).toEqual([
        {
          nachforderung_id: 4,
          einheiten: [{ name: '83-1' }, { name: '83-2' }],
          typ_id: 2,
          in_bereitstellungsraum: true,
        },
      ]),
    );
    expect(await screen.findByText('Einheiten übernommen')).toBeInTheDocument();
  });

  it('eine Einheit im Einsatz wird verknüpft, nicht neu angelegt', async () => {
    listeNachforderungen.mockResolvedValue([rtw({ zusage_rufnamen: ['83-1'] })]);
    const { koerper } = einheitServer(() => [einheit(5, 'Rettung', { funkrufname: '83-1' })]);
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Als Einheit übernehmen' }));
    const dialog = await screen.findByRole('dialog');
    expect(
      await within(dialog).findByText('Schon im Einsatz, wird verknüpft: 83-1'),
    ).toBeInTheDocument();
    await within(dialog).findByText('RTW');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Übernehmen' }));
    await waitFor(() =>
      expect(koerper).toEqual([
        {
          nachforderung_id: 4,
          einheiten: [{ einheit_id: 5 }],
          typ_id: 2,
          in_bereitstellungsraum: true,
        },
      ]),
    );
  });

  it('übernommene Einheiten stehen mit Sprung an der Karte; Material wird nicht mehr angeboten', async () => {
    listeNachforderungen.mockResolvedValue([rtw({ anzahl: 3, einheit_ids: [11, 12] })]);
    einheitServer(() => [
      einheit(11, 'Rettung 1', { funkrufname: '83-1', nachforderung_id: 4 }),
      einheit(12, '83-2', { nachforderung_id: 4 }),
    ]);
    renderPage();
    const link = await screen.findByRole('link', { name: '83-1' });
    expect(link).toHaveAttribute('href', '/einsaetze/1/einheiten/11');
    expect(screen.getByRole('link', { name: '83-2' })).toHaveAttribute(
      'href',
      '/einsaetze/1/einheiten/12',
    );
    expect(screen.getByRole('button', { name: 'Weitere Einheit übernehmen' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Als Material übernehmen' })).toBeNull();
  });

  it('ohne Freigabe Einheiten steht der Knopf gesperrt und die Karte nennt nur die Zahl', async () => {
    ladeModulFreigaben.mockResolvedValue(
      freigabenFixture({ einheiten: { sichtbar: false, zugriff: false } }),
    );
    listeNachforderungen.mockResolvedValue([rtw({ anzahl: 3, einheit_ids: [11] })]);
    einheitServer(() => []);
    renderPage();
    expect(
      await screen.findByRole('button', { name: 'Weitere Einheit übernehmen' }),
    ).toBeDisabled();
    expect(screen.getByText('1 Einheit übernommen')).toBeInTheDocument();
  });
});

/** LLH-1082 (design.md D7): Bedarf einer Betreuungsstelle — Bezug per Deeplink, Filter „für Stelle“. */
describe('NachforderungenPage — Betreuungsstelle (LLH-1082)', () => {
  const turnhalle = {
    id: 8,
    einsatz_id: 1,
    bezeichnung: 'Turnhalle Ost',
    art: 'notunterkunft',
    status: 'in_betrieb',
    angelegt_at: '2026-06-12 08:00:00',
  };
  const stadion = { ...turnhalle, id: 9, bezeichnung: 'Weserstadion' };
  const FELDBETTEN = nf({
    id: 1,
    art: 'Feldbetten',
    bezeichnung: 'Feldbetten für die Nacht',
    anzahl: 40,
    betreuungsstelle_id: 8,
  });
  const DECKEN = nf({
    id: 2,
    art: 'Decken',
    bezeichnung: 'Decken Stadion',
    betreuungsstelle_id: 9,
  });
  const RTW = nf({ id: 3 });

  let betreuungAbrufe: number;
  beforeEach(() => {
    vi.clearAllMocks();
    betreuungAbrufe = 0;
    ladeModulFreigaben.mockResolvedValue(freigabenFixture());
    listeNachforderungen.mockResolvedValue([FELDBETTEN, DECKEN, RTW]);
    server.use(
      http.get('/api/einsaetze/1/betreuung', () => {
        betreuungAbrufe += 1;
        return HttpResponse.json({ stellen: [turnhalle, stadion], namentlich: [] });
      }),
    );
  });

  it('?neu=1&betreuungsstelle= öffnet die Erfassung mit Bezug, räumt den Parameter und sendet die Kennung', async () => {
    legeNachforderungAn.mockResolvedValue(FELDBETTEN);
    renderPage('/einsaetze/1/nachforderungen?neu=1&betreuungsstelle=8&stelle=8');
    expect(await screen.findByLabelText('Was')).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByTestId('ort')).toHaveTextContent('/einsaetze/1/nachforderungen?stelle=8'),
    );
    const bezug = document.querySelector('[data-lfh="nachforderung-bezug"]') as HTMLElement;
    await waitFor(() => expect(bezug).toHaveTextContent('Für Betreuungsstelle Turnhalle Ost'));
    await waitFor(() =>
      expect(screen.getByLabelText('Begründung / Lagebezug')).toHaveValue(
        'Für Betreuungsstelle Turnhalle Ost',
      ),
    );

    await userEvent.type(screen.getByLabelText('Was'), 'Decken');
    await userEvent.type(screen.getByLabelText('Details / Zweck'), '100 Wolldecken');
    await userEvent.click(screen.getByRole('button', { name: 'Nachforderung absetzen' }));
    await waitFor(() =>
      expect(legeNachforderungAn).toHaveBeenCalledWith(
        1,
        expect.objectContaining({ art: 'Decken', betreuungsstelle_id: 8 }),
      ),
    );
  });

  it('Schließen räumt den Bezug: die nächste Erfassung ist ohne Stelle', async () => {
    legeNachforderungAn.mockResolvedValue(RTW);
    renderPage('/einsaetze/1/nachforderungen?neu=1&betreuungsstelle=8');
    await screen.findByLabelText('Was');
    await userEvent.click(screen.getAllByRole('button', { name: 'Formular schließen' })[0]);
    await waitFor(() => expect(screen.queryByLabelText('Was')).toBeNull());
    await userEvent.click(screen.getByRole('button', { name: /Nachforderung anlegen/ }));
    await screen.findByLabelText('Was');
    expect(document.querySelector('[data-lfh="nachforderung-bezug"]')).toBeNull();
    expect(screen.getByLabelText('Begründung / Lagebezug')).toHaveValue('');
  });

  it('die Karte nennt ihre Stelle mit Sprung', async () => {
    renderPage();
    await screen.findByText('Feldbetten für die Nacht');
    expect(await screen.findByRole('link', { name: /Turnhalle Ost/ })).toHaveAttribute(
      'href',
      '/einsaetze/1/betreuung/8',
    );
  });

  it('?stelle= filtert Board und Spaltenzahlen, nennt den Filter und setzt ihn zurück', async () => {
    renderPage('/einsaetze/1/nachforderungen?stelle=8');
    await screen.findByText('Feldbetten für die Nacht');
    expect(screen.queryByText('Decken Stadion')).toBeNull();
    expect(screen.queryByText('2 RTW zur Verstärkung')).toBeNull();
    // Die Spaltenzahl zählt im Filter; der Seitenkopf liest den Server-Zähler.
    expect(within(spalte('angefordert')!).getByText('1', { selector: '[data-lfh="board-zahl"]' }));
    expect(
      await screen.findByText(/Betreuungsstelle Turnhalle Ost/, { selector: 'span' }),
    ).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Filter zurücksetzen' }));
    expect(await screen.findByText('Decken Stadion')).toBeInTheDocument();
    expect(screen.getByText('2 RTW zur Verstärkung')).toBeInTheDocument();
    expect(screen.getByTestId('ort')).toHaveTextContent(/^\/einsaetze\/1\/nachforderungen$/);
  });

  it('die Wahl „Für Stelle“ bietet die Stellen mit Bezug und setzt den Filter in die Adresse', async () => {
    renderPage();
    await screen.findByText('Decken Stadion');
    const wahl = await screen.findByRole('combobox', { name: 'Für Stelle' });
    await userEvent.click(wahl);
    await userEvent.click(
      document.querySelector(
        '.ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option[title="Weserstadion"]',
      ) as HTMLElement,
    );
    await waitFor(() =>
      expect(screen.getByTestId('ort')).toHaveTextContent('/einsaetze/1/nachforderungen?stelle=9'),
    );
    expect(screen.queryByText('Feldbetten für die Nacht')).toBeNull();
    expect(screen.getByText('Decken Stadion')).toBeInTheDocument();
  });

  it('ohne Freigabe Betreuung: kein Abruf der Stellen, keine Wahl, die Karte sagt „Für eine Betreuungsstelle“', async () => {
    ladeModulFreigaben.mockResolvedValue(freigabenFixture({ betreuung: { zugriff: false } }));
    renderPage();
    await screen.findByText('Feldbetten für die Nacht');
    expect(screen.getAllByText('Für eine Betreuungsstelle')).toHaveLength(2);
    expect(screen.queryByRole('combobox', { name: 'Für Stelle' })).toBeNull();
    expect(betreuungAbrufe).toBe(0);
  });

  it('ohne Bezüge ruft die Seite die Betreuungsübersicht nicht ab', async () => {
    listeNachforderungen.mockResolvedValue([RTW]);
    renderPage();
    await screen.findByText('2 RTW zur Verstärkung');
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(betreuungAbrufe).toBe(0);
    expect(screen.queryByRole('combobox', { name: 'Für Stelle' })).toBeNull();
  });
});
