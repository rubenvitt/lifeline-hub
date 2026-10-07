import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App as AntApp } from 'antd';
import { MemoryRouter, Routes, Route, useNavigate } from 'react-router';
import MeldungenPage from './MeldungenPage';
import { AuthProvider } from '../auth/AuthContext';
import type { Meldung, MeldungKennzahlen } from '../api/types';
import { meHandler, server } from '../test/server';
import { benutzerFixture } from '../test/fixtures';
import { setzeViewportBreite } from '../test/viewport';

/**
 * Meldungsseite mit getrennten Abrufen (LFH-940, Spec `meldungen-blaettern`): offene, Kennzahlen
 * und abgeschlossene Seiten kommen je aus einem eigenen Abruf; die abgeschlossenen erst in ihrer
 * Ansicht und seitenweise.
 */

vi.mock('../live/useEinsatzLiveStream', () => ({ useEinsatzLiveStream: () => {} }));
vi.mock('../api/einsaetze', () => ({
  ladeEinsatz: vi.fn().mockResolvedValue({
    id: 1,
    bezeichnung: 'Lage',
    status: 'aktiv',
    meine_rolle: 'einsatzleitung',
  }),
  ladeMitglieder: vi.fn().mockResolvedValue([]),
}));
vi.mock('../api/einsatzabschnitte', () => ({ listeAbschnitte: vi.fn().mockResolvedValue([]) }));
vi.mock('../api/einheiten', () => ({ listeEinheiten: vi.fn().mockResolvedValue([]) }));

// Render-Zähler an `MeldungKarte`: der Hook läuft genau einmal je Render einer Karte.
const kartenRender = vi.hoisted(() => ({ n: 0 }));
vi.mock('../geraet/geraetSicht', async (importOriginal) => {
  const echt = await importOriginal<typeof import('../geraet/geraetSicht')>();
  return {
    ...echt,
    useGeraetDarf: () => {
      kartenRender.n += 1;
      return () => true;
    },
  };
});

const listeOffeneMeldungen = vi.fn();
const listeAbgeschlosseneMeldungen = vi.fn();
const ladeMeldungKennzahlen = vi.fn();
const ladeMeldung = vi.fn();
vi.mock('../api/meldungen', async (importOriginal) => {
  const echt = await importOriginal<typeof import('../api/meldungen')>();
  return {
    ...echt,
    listeOffeneMeldungen: (...a: unknown[]) => listeOffeneMeldungen(...a),
    listeAbgeschlosseneMeldungen: (...a: unknown[]) => listeAbgeschlosseneMeldungen(...a),
    ladeMeldungKennzahlen: (...a: unknown[]) => ladeMeldungKennzahlen(...a),
    ladeMeldung: (...a: unknown[]) => ladeMeldung(...a),
  };
});

