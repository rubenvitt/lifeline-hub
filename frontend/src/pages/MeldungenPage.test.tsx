import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App as AntApp } from 'antd';
import { MemoryRouter, Routes, Route, useLocation, useNavigate } from 'react-router';
import MeldungenPage from './MeldungenPage';
import { AuthProvider } from '../auth/AuthContext';
import type { Meldung } from '../api/types';
import { ladeEinsatz } from '../api/einsaetze';
import { queueLeerenFuerTests, schreibaktionenLaden } from '../offline/queue';
import { meHandler, server } from '../test/server';
import { benutzerFixture } from '../test/fixtures';
import { setzeOnline } from '../test/utils';
import { ApiError } from '../api/client';

vi.mock('../live/useEinsatzLiveStream', () => ({ useEinsatzLiveStream: () => {} }));
vi.mock('../api/einsaetze', () => ({
  ladeEinsatz: vi.fn().mockResolvedValue({
    id: 1,
    bezeichnung: 'Lage',
    status: 'aktiv',
    meine_rolle: 'einsatzleitung',
  }),
  ladeMitglieder: vi.fn().mockResolvedValue([
    {
      benutzer_id: 2,
      anzeigename: 'Sani Schmidt',
      benutzername: 'sani',
      einsatz_rolle: 'fuehrungspersonal',
      zugewiesen_at: '',
    },
  ]),
}));

const listeMeldungen = vi.fn();
const legeMeldungAn = vi.fn();
const setzeMeldungStatus = vi.fn();
const weiseBearbeiterZu = vi.fn();
const markiereLagerelevant = vi.fn();
const bestaetigeMeldung = vi.fn();
const erteileAuftragAusMeldung = vi.fn();
// Die Seite liest offen, abgeschlossen, Kennzahlen und Einzelabruf getrennt (LFH-940). Die
// Bestandstests geben weiter EINE Liste vor (`listeMeldungen`); die Attrappe schneidet daraus, was
// der Server je Abruf liefern würde. Eigene Aussagen zum Blättern: `MeldungenPage.blaettern.test`.
vi.mock('../api/meldungen', async () => {
  const echt = await vi.importActual<typeof import('../api/meldungen')>('../api/meldungen');
  const { meldungKennzahlen } = await vi.importActual<
    typeof import('../meldungen/meldungKennzahlen')
  >('../meldungen/meldungKennzahlen');
  const liste = async (id: number, richtung?: string) =>
    ((await listeMeldungen(id, { richtung })) ?? []) as Meldung[];
  return {
    MELDUNGEN_SEITE: echt.MELDUNGEN_SEITE,
    abschlussCursor: echt.abschlussCursor,
    listeOffeneMeldungen: async (id: number, richtung?: string) =>
      (await liste(id, richtung)).filter((m) => m.status !== 'erledigt'),
    listeAbgeschlosseneMeldungen: async (id: number, richtung?: string) =>
      (await liste(id, richtung))
        .filter((m) => m.status === 'erledigt')
        .sort((a, b) =>
          (b.erledigt_at ?? b.ereigniszeit).localeCompare(a.erledigt_at ?? a.ereigniszeit),
        ),
    ladeMeldungKennzahlen: async (id: number, richtung?: string) => {
      const k = meldungKennzahlen(await liste(id, richtung));
      return {
        unbearbeitet: k.unbearbeitet,
        in_arbeit: k.inArbeit,
        alarmiert: k.bestaetigungUeberfaellig,
        erledigt: k.erledigt,
      };
    },
    ladeMeldung: async (id: number, mid: number) => {
      const m = (await liste(id)).find((x) => x.id === mid);
      if (!m) throw new Error('404');
      return m;
    },
    legeMeldungAn: (...a: unknown[]) => legeMeldungAn(...a),
    setzeMeldungStatus: (...a: unknown[]) => setzeMeldungStatus(...a),
    weiseBearbeiterZu: (...a: unknown[]) => weiseBearbeiterZu(...a),
    markiereLagerelevant: (...a: unknown[]) => markiereLagerelevant(...a),
    bestaetigeMeldung: (...a: unknown[]) => bestaetigeMeldung(...a),
    erteileAuftragAusMeldung: (...a: unknown[]) => erteileAuftragAusMeldung(...a),
  };
});
// Auftrags-Ziele: MeldungenPage lädt sie für das Meldung→Auftrag-Formular.
vi.mock('../api/einsatzabschnitte', () => ({ listeAbschnitte: vi.fn().mockResolvedValue([]) }));
vi.mock('../api/einheiten', () => ({ listeEinheiten: vi.fn().mockResolvedValue([]) }));

const meldung = (over: Partial<Meldung> = {}): Meldung => ({
  id: 1,
  einsatz_id: 1,
  lfd_nr: 1,
  absender: 'Florian Nord 1',
  empfaenger: 'ELW 1',
  meldeweg: 'funk',
  inhalt: 'Deich instabil',
  meldungsart: 'sofortmeldung',
  prioritaet: 'normal',
  richtung: 'intern',
  status: 'neu',
  bearbeiter_id: null,
  bearbeiter_name: null,
  lagerelevant: false,
  ereigniszeit: '2026-06-12 09:00:00',
  eingang_at: '2026-06-12 09:05:00',
  etb_meldung_id: 7,
  auftrag_id: null,
  erfasst_von_id: 1,
  erstellt_at: '2026-06-12 09:05:00',
  lage_meldung_id: null,
  ist_offen: true,
  erledigt_at: null,
  bestaetigung_pflicht: false,
  bestaetigung_frist_at: null,
  eskaliert: false,
  bestaetigt_at: null,
  bestaetigt_von_id: null,
  bestaetigt_von_name: null,
  ist_bestaetigt: false,
  ist_ueberfaellig: false,
  ...over,
});

/**
 * Greift das geöffnete Dropdown-Portal der Aktionsbündelung. antd lässt die Portale geschlossener
 * Dropdowns im Baum stehen, und ein verlassendes Portal bekommt in jsdom nie `hidden` — deshalb
 * über `pointerEvents` filtern und genau einen Treffer verlangen. Bewusste Kopie aus
 * `meldungen/MeldungKarte.test.tsx`: ein Import aus einer fremden `.test.tsx` zöge deren Suite in
 * jeden Lauf dieser hier.
 */
async function oeffneAktionsmenue(lfdNr = 1): Promise<HTMLElement> {
  await userEvent.click(screen.getByRole('button', { name: `Aktionen zu Meldung ${lfdNr}` }));
  const offen = [...document.querySelectorAll<HTMLElement>('.ant-dropdown')].filter(
    (d) => !d.classList.contains('ant-dropdown-hidden') && d.style.pointerEvents !== 'none',
  );
  expect(offen).toHaveLength(1);
  const menue = offen[0].querySelector<HTMLElement>('[role="menu"]');
  if (!menue) throw new Error(`Das Aktionsmenü zu Meldung ${lfdNr} ließ sich nicht öffnen`);
  return menue;
}

/** Macht den aktuellen Query-String im DOM sichtbar (für apply-then-clean-Assertions). */
function LocationProbe() {
  return <span data-testid="loc-search">{useLocation().search}</span>;
}

/** Wechselt in einen anderen Einsatz, ohne die Seite neu einzuhängen (Route ohne `key`). */
function ZuEinsatz({ id }: { id: number }) {
  const navigate = useNavigate();
  return (
    <button type="button" onClick={() => navigate(`/einsaetze/${id}/meldungen`)}>
      Zu Einsatz {id}
    </button>
  );
}

function renderPage(
  route = '/einsaetze/1/meldungen',
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } }),
) {
  server.use(meHandler(benutzerFixture({ anzeigename: 'Leitung' })));
  return render(
    <QueryClientProvider client={client}>
      <AntApp>
        <AuthProvider>
          <MemoryRouter initialEntries={[route]}>
            <LocationProbe />
            <ZuEinsatz id={1} />
            <ZuEinsatz id={2} />
            <Routes>
              <Route path="/einsaetze/:id/meldungen" element={<MeldungenPage />} />
            </Routes>
          </MemoryRouter>
        </AuthProvider>
      </AntApp>
    </QueryClientProvider>,
  );
}

describe('MeldungenPage', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    setzeOnline(true);
    await queueLeerenFuerTests();
    listeMeldungen.mockResolvedValue([meldung()]);
  });

  it('zeigt eingegangene Meldungen im Posteingang', async () => {
    renderPage();
    expect(await screen.findByText('Florian Nord 1')).toBeInTheDocument();
    expect(screen.getByText('Deich instabil')).toBeInTheDocument();
    // Status-Chip „Neu" der Meldung (eindeutig über den Chip; „Neu" steht auch im Gruppenkopf).
    expect(
      screen.getByText('Neu', { selector: '[data-lfh="status-chip"] span' }),
    ).toBeInTheDocument();
  });

  it('erfasst eine Meldung mit Mindestfeldern (Absender, Inhalt, Meldeweg)', async () => {
    legeMeldungAn.mockResolvedValue(meldung());
    renderPage();
    await screen.findByText('Florian Nord 1');
    // Inline-Formular: erst per Kopf-Knopf aufklappen (Icon → Name „plus …").
    await userEvent.click(screen.getByRole('button', { name: /Meldung erfassen/ }));
    await userEvent.type(screen.getByLabelText('Absender'), 'RTW 2');
    await userEvent.type(screen.getByLabelText('Inhalt / Wortlaut'), 'Eingetroffen');
    // Der Kopf-Knopf heißt jetzt „Formular schließen" → exakt „Meldung erfassen" ist der Submit.
    await userEvent.click(screen.getByRole('button', { name: 'Meldung erfassen' }));
    await waitFor(() =>
      expect(legeMeldungAn).toHaveBeenCalledWith(
        1,
        expect.objectContaining({
          absender: 'RTW 2',
          inhalt: 'Eingetroffen',
          meldeweg: 'funk',
        }),
        { offlineQueueBenutzerId: 1 },
      ),
    );
    // Ereigniszeit wird immer mitgesendet (Pflicht, leer ⇒ jetzt).
    expect(legeMeldungAn.mock.calls[0][1].ereigniszeit).toMatch(
      /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/,
    );
  });

  it('merkt den vollständigen Wortlaut offline sichtbar vor', async () => {
    renderPage();
    await screen.findByText('Florian Nord 1');
    // Online geladen, dann fällt das Netz weg: so liegt es im Einsatz.
    setzeOnline(false);
    await userEvent.click(screen.getByRole('button', { name: /Meldung erfassen/ }));
    await userEvent.type(screen.getByLabelText('Absender'), 'RTW 2');
    await userEvent.type(screen.getByLabelText('Inhalt / Wortlaut'), 'Offline-Lage');
    await userEvent.click(screen.getByRole('button', { name: 'Meldung erfassen' }));

    expect(await screen.findByText('Offline vorgemerkt: Meldung von RTW 2')).toBeInTheDocument();
    expect(legeMeldungAn).not.toHaveBeenCalled();
    expect(await schreibaktionenLaden(1, 1)).toEqual([
      expect.objectContaining({
        aktion: expect.objectContaining({
          art: 'meldung',
          daten: expect.objectContaining({ absender: 'RTW 2', inhalt: 'Offline-Lage' }),
        }),
      }),
    ]);
  });

  it('trennt Offen/Abgeschlossen und zeigt Offen als Default', async () => {
    listeMeldungen.mockResolvedValue([
      meldung({ id: 1, status: 'neu', ist_offen: true }),
      meldung({ id: 2, lfd_nr: 2, absender: 'RTW 9', status: 'erledigt', ist_offen: false }),
    ]);
    renderPage();
    // Default-Ansicht „Offen": nur nicht-erledigte sichtbar.
    expect(await screen.findByText('Florian Nord 1')).toBeInTheDocument();
    expect(screen.queryByText('RTW 9')).not.toBeInTheDocument();
    // Umschalten auf „Abgeschlossen": nur erledigte sichtbar (eigener Abruf, LFH-940).
    await userEvent.click(screen.getByText(/Abgeschlossen \(/));
    expect(await screen.findByText('RTW 9')).toBeInTheDocument();
    expect(screen.queryByText('Florian Nord 1')).not.toBeInTheDocument();
  });

  it('zeigt eine erledigte Meldung im Abgeschlossen-View mit Erledigt-Zeitpunkt und Quittungs-Read-back', async () => {
    // Abgeschlossen zeigt den Erledigt-Zeitpunkt (erledigt_at); die Quittungs-Achse (bestaetigt_at)
    // bleibt daneben bestehen.
    listeMeldungen.mockResolvedValue([
      meldung({
        id: 2,
        lfd_nr: 2,
        absender: 'RTW 9',
        status: 'erledigt',
        ist_offen: false,
        erledigt_at: '2026-06-12 09:30:00',
        bestaetigung_pflicht: true,
        ist_bestaetigt: true,
        bestaetigt_at: '2026-06-12 09:06:00',
        bestaetigt_von_name: 'Leit',
      }),
    ]);
    renderPage();
    await screen.findByText(/Abgeschlossen \(/);
    await userEvent.click(screen.getByText(/Abgeschlossen \(/));
    expect(await screen.findByText('RTW 9')).toBeInTheDocument();
    expect(screen.getByText(/^Erledigt:/)).toBeInTheDocument();
    expect(screen.getByText(/✓ Quittiert von Leit/)).toBeInTheDocument();
  });

  it('filtert nach Richtung extern (LFH-87)', async () => {
    renderPage();
    await screen.findByText('Florian Nord 1');
    await userEvent.click(screen.getByText('Extern'));
    await waitFor(() =>
      expect(listeMeldungen).toHaveBeenCalledWith(
        1,
        expect.objectContaining({ richtung: 'extern' }),
      ),
    );
  });

  it('hält beim Filterwechsel die vorherige Liste samt Zählern, bis die neue da ist (LFH-351)', async () => {
    // Beim ersten Wechsel auf einen Richtungsfilter ist der neue Key kalt; ohne `placeholderData`
    // zeigte die Seite für die Dauer des Requests „Keine Meldungen" und „0 offen".
    // Offene Liste und Kennzahlen fragen je einmal (LFH-940); beide warten auf dieselbe Antwort.
    const wartende: ((m: Meldung[]) => void)[] = [];
    const antworte = (m: Meldung[]) => wartende.forEach((r) => r(m));
    listeMeldungen.mockImplementation((_id: number, f: { richtung?: string }) =>
      f.richtung === 'extern'
        ? new Promise<Meldung[]>((resolve) => {
            wartende.push(resolve);
          })
        : Promise.resolve([meldung()]),
    );
    renderPage();
    await screen.findByText('Florian Nord 1');
    await userEvent.click(screen.getByText('Extern'));
    await waitFor(() =>
      expect(listeMeldungen).toHaveBeenCalledWith(
        1,
        expect.objectContaining({ richtung: 'extern' }),
      ),
    );
    // Während der Request läuft: alte Liste und Zähler stehen, kein Leerzustand.
    expect(screen.getByText('Florian Nord 1')).toBeInTheDocument();
    expect(screen.getByText('1 offen · 0 abgeschlossen')).toBeInTheDocument();
    expect(screen.queryByText('Keine Meldungen')).not.toBeInTheDocument();
    // Gegenaussage: sobald die Antwort da ist, gilt sie — das Platzhalten ist kein Einfrieren.
    antworte([]);
    expect(await screen.findByText('Keine Meldungen')).toBeInTheDocument();
    expect(screen.queryByText('Florian Nord 1')).not.toBeInTheDocument();
  });

  it('Beobachter sieht Posteingang, aber keine Erfassung', async () => {
    vi.mocked(ladeEinsatz).mockResolvedValueOnce({
      id: 1,
      bezeichnung: 'Lage',
      status: 'aktiv',
      meine_rolle: 'beobachter',
    } as Awaited<ReturnType<typeof ladeEinsatz>>);
    renderPage();
    expect(await screen.findByText('Florian Nord 1')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Meldung erfassen' })).not.toBeInTheDocument();
  });

  // --- Sichten/Status/Beobachter ---

  it('sichtet eine neue Meldung', async () => {
    setzeMeldungStatus.mockResolvedValue(meldung({ status: 'gesichtet' }));
    renderPage();
    await screen.findByText('Florian Nord 1');
    // „Sichten" ist die Vorwärtsbewegung einer neuen Meldung und steht als sichtbarer Knopf, ohne
    // Rückfrage (der Schritt ist umkehrbar).
    await userEvent.click(screen.getByRole('button', { name: 'Sichten' }));
    await waitFor(() => expect(setzeMeldungStatus).toHaveBeenCalledWith(1, 1, 'gesichtet'));
  });

  it('setzt eine Meldung auf erledigt', async () => {
    setzeMeldungStatus.mockResolvedValue(meldung({ status: 'erledigt' }));
    renderPage();
    await screen.findByText('Florian Nord 1');
    // Die Meldung ist `neu` → „Als erledigt melden" ist der Sprung und liegt im Menü. Die
    // Rückfrage dort ist ein Dialog, kein Popconfirm.
    const menue = await oeffneAktionsmenue();
    await userEvent.click(within(menue).getByRole('menuitem', { name: /Als erledigt melden/ }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Als erledigt melden' }));
    await waitFor(() => expect(setzeMeldungStatus).toHaveBeenCalledWith(1, 1, 'erledigt'));
  });

  it('Beobachter sieht keine Status-Aktionen', async () => {
    vi.mocked(ladeEinsatz).mockResolvedValueOnce({
      id: 1,
      bezeichnung: 'Lage',
      status: 'aktiv',
      meine_rolle: 'beobachter',
    } as Awaited<ReturnType<typeof ladeEinsatz>>);
    renderPage();
    await screen.findByText('Florian Nord 1');
    expect(screen.queryByRole('button', { name: 'Sichten' })).not.toBeInTheDocument();
    // Ohne Schreibrecht gibt es gar keinen Auslöser. „Der Menüeintrag fehlt" wäre schwächer: ein
    // Menü, das nie existiert, hat trivial keinen Eintrag.
    expect(screen.queryByRole('button', { name: /Aktionen zu Meldung/ })).not.toBeInTheDocument();
  });

  // --- Lage-Übergabe ---

  it('übergibt eine Meldung an die Lage (ohne Verortung)', async () => {
    markiereLagerelevant.mockResolvedValue(meldung({ lagerelevant: true }));
    renderPage();
    await screen.findByText('Florian Nord 1');
    await userEvent.click(
      within(await oeffneAktionsmenue()).getByRole('menuitem', { name: /An Lage übergeben/ }),
    );
    // Modal öffnet sich; ohne Koordinate direkt übergeben.
    await userEvent.click(await screen.findByRole('button', { name: 'Übergeben' }));
    await waitFor(() => expect(markiereLagerelevant).toHaveBeenCalledTimes(1));
    const [eid, mid, daten] = markiereLagerelevant.mock.calls[0];
    expect(eid).toBe(1);
    expect(mid).toBe(1);
    expect((daten as { lat?: number }).lat).toBeUndefined();
    expect((daten as { lon?: number }).lon).toBeUndefined();
  });

  it('übergibt eine Meldung an die Lage MIT Verortung (lat/lon im Request)', async () => {
    markiereLagerelevant.mockResolvedValue(meldung({ lagerelevant: true }));
    renderPage();
    await screen.findByText('Florian Nord 1');
    await userEvent.click(
      within(await oeffneAktionsmenue()).getByRole('menuitem', { name: /An Lage übergeben/ }),
    );
    // Die formatbewusste Eingabe (KoordinatenEingabe) ist ein Feld: im WGS84-Default wird "lat,
    // lon" getippt.
    await userEvent.type(await screen.findByPlaceholderText('Koordinate eingeben'), '50.1, 8.6');
    await userEvent.click(screen.getByRole('button', { name: 'Übergeben' }));
    await waitFor(() => expect(markiereLagerelevant).toHaveBeenCalledTimes(1));
    const [eid, mid, daten] = markiereLagerelevant.mock.calls[0];
    expect(eid).toBe(1);
    expect(mid).toBe(1);
    expect(daten).toMatchObject({ lat: 50.1, lon: 8.6 });
  });

  it('zeigt lagerelevante Meldung als markiert, ohne erneute Übergabe-Aktion', async () => {
    listeMeldungen.mockResolvedValue([meldung({ lagerelevant: true, lage_meldung_id: 9 })]);
    renderPage();
    await screen.findByText('Florian Nord 1');
    expect(screen.getByText('Lagerelevant ✓')).toBeInTheDocument();
    // Die Aktion muss im geöffneten Menü fehlen. Vor dem ersten Öffnen ist
    // `queryByRole('menuitem')` immer `null` (rc-dropdown mountet lazy). Dass andere Einträge
    // dastehen, belegt, dass das Menü aufging.
    const menue = await oeffneAktionsmenue();
    expect(within(menue).getAllByRole('menuitem').length).toBeGreaterThan(0);
    expect(
      within(menue).queryByRole('menuitem', { name: /An Lage übergeben/ }),
    ).not.toBeInTheDocument();
  });

  it('weist einer Meldung einen Bearbeiter zu', async () => {
    weiseBearbeiterZu.mockResolvedValue(
      meldung({ bearbeiter_id: 2, bearbeiter_name: 'Sani Schmidt' }),
    );
    renderPage();
    await screen.findByText('Florian Nord 1');
    // antd Select über combobox-Rolle+Name öffnen, dann den echten Options-Knoten klicken (Commit
    // über onChange).
    await userEvent.click(screen.getByRole('combobox', { name: 'Bearbeiter für Meldung 1' }));
    await userEvent.click(await screen.findByText('Sani Schmidt'));
    await waitFor(() => expect(weiseBearbeiterZu).toHaveBeenCalledWith(1, 1, 2));
  });

  // --- Sofortmeldung bestätigungspflichtig ---

  it('zeigt überfällige Sofortmeldung hervorgehoben und bestätigt sie', async () => {
    listeMeldungen.mockResolvedValue([
      meldung({
        bestaetigung_pflicht: true,
        ist_bestaetigt: false,
        ist_ueberfaellig: true,
        prioritaet: 'sofort',
      }),
    ]);
    bestaetigeMeldung.mockResolvedValue(
      meldung({ bestaetigung_pflicht: true, ist_bestaetigt: true }),
    );
    renderPage();
    await screen.findByText('Florian Nord 1');
    // Auf der Karte; dasselbe Wort steht seit LFH-959 auch als Kennzahl im Band darüber.
    const karte = document.querySelector('[data-meldung-id="1"]') as HTMLElement;
    expect(within(karte).getByText(/Bestätigung überfällig/)).toBeInTheDocument();
    // Link-Button „Bestätigen" öffnet Popconfirm; OK-Knopf heißt ebenfalls „Bestätigen".
    await userEvent.click(screen.getByRole('button', { name: 'Bestätigen' }));
    const popconfirms = await screen.findAllByRole('button', { name: 'Bestätigen' });
    await userEvent.click(popconfirms[popconfirms.length - 1]);
    await waitFor(() => expect(bestaetigeMeldung).toHaveBeenCalledWith(1, 1));
  });

  it('zeigt eskalierte (auch ohne ist_ueberfaellig) Sofortmeldung als (eskaliert)', async () => {
    listeMeldungen.mockResolvedValue([
      meldung({
        bestaetigung_pflicht: true,
        ist_bestaetigt: false,
        ist_ueberfaellig: false,
        eskaliert: true,
        prioritaet: 'sofort',
      }),
    ]);
    renderPage();
    await screen.findByText('Florian Nord 1');
    expect(screen.getByText(/Bestätigung überfällig \(eskaliert\)/)).toBeInTheDocument();
  });

  it('zeigt bestätigte Sofortmeldung ohne Bestätigen-Aktion', async () => {
    listeMeldungen.mockResolvedValue([
      meldung({
        bestaetigung_pflicht: true,
        ist_bestaetigt: true,
        bestaetigt_at: '2026-06-12 09:06:00',
        bestaetigt_von_name: 'Leit',
      }),
    ]);
    renderPage();
    await screen.findByText('Florian Nord 1');
    // Bestätigt → Quittungs-Achse (QuittungIndikator) statt Status-Badge.
    expect(screen.getByText(/✓ Quittiert/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Bestätigen' })).not.toBeInTheDocument();
    // „Bestätigen" ist ein sichtbarer Knopf und gehört in kein Menü — die zweite Hälfte belegt,
    // dass die Aktion nicht bloß dorthin gewandert ist.
    expect(
      within(await oeffneAktionsmenue()).queryByRole('menuitem', { name: /Bestätigen/ }),
    ).not.toBeInTheDocument();
  });

  // --- Meldung→Auftrag ---

  it('erteilt aus einer Meldung einen Auftrag, vorbefüllt mit Absender + Inhalt', async () => {
    erteileAuftragAusMeldung.mockResolvedValue(meldung({ auftrag_id: 42 }));
    renderPage();
    await screen.findByText('Florian Nord 1');
    await userEvent.click(
      within(await oeffneAktionsmenue()).getByRole('menuitem', { name: /Auftrag erteilen/ }),
    );
    // Auftragstext ist mit „Absender: Inhalt" vorbelegt (Meldungsvorblendung).
    const textfeld = await screen.findByLabelText('Auftrag / Was');
    expect(textfeld).toHaveValue('Florian Nord 1: Deich instabil');
    // Minimal validen Empfänger über das Funktions-Freitextfeld ergänzen.
    await userEvent.type(screen.getByLabelText('Empfänger'), 'S3{Enter}');
    // Submit-Button des Formulars heißt ebenfalls „Auftrag erteilen".
    const buttons = await screen.findAllByRole('button', { name: 'Auftrag erteilen' });
    await userEvent.click(buttons[buttons.length - 1]);
    await waitFor(() =>
      expect(erteileAuftragAusMeldung).toHaveBeenCalledWith(
        1,
        1,
        expect.objectContaining({ auftrag_text: 'Florian Nord 1: Deich instabil' }),
      ),
    );
  });

  it('zeigt bei verknüpfter Meldung einen Backlink zum Auftrag statt der Erteilen-Aktion', async () => {
    listeMeldungen.mockResolvedValue([meldung({ auftrag_id: 42 })]);
    renderPage();
    await screen.findByText('Florian Nord 1');
    const backlink = screen.getByRole('link', { name: /Auftrag/ });
    // Der Backlink selektiert den ausgelösten Auftrag (?auftrag=) statt nur die Liste.
    expect(backlink).toHaveAttribute('href', '/einsaetze/1/auftraege?auftrag=42');
    expect(screen.queryByRole('button', { name: 'Auftrag erteilen' })).not.toBeInTheDocument();
    // Und auch nicht im Menü — sonst prüfte die Aussage nur den Kartenkörper, in dem die Aktion
    // ohnehin nicht steht.
    const menue = await oeffneAktionsmenue();
    expect(within(menue).getAllByRole('menuitem').length).toBeGreaterThan(0);
    expect(
      within(menue).queryByRole('menuitem', { name: /Auftrag erteilen/ }),
    ).not.toBeInTheDocument();
  });

  it('Fast-Path-Button erfasst Sofortmeldung mit Bestätigungspflicht', async () => {
    legeMeldungAn.mockResolvedValue(meldung());
    renderPage();
    await screen.findByText('Florian Nord 1');
    // Inline-Formular: erst aufklappen (Icon → Name „plus …"), dann Fast-Path + Submit.
    await userEvent.click(screen.getByRole('button', { name: /Meldung erfassen/ }));
    await userEvent.click(screen.getByRole('button', { name: /Sofortmeldung/ }));
    await userEvent.type(screen.getByLabelText('Absender'), 'RTW 2');
    await userEvent.type(screen.getByLabelText('Inhalt / Wortlaut'), 'MANV');
    // Der Kopf-Knopf heißt jetzt „Formular schließen" → exakt „Meldung erfassen" ist der Submit.
    await userEvent.click(screen.getByRole('button', { name: 'Meldung erfassen' }));
    await waitFor(() =>
      expect(legeMeldungAn).toHaveBeenCalledWith(
        1,
        expect.objectContaining({
          meldungsart: 'sofortmeldung',
          prioritaet: 'sofort',
          bestaetigung_pflicht: true,
        }),
        { offlineQueueBenutzerId: 1 },
      ),
    );
  });

  // --- Serienerfassung im Inline-Formular ---

  /** Formular aufklappen und eine vollständige Meldung eintippen. */
  async function oeffneUndFuelle(inhalt = 'Eingetroffen') {
    await userEvent.click(screen.getByRole('button', { name: /Meldung erfassen/ }));
    await userEvent.type(screen.getByLabelText('Absender'), 'RTW 2');
    await userEvent.type(screen.getByLabelText('Inhalt / Wortlaut'), inhalt);
  }

  it('lässt das Inline-Formular nach dem Senden offen und behält den Serienzustand', async () => {
    legeMeldungAn.mockResolvedValue(meldung());
    renderPage();
    await screen.findByText('Florian Nord 1');
    await oeffneUndFuelle();
    // Der Schalter steht per Vorgabe aus; der Absender unten belegt die Übernahme nur, wenn er hier
    // eingeschaltet wurde.
    await userEvent.click(screen.getByRole('checkbox', { name: 'Werte behalten' }));
    await userEvent.click(screen.getByRole('button', { name: 'Speichern und nächste' }));
    await waitFor(() => expect(legeMeldungAn).toHaveBeenCalledTimes(1));

    // Das Formular steht nach dem Senden noch; ein Zuklappen unmountete es samt Zähler und
    // Wertübernahme.
    expect(screen.getByLabelText('Inhalt / Wortlaut')).toBeInTheDocument();
    // Zähler und Wertübernahme leben im Formular: nur sie belegen, dass es nicht bloß neu montiert
    // wurde. Der Nachlade-Lauf nach invalidiere() darf sie nicht kippen.
    expect(await screen.findByText(/Erfasst: 1/)).toBeInTheDocument();
    expect(screen.getByLabelText('Absender')).toHaveValue('RTW 2');
    // Die Umschaltung ist auch in der Einbettung ohne eigene Card sichtbar (`card={false}` ist der
    // einzige Produktivpfad; die Formular-Tests rendern die Default-Card).
    expect(screen.getByRole('checkbox', { name: 'Werte behalten' })).toBeInTheDocument();
  });

  it('schließt das Inline-Formular nur auf ausdrückliche Nutzeraktion', async () => {
    legeMeldungAn.mockResolvedValue(meldung());
    renderPage();
    await screen.findByText('Florian Nord 1');
    await oeffneUndFuelle();
    await userEvent.click(screen.getByRole('button', { name: 'Meldung erfassen' }));
    await waitFor(() => expect(legeMeldungAn).toHaveBeenCalledTimes(1));
    expect(screen.getByLabelText('Inhalt / Wortlaut')).toBeInTheDocument();
    // Das Kreuz an der Card trägt als einziges ein aria-label — der Kopf-Umschalter heißt gleich,
    // hat seinen Namen aber aus dem Text.
    await userEvent.click(screen.getByLabelText('Formular schließen'));
    await waitFor(() =>
      expect(screen.queryByLabelText('Inhalt / Wortlaut')).not.toBeInTheDocument(),
    );
  });

  it('lässt den Wortlaut stehen, wenn das Anlegen fehlschlägt', async () => {
    legeMeldungAn.mockRejectedValue(new Error('Netz weg'));
    renderPage();
    await screen.findByText('Florian Nord 1');
    await oeffneUndFuelle('Wichtiger Wortlaut');
    await userEvent.click(screen.getByRole('button', { name: 'Meldung erfassen' }));
    await waitFor(() => expect(legeMeldungAn).toHaveBeenCalledTimes(1));
    expect(screen.getByLabelText('Inhalt / Wortlaut')).toHaveValue('Wichtiger Wortlaut');
    expect(screen.getByLabelText('Absender')).toHaveValue('RTW 2');
  });

  // --- Deeplink-Selektion ?meldung= ---

  it('?meldung=<id> hebt die Ziel-Meldung hervor und räumt den Param', async () => {
    listeMeldungen.mockResolvedValue([
      meldung({ id: 1, inhalt: 'Andere Meldung' }),
      meldung({ id: 5, lfd_nr: 5, inhalt: 'Ziel-Meldung' }),
    ]);
    const { container } = renderPage('/einsaetze/1/meldungen?meldung=5');
    await screen.findByText('Ziel-Meldung');
    const karte = container.querySelector('[data-meldung-id="5"]');
    expect(karte).toBeTruthy();
    await waitFor(() => expect(karte).toHaveAttribute('data-hervorgehoben', 'true'));
    expect(container.querySelector('[data-meldung-id="1"]')).not.toHaveAttribute(
      'data-hervorgehoben',
    );
    // apply-then-clean: der Selektions-Param ist aus der URL geräumt.
    await waitFor(() => expect(screen.getByTestId('loc-search').textContent).toBe(''));
  });

  it('?meldung=<id> einer erledigten Meldung schaltet auf die Abgeschlossen-Ansicht', async () => {
    listeMeldungen.mockResolvedValue([
      meldung({ id: 1, inhalt: 'Offene Meldung', status: 'neu', ist_offen: true }),
      meldung({
        id: 9,
        lfd_nr: 9,
        inhalt: 'Erledigte Meldung',
        status: 'erledigt',
        ist_offen: false,
        erledigt_at: '2026-06-12 12:00:00',
      }),
    ]);
    const { container } = renderPage('/einsaetze/1/meldungen?meldung=9');
    // Ohne Umschaltung wäre die erledigte Meldung in der Default-Offen-Ansicht unsichtbar.
    expect(await screen.findByText('Erledigte Meldung')).toBeInTheDocument();
    await waitFor(() =>
      expect(container.querySelector('[data-meldung-id="9"]')).toHaveAttribute(
        'data-hervorgehoben',
        'true',
      ),
    );
  });

  /**
   * Die neuen Meldungen stehen unter eigenem Kopf: die erste Frage der Triage ist „was hat noch
   * niemand angefasst", nicht „was ist am dringendsten". Innerhalb jeder Gruppe bleibt die
   * bisherige Ordnung.
   */
  it('stellt die neuen Meldungen unter einen eigenen Kopf mit korrekter Zahl', async () => {
    listeMeldungen.mockResolvedValue([
      meldung({ id: 1, lfd_nr: 1, status: 'neu', inhalt: 'Erste neue' }),
      meldung({ id: 2, lfd_nr: 2, status: 'neu', inhalt: 'Zweite neue' }),
      meldung({ id: 3, lfd_nr: 3, status: 'gesichtet', inhalt: 'Bereits gesichtet' }),
      meldung({ id: 4, lfd_nr: 4, status: 'in_bearbeitung', inhalt: 'Läuft schon' }),
      // Die erledigte liegt in der Abgeschlossen-Ansicht und zählt in keinem der beiden Köpfe mit.
      meldung({ id: 5, lfd_nr: 5, status: 'erledigt', ist_offen: false, inhalt: 'Fertig' }),
    ]);
    renderPage();
    expect(await screen.findByText('Neu (2)')).toBeInTheDocument();
    expect(screen.getByText('In Arbeit (2)')).toBeInTheDocument();
  });

  it('bietet nach dem Sichten den Rückweg auf den vorherigen Status an', async () => {
    setzeMeldungStatus.mockResolvedValue(meldung({ status: 'gesichtet' }));
    renderPage();
    await screen.findByText('Deich instabil');
    await userEvent.click(screen.getByRole('button', { name: 'Sichten' }));
    await waitFor(() => expect(setzeMeldungStatus).toHaveBeenCalledWith(1, 1, 'gesichtet'));

    await userEvent.click(await screen.findByRole('button', { name: 'Rückgängig' }));
    // Zurück auf den Stand vor dem Klick, nicht auf einen erratenen Anfang.
    await waitFor(() => expect(setzeMeldungStatus).toHaveBeenLastCalledWith(1, 1, 'neu'));
  });

  /**
   * Wer aus einer Meldung einen Auftrag erteilt, hat sie bearbeitet: die Quellmeldung geht auf „In
   * Bearbeitung".
   */
  it('setzt die Quellmeldung auf „In Bearbeitung", wenn aus ihr ein Auftrag wird', async () => {
    erteileAuftragAusMeldung.mockResolvedValue({ id: 5 });
    setzeMeldungStatus.mockResolvedValue(meldung({ status: 'in_bearbeitung' }));
    renderPage();
    await screen.findByText('Deich instabil');

    const menue = await oeffneAktionsmenue();
    await userEvent.click(within(menue).getByText(/Auftrag erteilen/));
    await userEvent.type(await screen.findByLabelText('Auftrag / Was'), 'Riegelstellung');
    await userEvent.type(screen.getByLabelText('Empfänger'), 'EA Nord{Enter}');
    await userEvent.click(screen.getByRole('button', { name: 'Auftrag erteilen' }));

    await waitFor(() => expect(erteileAuftragAusMeldung).toHaveBeenCalled());
    await waitFor(() => expect(setzeMeldungStatus).toHaveBeenCalledWith(1, 1, 'in_bearbeitung'));
  });

  it('lässt eine bereits laufende Meldung beim Auftrag-Erteilen in Ruhe', async () => {
    listeMeldungen.mockResolvedValue([meldung({ status: 'in_bearbeitung' })]);
    erteileAuftragAusMeldung.mockResolvedValue({ id: 5 });
    renderPage();
    await screen.findByText('Deich instabil');

    const menue = await oeffneAktionsmenue();
    await userEvent.click(within(menue).getByText(/Auftrag erteilen/));
    await userEvent.type(await screen.findByLabelText('Auftrag / Was'), 'Riegelstellung');
    await userEvent.type(screen.getByLabelText('Empfänger'), 'EA Nord{Enter}');
    await userEvent.click(screen.getByRole('button', { name: 'Auftrag erteilen' }));

    await waitFor(() => expect(erteileAuftragAusMeldung).toHaveBeenCalled());
    // Ohne diesen Riegel schriebe die Seite denselben Status noch einmal — ein PATCH samt
    // Invalidierung und Live-Ereignis für nichts.
    expect(setzeMeldungStatus).not.toHaveBeenCalled();
  });

  it('lässt eine leere Gruppe ganz weg, statt „Neu (0)" zu zeigen', async () => {
    listeMeldungen.mockResolvedValue([
      meldung({ id: 3, lfd_nr: 3, status: 'gesichtet', inhalt: 'Bereits gesichtet' }),
    ]);
    renderPage();
    expect(await screen.findByText('In Arbeit (1)')).toBeInTheDocument();
    expect(screen.queryByText(/^Neu \(/)).not.toBeInTheDocument();
  });

  it('verdichtet die Mengen im Kennzahlenband — aus derselben Liste wie die Gruppen', async () => {
    listeMeldungen.mockResolvedValue([
      meldung({ id: 1, lfd_nr: 1, status: 'neu' }),
      meldung({
        id: 2,
        lfd_nr: 2,
        status: 'gesichtet',
        bestaetigung_pflicht: true,
        ist_ueberfaellig: true,
      }),
      meldung({ id: 3, lfd_nr: 3, status: 'erledigt' }),
    ]);
    renderPage();
    const band = await screen.findByRole('group', { name: 'Meldungen in Zahlen' });
    const wert = (titel: string) =>
      within(band)
        .getByText(titel)
        .closest('[data-lfh="kennzahl"]')!
        .querySelector('[data-lfh="kennzahl-wert"]')!.textContent;
    await waitFor(() => expect(wert('Unbearbeitet')).toBe('1'));
    expect(wert('In Arbeit')).toBe('1');
    // Derselbe Wortlaut wie Modulzähler und Lage-Dashboard (LFH-959).
    expect(wert('Bestätigung überfällig')).toBe('1');
    expect(wert('Erledigt')).toBe('1');
    expect(screen.queryByText(/Alarmiert/)).not.toBeInTheDocument();
    // Auf der Karte steht dasselbe Wort im Chip, kein eigenes „Alarm" daneben.
    const karte = document.querySelector('[data-meldung-id="2"]') as HTMLElement;
    expect(within(karte).getByText('Bestätigung überfällig')).toBeInTheDocument();
    expect(within(karte).queryByText(/^\s*Alarm\s*$/)).not.toBeInTheDocument();
  });
});

/**
 * Ablehnungen am Ort (LFH-1077, `frontend/AGENTS.md`, „Rückwege und Fehler“): Erfassen im Paneel,
 * Status, Bearbeiter und Bestätigen an der Karte, Lage-Übergabe und Auftrag im Dialog, Rückgängig
 * im Seitenhinweis; kein Fehler-Toast.
 */
describe('MeldungenPage · Ablehnung am Ort (LFH-1077)', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    setzeOnline(true);
    await queueLeerenFuerTests();
    listeMeldungen.mockResolvedValue([meldung()]);
  });
  afterEach(() => {
    for (const m of [
      legeMeldungAn,
      setzeMeldungStatus,
      weiseBearbeiterZu,
      markiereLagerelevant,
      bestaetigeMeldung,
      erteileAuftragAusMeldung,
    ])
      m.mockReset();
  });

  const karte = (id = 1) => document.querySelector(`[data-meldung-id="${id}"]`) as HTMLElement;
  const seitenHinweis = () =>
    waitFor(() => {
      const h = document.querySelector<HTMLElement>('[data-lfh="seiten-beschreibung"]');
      expect(h).not.toBeNull();
      return h as HTMLElement;
    });
  const paneel = () => within(screen.getByRole('region', { name: 'Neue Meldung erfassen' }));
  /** Der offene Dialog; rc-dialog lässt einen schließenden in jsdom stehen. */
  const offenerDialog = () =>
    waitFor(() => {
      const offen = screen
        .getAllByRole('dialog')
        .filter((d) => d.closest('.ant-zoom-leave') == null);
      expect(offen).toHaveLength(1);
      return offen[0];
    });

  async function erfasse() {
    await userEvent.click(screen.getByRole('button', { name: /Meldung erfassen/ }));
    await userEvent.type(paneel().getByLabelText('Absender'), 'RTW 2');
    await userEvent.type(paneel().getByLabelText('Inhalt / Wortlaut'), 'Eingetroffen');
    await userEvent.click(paneel().getByRole('button', { name: 'Meldung erfassen' }));
  }

  it('Erfassen: der Grund steht im Paneel, der Wortlaut bleibt, kein Toast', async () => {
    legeMeldungAn.mockRejectedValue(new ApiError(422, 'Absender unbekannt'));
    renderPage();
    await screen.findByText('Florian Nord 1');
    await erfasse();

    const grund = await paneel().findByRole('alert');
    expect(grund).toHaveTextContent('Meldung nicht erfasst');
    expect(grund).toHaveTextContent('Absender unbekannt');
    expect(paneel().getByLabelText('Inhalt / Wortlaut')).toHaveValue('Eingetroffen');
    expect(document.querySelectorAll('.ant-message-notice')).toHaveLength(0);
  });

  it('Erfassen: das nächste Absenden räumt, das Paneel bleibt bis zur Antwort', async () => {
    legeMeldungAn
      .mockRejectedValueOnce(new ApiError(422, 'Absender unbekannt'))
      .mockImplementationOnce(() => new Promise(() => {}));
    renderPage();
    await screen.findByText('Florian Nord 1');
    await erfasse();
    await paneel().findByText('Absender unbekannt');

    await userEvent.click(paneel().getByRole('button', { name: 'Meldung erfassen' }));
    await waitFor(() => expect(legeMeldungAn).toHaveBeenCalledTimes(2));
    expect(paneel().queryByText('Absender unbekannt')).toBeNull();
    expect(paneel().getByRole('button', { name: 'Formular schließen' })).toBeDisabled();
  });

  it('Erfassen: Zuklappen und erneutes Öffnen zeigen keinen alten Grund', async () => {
    legeMeldungAn.mockRejectedValue(new ApiError(422, 'Absender unbekannt'));
    renderPage();
    await screen.findByText('Florian Nord 1');
    await erfasse();
    await paneel().findByText('Absender unbekannt');

    await userEvent.click(paneel().getByRole('button', { name: 'Formular schließen' }));
    await userEvent.click(screen.getByRole('button', { name: /Meldung erfassen/ }));
    expect(paneel().queryByRole('alert')).toBeNull();
  });

  it('Status: der Grund steht an genau dieser Karte, kein Toast', async () => {
    listeMeldungen.mockResolvedValue([meldung(), meldung({ id: 2, lfd_nr: 2, absender: 'B' })]);
    setzeMeldungStatus.mockRejectedValue(new ApiError(422, 'Übergang nicht erlaubt'));
    renderPage();
    await screen.findByText('B');
    await userEvent.click(within(karte(1)).getByRole('button', { name: 'Sichten' }));

    expect(await within(karte(1)).findByText('Übergang nicht erlaubt')).toHaveAttribute(
      'data-fehler',
    );
    expect(karte(2).querySelector('[data-fehler]')).toBeNull();
    expect(document.querySelectorAll('.ant-message-notice')).toHaveLength(0);
  });

  /** `useMutation` verfolgt nur den letzten Aufruf; der Grund kommt aus den Callbacks. */
  it('Status: zwei Karten nebenläufig, die Ablehnung steht an ihrer Karte', async () => {
    listeMeldungen.mockResolvedValue([meldung(), meldung({ id: 2, lfd_nr: 2, absender: 'B' })]);
    let lehneAb: (e: Error) => void = () => {};
    setzeMeldungStatus.mockImplementation((_e: number, mid: number) =>
      mid === 1
        ? new Promise((_r, reject) => (lehneAb = reject))
        : Promise.resolve(meldung({ id: 2, status: 'gesichtet' })),
    );
    renderPage();
    await screen.findByText('B');
    await userEvent.click(within(karte(1)).getByRole('button', { name: 'Sichten' }));
    await userEvent.click(within(karte(2)).getByRole('button', { name: 'Sichten' }));
    await waitFor(() => expect(setzeMeldungStatus).toHaveBeenCalledTimes(2));
    await act(async () => lehneAb(new ApiError(409, 'Zwischenzeitlich geändert')));

    expect(await within(karte(1)).findByText('Zwischenzeitlich geändert')).toHaveAttribute(
      'data-fehler',
    );
    expect(document.querySelectorAll('[data-fehler]')).toHaveLength(1);
    // Karte 2 hat Erfolg und damit ihren Rückgängig-Toast; ein Fehler-Toast fehlt.
    expect(document.querySelectorAll('.ant-message-error')).toHaveLength(0);
  });

  it('Bearbeiter: der Grund steht an der Karte, die nächste Aktion dort räumt ihn', async () => {
    weiseBearbeiterZu.mockRejectedValue(new ApiError(422, 'Kein Mitglied'));
    setzeMeldungStatus.mockImplementation(() => new Promise(() => {}));
    renderPage();
    await screen.findByText('Florian Nord 1');
    await userEvent.click(screen.getByRole('combobox', { name: 'Bearbeiter für Meldung 1' }));
    await userEvent.click(await screen.findByText('Sani Schmidt'));

    expect(await within(karte()).findByText('Kein Mitglied')).toHaveAttribute('data-fehler');
    expect(document.querySelectorAll('.ant-message-notice')).toHaveLength(0);

    await userEvent.click(within(karte()).getByRole('button', { name: 'Sichten' }));
    await waitFor(() => expect(setzeMeldungStatus).toHaveBeenCalledTimes(1));
    expect(within(karte()).queryByText('Kein Mitglied')).toBeNull();
  });

  it('Bestätigen: der Grund steht an der Karte, kein Toast', async () => {
    listeMeldungen.mockResolvedValue([
      meldung({ bestaetigung_pflicht: true, ist_ueberfaellig: true }),
    ]);
    bestaetigeMeldung.mockRejectedValue(new ApiError(409, 'Bereits bestätigt'));
    renderPage();
    await screen.findByText('Florian Nord 1');
    await userEvent.click(within(karte()).getByRole('button', { name: 'Bestätigen' }));
    const pop = await screen.findByRole('tooltip');
    await userEvent.click(within(pop).getByRole('button', { name: 'Bestätigen' }));

    expect(await within(karte()).findByText('Bereits bestätigt')).toHaveAttribute('data-fehler');
    expect(document.querySelectorAll('.ant-message-notice')).toHaveLength(0);
  });

  it('Status: wechselt die Ansicht vor der Antwort, steht der Grund im Seitenhinweis', async () => {
    let lehneAb: (e: Error) => void = () => {};
    setzeMeldungStatus.mockImplementationOnce(
      () => new Promise((_r, reject) => (lehneAb = reject)),
    );
    renderPage();
    await screen.findByText('Florian Nord 1');
    await userEvent.click(screen.getByRole('button', { name: 'Sichten' }));
    await userEvent.click(screen.getByText(/^Abgeschlossen \(/));
    await waitFor(() => expect(karte()).toBeNull());
    await act(async () => lehneAb(new ApiError(422, 'Übergang nicht erlaubt')));

    const grund = await within(await seitenHinweis()).findByRole('alert');
    expect(grund).toHaveTextContent('Meldung #1 nicht geändert');
    expect(grund).toHaveTextContent('Übergang nicht erlaubt');
    expect(document.querySelectorAll('.ant-message-notice')).toHaveLength(0);

    await userEvent.click(screen.getByText(/^Offen \(/));
    expect(await within(karte()).findByText('Übergang nicht erlaubt')).toHaveAttribute(
      'data-fehler',
    );
    expect(document.querySelector('[data-lfh="seiten-beschreibung"] [role="alert"]')).toBeNull();
  });

  /** Gewandert in „Abgeschlossen“ hat die Karte keine Aktion mehr, die den Grund räumte. */
  it('Status: wandert die Karte nach der Ablehnung, lässt sich der Hinweis schließen', async () => {
    setzeMeldungStatus.mockRejectedValue(new ApiError(409, 'Zwischenzeitlich erledigt'));
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    renderPage(undefined, qc);
    await screen.findByText('Florian Nord 1');
    await userEvent.click(within(karte()).getByRole('button', { name: 'Sichten' }));
    await within(karte()).findByText('Zwischenzeitlich erledigt');

    // Ein fremder Abschluss kommt als Ereignis an: die Karte steht nun unter „Abgeschlossen“.
    listeMeldungen.mockResolvedValue([
      meldung({ status: 'erledigt', ist_offen: false, erledigt_at: '2026-06-12 09:30:00' }),
    ]);
    await act(() => qc.invalidateQueries());
    await waitFor(() => expect(karte()).toBeNull());

    const hinweis = await seitenHinweis();
    const grund = await within(hinweis).findByRole('alert');
    expect(grund).toHaveTextContent('Meldung #1 nicht geändert');
    expect(grund).toHaveTextContent('Zwischenzeitlich erledigt');

    await userEvent.click(within(hinweis).getByRole('button', { name: 'Hinweis schließen' }));
    await waitFor(() =>
      expect(document.querySelector('[data-lfh="seiten-beschreibung"] [role="alert"]')).toBeNull(),
    );
    // Verworfen, nicht nur ausgeblendet: auch an der Karte steht er nicht mehr.
    await userEvent.click(screen.getByText(/^Abgeschlossen \(/));
    await waitFor(() => expect(karte()).not.toBeNull());
    expect(karte().querySelector('[data-fehler]')).toBeNull();
    expect(document.querySelector('[data-lfh="seiten-beschreibung"] [role="alert"]')).toBeNull();
  });

  it('Status: alle Gründe ohne gezeigte Karte stehen im Seitenhinweis', async () => {
    listeMeldungen.mockResolvedValue([meldung(), meldung({ id: 2, lfd_nr: 2, absender: 'B' })]);
    setzeMeldungStatus
      .mockRejectedValueOnce(new ApiError(422, 'Übergang nicht erlaubt'))
      .mockRejectedValueOnce(new ApiError(409, 'Zwischenzeitlich geändert'));
    renderPage();
    await screen.findByText('B');
    await userEvent.click(within(karte(1)).getByRole('button', { name: 'Sichten' }));
    await userEvent.click(within(karte(2)).getByRole('button', { name: 'Sichten' }));
    await within(karte(2)).findByText('Zwischenzeitlich geändert');

    await userEvent.click(screen.getByText(/^Abgeschlossen \(/));
    await waitFor(() => expect(karte(1)).toBeNull());
    const grund = await within(await seitenHinweis()).findByRole('alert');
    expect(grund).toHaveTextContent('Meldung #1 · Übergang nicht erlaubt');
    expect(grund).toHaveTextContent('Meldung #2 · Zwischenzeitlich geändert');
  });

  it('Status: solange die andere Ansicht lädt, springt kein Grund in den Seitenhinweis', async () => {
    setzeMeldungStatus.mockRejectedValue(new ApiError(422, 'Übergang nicht erlaubt'));
    renderPage();
    await screen.findByText('Florian Nord 1');
    await userEvent.click(within(karte()).getByRole('button', { name: 'Sichten' }));
    await within(karte()).findByText('Übergang nicht erlaubt');

    const aufrufe = listeMeldungen.mock.calls.length;
    let liefere: (l: Meldung[]) => void = () => {};
    listeMeldungen.mockImplementationOnce(() => new Promise((r) => (liefere = r)));
    await userEvent.click(screen.getByText(/^Abgeschlossen \(/));
    await waitFor(() => expect(listeMeldungen.mock.calls.length).toBeGreaterThan(aufrufe));
    expect(document.querySelector('[data-lfh="seiten-beschreibung"] [role="alert"]')).toBeNull();

    await act(async () => liefere([meldung()]));
    const grund = await within(await seitenHinweis()).findByRole('alert');
    expect(grund).toHaveTextContent('Übergang nicht erlaubt');
  });

  it('Rückgängig: abgelehnte Rücknahme im Seitenhinweis, die nächste räumt', async () => {
    setzeMeldungStatus
      .mockResolvedValueOnce(meldung({ status: 'gesichtet' }))
      .mockRejectedValueOnce(new ApiError(422, 'Rücknahme nicht erlaubt'))
      .mockResolvedValueOnce(meldung({ status: 'gesichtet' }))
      .mockImplementationOnce(() => new Promise(() => {}));
    renderPage();
    await screen.findByText('Florian Nord 1');
    await userEvent.click(screen.getByRole('button', { name: 'Sichten' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Rückgängig' }));

    const grund = await within(await seitenHinweis()).findByRole('alert');
    expect(grund).toHaveTextContent('Nicht zurückgenommen');
    expect(grund).toHaveTextContent('Rücknahme nicht erlaubt');
    expect(document.querySelectorAll('[data-fehler]')).toHaveLength(0);
    expect(document.querySelectorAll('.ant-message-error')).toHaveLength(0);

    await userEvent.click(screen.getByRole('button', { name: 'Sichten' }));
    await waitFor(() => expect(setzeMeldungStatus).toHaveBeenCalledTimes(3));
    const rueckgaengig = await screen.findAllByRole('button', { name: 'Rückgängig' });
    await userEvent.click(rueckgaengig[rueckgaengig.length - 1]);
    await waitFor(() => expect(setzeMeldungStatus).toHaveBeenCalledTimes(4));
    expect(screen.queryByText('Rücknahme nicht erlaubt')).toBeNull();
  });

  async function oeffneLage() {
    await userEvent.click(
      within(await oeffneAktionsmenue()).getByRole('menuitem', { name: /An Lage übergeben/ }),
    );
    return offenerDialog();
  }

  it('Lage: der Dialog bleibt bei einer Ablehnung offen, mit Text und Grund', async () => {
    markiereLagerelevant.mockRejectedValue(new ApiError(409, 'Schon übergeben'));
    renderPage();
    await screen.findByText('Florian Nord 1');
    const dialog = await oeffneLage();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Übergeben' }));

    const grund = await within(dialog).findByRole('alert');
    expect(grund).toHaveTextContent('Nicht übergeben');
    expect(grund).toHaveTextContent('Schon übergeben');
    expect(within(dialog).getByLabelText('Lage-Text')).toHaveValue('Deich instabil');
    expect(dialog.closest('.ant-zoom-leave')).toBeNull();
    expect(document.querySelectorAll('.ant-message-notice')).toHaveLength(0);
  });

  it('Lage: wartet auf die Antwort, sperrt Abbrechen, das nächste Absenden räumt', async () => {
    markiereLagerelevant
      .mockRejectedValueOnce(new ApiError(409, 'Schon übergeben'))
      .mockImplementationOnce(() => new Promise(() => {}));
    renderPage();
    await screen.findByText('Florian Nord 1');
    const dialog = await oeffneLage();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Übergeben' }));
    await within(dialog).findByRole('alert');

    await userEvent.click(within(dialog).getByRole('button', { name: 'Übergeben' }));
    await waitFor(() => expect(markiereLagerelevant).toHaveBeenCalledTimes(2));
    expect(within(dialog).queryByRole('alert')).toBeNull();
    expect(within(dialog).getByRole('button', { name: 'Abbrechen' })).toBeDisabled();
  });

  it('Lage: Abbrechen und erneutes Öffnen zeigen keinen alten Grund', async () => {
    markiereLagerelevant.mockRejectedValue(new ApiError(409, 'Schon übergeben'));
    renderPage();
    await screen.findByText('Florian Nord 1');
    const dialog = await oeffneLage();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Übergeben' }));
    await within(dialog).findByRole('alert');

    await userEvent.click(within(dialog).getByRole('button', { name: 'Abbrechen' }));
    const wieder = await oeffneLage();
    expect(within(wieder).queryByRole('alert')).toBeNull();
  });

  async function erteileAuftrag() {
    await userEvent.click(within(await oeffneAktionsmenue()).getByText(/Auftrag erteilen/));
    const dialog = await offenerDialog();
    await userEvent.type(within(dialog).getByLabelText('Auftrag / Was'), 'Riegelstellung');
    await userEvent.type(within(dialog).getByLabelText('Empfänger'), 'EA Nord{Enter}');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Auftrag erteilen' }));
    return dialog;
  }

  it('Auftrag: der Dialog bleibt bei einer Ablehnung offen, mit Grund, kein Toast', async () => {
    erteileAuftragAusMeldung.mockRejectedValue(new ApiError(422, 'Empfänger unbekannt'));
    renderPage();
    await screen.findByText('Florian Nord 1');
    const dialog = await erteileAuftrag();

    const grund = await within(dialog).findByRole('alert');
    expect(grund).toHaveTextContent('Auftrag nicht erteilt');
    expect(grund).toHaveTextContent('Empfänger unbekannt');
    expect(within(dialog).getByLabelText('Auftrag / Was')).toHaveValue(
      'Florian Nord 1: Deich instabilRiegelstellung',
    );
    expect(document.querySelectorAll('.ant-message-notice')).toHaveLength(0);
    expect(setzeMeldungStatus).not.toHaveBeenCalled();
  });

  it('Auftrag: wartet auf die Antwort, ohne Ausweg, und das nächste Absenden räumt', async () => {
    erteileAuftragAusMeldung
      .mockRejectedValueOnce(new ApiError(422, 'Empfänger unbekannt'))
      .mockImplementationOnce(() => new Promise(() => {}));
    renderPage();
    await screen.findByText('Florian Nord 1');
    const dialog = await erteileAuftrag();
    await within(dialog).findByRole('alert');

    await userEvent.click(within(dialog).getByRole('button', { name: 'Auftrag erteilen' }));
    await waitFor(() => expect(erteileAuftragAusMeldung).toHaveBeenCalledTimes(2));
    expect(within(dialog).queryByRole('alert')).toBeNull();
    expect(within(dialog).getByRole('button', { name: 'Close' })).toBeDisabled();
    await userEvent.keyboard('{Escape}');
    expect(dialog.closest('.ant-zoom-leave')).toBeNull();
  });

  it('Auftrag: Schließen und erneutes Öffnen zeigen keinen alten Grund', async () => {
    erteileAuftragAusMeldung.mockRejectedValue(new ApiError(422, 'Empfänger unbekannt'));
    renderPage();
    await screen.findByText('Florian Nord 1');
    const dialog = await erteileAuftrag();
    await within(dialog).findByRole('alert');

    await userEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
    await userEvent.click(within(await oeffneAktionsmenue()).getByText(/Auftrag erteilen/));
    const wieder = await offenerDialog();
    expect(within(wieder).queryByRole('alert')).toBeNull();
  });

  /** Die Route hat keinen `key`: ein offener Dialog schriebe sonst mit der alten Meldung hierher. */
  it.each([
    ['Lage', /An Lage übergeben/],
    ['Auftrag', /Auftrag erteilen/],
  ])('%s: ein Einsatzwechsel schließt den offenen Dialog', async (_name, eintrag) => {
    renderPage();
    await screen.findByText('Florian Nord 1');
    await userEvent.click(within(await oeffneAktionsmenue()).getByText(eintrag));
    await offenerDialog();

    await userEvent.click(screen.getByRole('button', { name: 'Zu Einsatz 2' }));
    await waitFor(() => expect(listeMeldungen).toHaveBeenCalledWith(2, expect.anything()));
    await screen.findByText('Florian Nord 1');
    await waitFor(() =>
      expect(
        screen.queryAllByRole('dialog').filter((d) => d.closest('.ant-zoom-leave') == null),
      ).toHaveLength(0),
    );
  });

  it('Auftrag: eine Antwort aus dem vorigen Einsatz sperrt und meldet den Dialog nicht', async () => {
    let lehneAb: ((e: Error) => void) | null = null;
    erteileAuftragAusMeldung.mockImplementationOnce(
      () => new Promise((_r, reject) => (lehneAb = reject)),
    );
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    renderPage(undefined, client);
    await screen.findByText('Florian Nord 1');
    await erteileAuftrag();
    await waitFor(() => expect(lehneAb).not.toBeNull());

    await userEvent.click(screen.getByRole('button', { name: 'Zu Einsatz 2' }));
    await waitFor(() => expect(listeMeldungen).toHaveBeenCalledWith(2, expect.anything()));
    await screen.findByText('Florian Nord 1');
    await userEvent.click(within(await oeffneAktionsmenue()).getByText(/Auftrag erteilen/));
    const dialog = await offenerDialog();
    // Das laufende Erteilen des vorigen Einsatzes sperrt hier kein Schließen.
    expect(within(dialog).getByRole('button', { name: 'Close' })).toBeEnabled();
    act(() => lehneAb?.(new ApiError(422, 'Empfänger unbekannt')));
    await waitFor(() => expect(client.getMutationCache().getAll()[0]?.state.status).toBe('error'));
    await act(() => new Promise((r) => setTimeout(r, 20)));
    expect(within(dialog).queryByRole('alert')).toBeNull();
  });

  it('meldet Ablehnungen aus dem vorigen Einsatz nicht im neuen', async () => {
    let lehneStatusAb: (e: Error) => void = () => {};
    let lehneAnlegenAb: (e: Error) => void = () => {};
    setzeMeldungStatus.mockImplementationOnce(
      () => new Promise((_r, reject) => (lehneStatusAb = reject)),
    );
    legeMeldungAn.mockImplementationOnce(
      () => new Promise((_r, reject) => (lehneAnlegenAb = reject)),
    );
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    renderPage(undefined, client);
    await screen.findByText('Florian Nord 1');
    await userEvent.click(screen.getByRole('button', { name: 'Sichten' }));
    await erfasse();
    await waitFor(() => expect(legeMeldungAn).toHaveBeenCalledTimes(1));

    await userEvent.click(screen.getByRole('button', { name: 'Zu Einsatz 2' }));
    await waitFor(() => expect(listeMeldungen).toHaveBeenCalledWith(2, expect.anything()));
    act(() => {
      lehneStatusAb(new ApiError(422, 'Übergang nicht erlaubt'));
      lehneAnlegenAb(new ApiError(422, 'Absender unbekannt'));
    });
    // Erst prüfen, wenn beide Ablehnungen angekommen sind und die Beobachter sie gesehen haben.
    await waitFor(() =>
      expect(
        client.getMutationCache().findAll({ predicate: (m) => m.state.status === 'error' }),
      ).toHaveLength(2),
    );
    await act(() => new Promise((r) => setTimeout(r, 20)));
    await screen.findByText('Florian Nord 1');
    expect(screen.queryByText('Übergang nicht erlaubt')).toBeNull();
    expect(screen.queryByText('Absender unbekannt')).toBeNull();
    // Das laufende Erfassen des vorigen Einsatzes hält das Paneel hier nicht offen.
    expect(paneel().getByRole('button', { name: 'Formular schließen' })).toBeEnabled();
  });

  // ── Mutationsproben (LFH-1140) ───────────────────────────────────────────────────

  /**
   * Die vorläufige Liste nach einem Richtungswechsel ist noch die alte (`placeholderData`): fehlt die
   * Karte dort, hat ihr Grund trotzdem keinen Ort verloren.
   */
  it('Status: solange die neue Richtung vorläufig die alte Liste zeigt, springt kein Grund in den Seitenhinweis', async () => {
    const intern = meldung();
    const extern = meldung({ id: 2, lfd_nr: 2, absender: 'Pumpe Süd', richtung: 'extern' });
    // Offene Liste und Kennzahlen fragen je einmal; beide warten auf dieselbe Antwort.
    const wartende: ((l: Meldung[]) => void)[] = [];
    listeMeldungen.mockImplementation((_id: number, f: { richtung?: string }) =>
      f.richtung === 'extern'
        ? Promise.resolve([extern])
        : f.richtung === 'intern'
          ? new Promise<Meldung[]>((r) => {
              wartende.push(r);
            })
          : Promise.resolve([intern, extern]),
    );
    setzeMeldungStatus.mockRejectedValue(new ApiError(422, 'Übergang nicht erlaubt'));
    renderPage();
    await screen.findByText('Pumpe Süd');
    await userEvent.click(within(karte(1)).getByRole('button', { name: 'Sichten' }));
    await within(karte(1)).findByText('Übergang nicht erlaubt');

    // In „Extern“ fehlt die Karte wirklich: der Grund steht im Seitenhinweis.
    await userEvent.click(screen.getByRole('radio', { name: 'Extern' }));
    await waitFor(() => expect(karte(1)).toBeNull());
    await within(await seitenHinweis()).findByRole('alert');

    // „Intern“ lädt, bis dahin steht die Liste aus „Extern“ — ohne die Karte, aber nur vorläufig.
    await userEvent.click(screen.getByRole('radio', { name: 'Intern' }));
    await waitFor(() =>
      expect(listeMeldungen).toHaveBeenCalledWith(
        1,
        expect.objectContaining({ richtung: 'intern' }),
      ),
    );
    expect(karte(2)).not.toBeNull();
    expect(document.querySelector('[data-lfh="seiten-beschreibung"] [role="alert"]')).toBeNull();

    await act(async () => wartende.forEach((r) => r([intern])));
    await waitFor(() => expect(karte(1)).not.toBeNull());
    expect(await within(karte(1)).findByText('Übergang nicht erlaubt')).toHaveAttribute(
      'data-fehler',
    );
    expect(document.querySelector('[data-lfh="seiten-beschreibung"] [role="alert"]')).toBeNull();
  });

  /**
   * Ein Erfolg schließt nur den Dialog, aus dem er kam (`ohneDialogZu`). Abbrechen ist während des
   * Laufs gesperrt; ein anderer Dialog öffnet sich nur über einen Einsatzwechsel. Zwei Wege, je
   * einer für die beiden Hälften der Prüfung: dieselbe Meldungsnummer im anderen Einsatz und eine
   * andere Meldung nach der Rückkehr in den alten Einsatz.
   */
  describe.each([
    {
      dialog: 'Lage',
      mutation: markiereLagerelevant,
      oeffne: async (lfdNr: number) => {
        await userEvent.click(
          within(await oeffneAktionsmenue(lfdNr)).getByRole('menuitem', {
            name: /An Lage übergeben/,
          }),
        );
        return offenerDialog();
      },
      sende: (dialog: HTMLElement) =>
        userEvent.click(within(dialog).getByRole('button', { name: 'Übergeben' })),
      ergebnis: () => meldung({ lagerelevant: true }),
    },
    {
      dialog: 'Auftrag',
      mutation: erteileAuftragAusMeldung,
      oeffne: async (lfdNr: number) => {
        await userEvent.click(
          within(await oeffneAktionsmenue(lfdNr)).getByText(/Auftrag erteilen/),
        );
        return offenerDialog();
      },
      sende: async (dialog: HTMLElement) => {
        await userEvent.type(within(dialog).getByLabelText('Auftrag / Was'), 'Riegelstellung');
        await userEvent.type(within(dialog).getByLabelText('Empfänger'), 'EA Nord{Enter}');
        await userEvent.click(within(dialog).getByRole('button', { name: 'Auftrag erteilen' }));
      },
      ergebnis: () => ({ id: 30 }),
    },
  ])(
    '$dialog: eine späte Antwort schließt keinen fremden Dialog',
    ({ mutation, oeffne, sende, ergebnis }) => {
      async function sendeUndWechsle() {
        let liefere: (() => void) | null = null;
        mutation.mockImplementationOnce(() => new Promise((r) => (liefere = () => r(ergebnis()))));
        setzeMeldungStatus.mockResolvedValue(meldung({ status: 'in_bearbeitung' }));
        listeMeldungen.mockResolvedValue([
          meldung(),
          meldung({ id: 2, lfd_nr: 2, absender: 'Pumpe Süd' }),
        ]);
        const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
        renderPage(undefined, client);
        await screen.findByText('Pumpe Süd');
        await sende(await oeffne(1));
        await waitFor(() => expect(liefere).not.toBeNull());
        await userEvent.click(screen.getByRole('button', { name: 'Zu Einsatz 2' }));
        await waitFor(() => expect(listeMeldungen).toHaveBeenCalledWith(2, expect.anything()));
        await screen.findByText('Pumpe Süd');
        return { liefere: () => liefere!(), client };
      }

      async function nachDerAntwort(client: QueryClient, dialog: HTMLElement) {
        await waitFor(() =>
          expect(client.getMutationCache().getAll()[0]?.state.status).toBe('success'),
        );
        await act(() => new Promise((r) => setTimeout(r, 20)));
        expect(dialog.closest('.ant-zoom-leave')).toBeNull();
        expect(
          screen.queryAllByRole('dialog').filter((d) => d.closest('.ant-zoom-leave') == null),
        ).toHaveLength(1);
      }

      it('dieselbe Meldungsnummer im anderen Einsatz bleibt offen', async () => {
        const { liefere, client } = await sendeUndWechsle();
        const dialog = await oeffne(1);
        act(() => liefere());
        await nachDerAntwort(client, dialog);
      });

      it('eine andere Meldung nach der Rückkehr bleibt offen', async () => {
        const { liefere, client } = await sendeUndWechsle();
        await userEvent.click(screen.getByRole('button', { name: 'Zu Einsatz 1' }));
        await screen.findByText('Pumpe Süd');
        const dialog = await oeffne(2);
        act(() => liefere());
        await nachDerAntwort(client, dialog);
      });
    },
  );
});