const meldung = (over: Partial<Meldung> = {}): Meldung => ({
  id: 1,
  einsatz_id: 1,
  lfd_nr: 1,
  absender: 'Florian Nord 1',
  empfaenger: 'ELW 1',
  meldeweg: 'funk',
  inhalt: 'Deich instabil',
  meldungsart: 'lagemeldung',
  prioritaet: 'normal',
  richtung: 'intern',
  status: 'neu',
  bearbeiter_id: null,
  bearbeiter_name: null,
  lagerelevant: false,
  ereigniszeit: '2026-06-12 09:00:00',
  eingang_at: '2026-06-12 09:05:00',
  etb_meldung_id: null,
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

/** `n` erledigte Meldungen ab `von`, zuletzt erledigte zuerst (Server-Ordnung). */
function erledigte(von: number, n: number): Meldung[] {
  return Array.from({ length: n }, (_, i) => {
    const nr = von + i;
    const minute = 1000 - nr;
    return meldung({
      id: 10_000 - nr,
      lfd_nr: 10_000 - nr,
      absender: `Alt ${nr}`,
      status: 'erledigt',
      ist_offen: false,
      erledigt_at: `2026-06-12 ${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}:00`,
    });
  });
}

const KENNZAHLEN: MeldungKennzahlen = {
  unbearbeitet: 1,
  in_arbeit: 0,
  alarmiert: 3,
  erledigt: 250,
};

/** Ein Verweis von außen auf dieselbe Seite, wie ihn Palette oder ETB setzen. */
function Verweis({ mid }: { mid: number }) {
  const navigate = useNavigate();
  return (
    <button type="button" onClick={() => navigate(`/einsaetze/1/meldungen?meldung=${mid}`)}>
      Verweis {mid}
    </button>
  );
}

function renderPage(route = '/einsaetze/1/meldungen') {
  server.use(meHandler(benutzerFixture({ anzeigename: 'Leitung' })));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const ergebnis = render(
    <QueryClientProvider client={client}>
      <AntApp>
        <AuthProvider>
          <MemoryRouter initialEntries={[route]}>
            <Routes>
              <Route
                path="/einsaetze/:id/meldungen"
                element={
                  <>
                    <Verweis mid={500} />
                    <MeldungenPage />
                  </>
                }
              />
            </Routes>
          </MemoryRouter>
        </AuthProvider>
      </AntApp>
    </QueryClientProvider>,
  );
  return { ...ergebnis, client };
}

describe('MeldungenPage — getrennte Abrufe und Blättern (LFH-940)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    kartenRender.n = 0;
    listeOffeneMeldungen.mockResolvedValue([meldung()]);
    ladeMeldungKennzahlen.mockResolvedValue(KENNZAHLEN);
    listeAbgeschlosseneMeldungen.mockResolvedValue([]);
  });

  it('holt offene und Kennzahlen getrennt, die abgeschlossenen erst beim Öffnen', async () => {
    renderPage();
    expect(await screen.findByText('Florian Nord 1')).toBeInTheDocument();
    expect(listeOffeneMeldungen).toHaveBeenCalledWith(1, undefined);
    expect(ladeMeldungKennzahlen).toHaveBeenCalledWith(1, undefined);
    expect(listeAbgeschlosseneMeldungen).not.toHaveBeenCalled();

    await userEvent.click(screen.getByText(/Abgeschlossen \(/));
    await waitFor(() =>
      expect(listeAbgeschlosseneMeldungen).toHaveBeenCalledWith(1, undefined, undefined),
    );
  });

  it('zählt aus den Kennzahlen, nicht aus der geladenen Liste', async () => {
    renderPage();
    expect(await screen.findByText('1 offen · 250 abgeschlossen')).toBeInTheDocument();
    expect(screen.getByText('Abgeschlossen (250)')).toBeInTheDocument();
    const band = screen.getByRole('group', { name: 'Meldungen in Zahlen' });
    const wert = (titel: string) =>
      within(band)
        .getByText(titel)
        .closest('[data-lfh="kennzahl"]')!
        .querySelector('[data-lfh="kennzahl-wert"]')!.textContent;
    await waitFor(() => expect(wert('Erledigt')).toBe('250'));
    // „Bestätigung überfällig" quer zur Phase: auch erledigte zählen, die nicht geladen sind.
    expect(wert('Bestätigung überfällig')).toBe('3');
  });

  it('lädt ältere Seiten mit dem Cursor der letzten Zeile nach', async () => {
    const erste = erledigte(0, 100);
    listeAbgeschlosseneMeldungen
      .mockResolvedValueOnce(erste)
      .mockResolvedValueOnce(erledigte(100, 2));
    renderPage();
    await screen.findByText('Florian Nord 1');
    await userEvent.click(screen.getByText(/Abgeschlossen \(/));
    expect(await screen.findByText('Alt 0')).toBeInTheDocument();
    expect(screen.getByText('100 von 250 geladen')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Ältere laden' }));
    expect(await screen.findByText('Alt 101')).toBeInTheDocument();
    const letzte = erste[erste.length - 1];
    expect(listeAbgeschlosseneMeldungen).toHaveBeenLastCalledWith(1, undefined, {
      zeit: letzte.erledigt_at,
      id: letzte.id,
    });
    // Eine kurze Seite ist die letzte.
    expect(screen.queryByRole('button', { name: 'Ältere laden' })).not.toBeInTheDocument();
  }, 30_000);

  it('holt eine verlinkte, nicht geladene Meldung einzeln und zeigt sie hervorgehoben', async () => {
    ladeMeldung.mockResolvedValue(
      meldung({
        id: 500,
        lfd_nr: 500,
        absender: 'Uralt',
        status: 'erledigt',
        ist_offen: false,
        erledigt_at: '2026-06-01 08:00:00',
      }),
    );
    listeAbgeschlosseneMeldungen.mockResolvedValue(erledigte(0, 100));
    renderPage('/einsaetze/1/meldungen?meldung=500');

    expect(await screen.findByText('Verlinkte Meldung')).toBeInTheDocument();
    expect(ladeMeldung).toHaveBeenCalledWith(1, 500);
    const karte = document.querySelector('[data-meldung-id="500"]');
    expect(karte).not.toBeNull();
    expect(within(karte as HTMLElement).getByText('Uralt')).toBeInTheDocument();
    // Ansicht umgeschaltet, ohne bis zur Meldung zu blättern.
    expect(await screen.findByText('Alt 0')).toBeInTheDocument();
    expect(listeAbgeschlosseneMeldungen).toHaveBeenCalledTimes(1);
  });

  it('holt eine verlinkte offene Meldung nicht einzeln', async () => {
    listeOffeneMeldungen.mockResolvedValue([meldung({ id: 7, absender: 'Offen 7' })]);
    renderPage('/einsaetze/1/meldungen?meldung=7');
    expect(await screen.findByText('Offen 7')).toBeInTheDocument();
    await waitFor(() => expect(document.querySelector('[data-meldung-id="7"]')).not.toBeNull());
    expect(ladeMeldung).not.toHaveBeenCalled();
    expect(screen.queryByText('Verlinkte Meldung')).not.toBeInTheDocument();
  });

  it('rendert bei unverändertem Bestand keine Karte neu', async () => {
    listeOffeneMeldungen.mockResolvedValue([
      meldung({ id: 1, absender: 'A' }),
      meldung({ id: 2, absender: 'B', status: 'gesichtet' }),
    ]);
    renderPage();
    await screen.findByText('B');
    await waitFor(() => expect(ladeMeldungKennzahlen).toHaveBeenCalled());
    await screen.findByText('Abgeschlossen (250)');
    const vorher = kartenRender.n;
    expect(vorher).toBeGreaterThan(0);

    // Ein Seitenzustand ohne Bezug zum Bestand: das Erfassungsformular auf- und zuklappen.
    await userEvent.click(screen.getByRole('button', { name: /Meldung erfassen/ }));
    await userEvent.click(screen.getAllByRole('button', { name: /Formular schließen/ })[0]);
    expect(kartenRender.n).toBe(vorher);
  });

  it('schaltet auch beim zweiten Verweis auf dieselbe Meldung wieder um', async () => {
    ladeMeldung.mockResolvedValue(
      meldung({ id: 500, absender: 'Uralt', status: 'erledigt', ist_offen: false }),
    );
    renderPage('/einsaetze/1/meldungen?meldung=500');
    expect(await screen.findByText('Verlinkte Meldung')).toBeInTheDocument();
    await userEvent.click(screen.getByText(/^Offen \(/));
    await waitFor(() => expect(screen.queryByText('Verlinkte Meldung')).not.toBeInTheDocument());

    await userEvent.click(screen.getByRole('button', { name: 'Verweis 500' }));
    expect(await screen.findByText('Verlinkte Meldung')).toBeInTheDocument();
  });

  it('rendert beim Live-Abgleich nur die geänderte Karte neu', async () => {
    const a = meldung({ id: 1, absender: 'A' });
    const b = meldung({ id: 2, absender: 'B', status: 'gesichtet' });
    listeOffeneMeldungen.mockResolvedValue([a, b]);
    const { client } = renderPage();
    await screen.findByText('B');
    await screen.findByText('Abgeschlossen (250)');
    const vorher = kartenRender.n;

    listeOffeneMeldungen.mockResolvedValue([a, { ...b, bearbeiter_name: 'Sani Schmidt' }]);
    await client.invalidateQueries({ queryKey: ['einsatz-meldungen', 1] });
    await waitFor(() => expect(kartenRender.n).toBeGreaterThan(vorher));
    expect(kartenRender.n - vorher).toBe(1);
  });
});

/** LFH-974 (Spec `meldungen-handy`): unter `md` Zeile statt Band, Filterknopf statt Segmentleiste. */
describe('MeldungenPage — schmaler Schirm (LFH-974)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listeOffeneMeldungen.mockResolvedValue([meldung()]);
    ladeMeldungKennzahlen.mockResolvedValue(KENNZAHLEN);
    listeAbgeschlosseneMeldungen.mockResolvedValue([]);
  });

  const zeile = () => document.querySelector('[data-lfh="meldung-kennzahl-zeile"]');

  it('zeigt unter md die Zahlen als eine Zeile und den Richtungsfilter hinter „Filter"', async () => {
    setzeViewportBreite(390);
    renderPage();
    await screen.findByText('Florian Nord 1');
    await waitFor(() =>
      expect(zeile()?.textContent).toBe(
        '1 unbearbeitet · 0 in Arbeit · 3 Bestätigung überfällig · 250 erledigt',
      ),
    );
    expect(document.querySelector('[data-lfh="kennzahl-wert"]')).toBeNull();
    expect(screen.queryByRole('radiogroup', { name: 'Richtung' })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Filter' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: /Extern/ }));
    expect(await screen.findByRole('button', { name: 'Filter (1 aktiv)' })).toBeInTheDocument();
    await waitFor(() => expect(listeOffeneMeldungen).toHaveBeenLastCalledWith(1, 'extern'));
  });

  it('behält ab md Band und Segmentleiste', async () => {
    setzeViewportBreite(1024);
    renderPage();
    await screen.findByText('Florian Nord 1');
    await waitFor(() =>
      expect(document.querySelector('[data-lfh="kennzahl-wert"]')).not.toBeNull(),
    );
    expect(screen.getByRole('radiogroup', { name: 'Richtung' })).toBeInTheDocument();
    expect(zeile()).toBeNull();
    expect(screen.queryByRole('button', { name: /^Filter/ })).not.toBeInTheDocument();
  });
});
