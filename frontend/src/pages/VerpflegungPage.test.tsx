import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App as AntApp } from 'antd';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router';
import { AuthProvider } from '../auth/AuthContext';
import type { ModulOverrides, VerpflegungZeitfenster } from '../api/types';
import { KEINE_SONDERKOST, ausgabe, zeitfenster } from '../test/verpflegungDaten';
import { zeitfensterKennung } from '../verpflegung/verpflegungText';
import { parseNachforderungVorbelegung } from '../routing/deeplinks';

dayjs.extend(utc);

const einsatz = vi.hoisted(() => ({
  wert: { id: 1, bezeichnung: 'Hochwasser', status: 'aktiv', meine_rolle: 'einsatzleitung' },
  overrides: {} as ModulOverrides,
}));
vi.mock('../api/einsaetze', () => ({
  ladeEinsatz: vi.fn(() => Promise.resolve(einsatz.wert)),
  ladeModulOverrides: vi.fn(() => Promise.resolve(einsatz.overrides)),
}));

const listeNachforderungen = vi.fn();
vi.mock('../api/nachforderungen', () => ({
  listeNachforderungen: (...a: unknown[]) => listeNachforderungen(...a),
}));

const ladeVerpflegung = vi.fn();
const legeZeitfensterAn = vi.fn();
const aendereZeitfenster = vi.fn();
const loescheZeitfenster = vi.fn();
const erfasseAusgabe = vi.fn();
const nimmAusgabeZurueck = vi.fn();
vi.mock('../api/verpflegung', () => ({
  ladeVerpflegung: (...a: unknown[]) => ladeVerpflegung(...a),
  legeZeitfensterAn: (...a: unknown[]) => legeZeitfensterAn(...a),
  aendereZeitfenster: (...a: unknown[]) => aendereZeitfenster(...a),
  loescheZeitfenster: (...a: unknown[]) => loescheZeitfenster(...a),
  erfasseAusgabe: (...a: unknown[]) => erfasseAusgabe(...a),
  nimmAusgabeZurueck: (...a: unknown[]) => nimmAusgabeZurueck(...a),
}));

// Der Vorschlag fragt Personal und Betreuung an — eigens getestet, hier ohne Quellen.
vi.mock('../verpflegung/useBedarfsvorschlag', () => ({
  useBedarfsvorschlag: () => ({
    kraefte: { wert: null, hinweis: null },
    betreute: { wert: null, hinweis: null },
  }),
}));

// Die Uhr als Stellschraube: ein Übergang über `von` ohne Fake-Timer neben antd.
const uhr = vi.hoisted(() => ({ wert: null as import('dayjs').Dayjs | null }));
vi.mock('../abloesung/useUhr', () => ({ useUhr: () => uhr.wert! }));

const { default: VerpflegungPage } = await import('./VerpflegungPage');

/** Wire-Zeit (UTC ohne Zone) relativ zu JETZT. */
const JETZT = dayjs.utc('2026-09-24 10:30:00');
const um = (minuten: number) => JETZT.add(minuten, 'minute').format('YYYY-MM-DD HH:mm:ss');

/** Laufend, Fehlmenge 20 → Unterdeckung. */
const mittag = () => zeitfenster({ id: 1, von_at: um(-30), bis_at: um(60) });
/** Anstehend, noch keine Ausgabe → offen. */
const abend = () =>
  zeitfenster({
    id: 2,
    bezeichnung: 'Abend',
    von_at: um(420),
    bis_at: um(510),
    ausgegeben: { gesamt: 0, sonderkost: KEINE_SONDERKOST },
    fehlmenge: { gesamt: 250, sonderkost: { ...KEINE_SONDERKOST, vegan: 3 } },
    ausgaben: [],
  });
/** Vorbei, mit Fehlmenge 20. */
const fruehstueck = () =>
  zeitfenster({ id: 3, bezeichnung: 'Frühstück', von_at: um(-240), bis_at: um(-180) });

function liefert(zf: VerpflegungZeitfenster[]) {
  ladeVerpflegung.mockImplementation(() => Promise.resolve({ zeitfenster: zf }));
}

function Ort() {
  const l = useLocation();
  return <div data-testid="ort">{l.pathname + l.search}</div>;
}

function baum(client: QueryClient) {
  return (
    <QueryClientProvider client={client}>
      <AntApp>
        <AuthProvider>
          <MemoryRouter initialEntries={['/einsaetze/1/verpflegung']}>
            <Routes>
              <Route path="/einsaetze/:id/verpflegung" element={<VerpflegungPage />} />
              <Route path="/einsaetze/:id/nachforderungen" element={<Ort />} />
            </Routes>
          </MemoryRouter>
        </AuthProvider>
      </AntApp>
    </QueryClientProvider>
  );
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const ergebnis = render(baum(client));
  /** Zeichnet neu, ohne neu zu laden — so tickt die (gemockte) Uhr. */
  const neuZeichnen = () => ergebnis.rerender(baum(client));
  return { ...ergebnis, client, neuZeichnen };
}

const kartenNamen = () =>
  screen.getAllByRole('article').map((k) => k.getAttribute('aria-label')?.split(' ')[1]);
const karte = (zf: VerpflegungZeitfenster) =>
  screen.findByRole('article', { name: `Zeitfenster ${zeitfensterKennung(zf)}` });
const sammelbanner = () => document.querySelector('[data-lfh="sammelbanner"]');
const kopf = () => document.querySelector('[data-lfh="seitenkopf-aktionen"]') as HTMLElement;

async function oeffneMenue(zf: VerpflegungZeitfenster) {
  await userEvent.click(
    screen.getByRole('button', { name: `Aktionen zu Zeitfenster ${zeitfensterKennung(zf)}` }),
  );
  return waitFor(() => {
    const menue = document.querySelector<HTMLElement>(
      '.ant-dropdown:not(.ant-dropdown-hidden) [role="menu"]',
    );
    expect(menue).not.toBeNull();
    return menue!;
  });
}

describe('VerpflegungPage (LFH-634)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    uhr.wert = JETZT;
    einsatz.wert = {
      id: 1,
      bezeichnung: 'Hochwasser',
      status: 'aktiv',
      meine_rolle: 'einsatzleitung',
    };
    einsatz.overrides = {};
    liefert([fruehstueck(), mittag(), abend()]);
    listeNachforderungen.mockResolvedValue([
      { id: 4, bezeichnung: 'Feldküche', art: 'Verpflegung', status: 'eingetroffen' },
    ]);
  });

  describe('Anzeige im Modul', () => {
    it('trennt laufend & anstehend von vergangen; Kopf zählt alle und die Unterdeckungen', async () => {
      renderPage();
      await screen.findAllByRole('article');
      expect(kartenNamen()).toEqual(['Mittag', 'Abend']);
      expect(screen.getByText('3 Zeitfenster · 2 mit Unterdeckung')).toBeInTheDocument();
      expect((await karte(mittag())).getAttribute('data-einstufung')).toBe('unterdeckung');
      expect((await karte(abend())).getAttribute('data-einstufung')).toBe('offen');

      await userEvent.click(screen.getByRole('radio', { name: /vergangen/ }));
      // Vorbei, aber weiterhin mit Unterdeckung und Fehlmenge 20 (Spec-Szenario).
      const f = await karte(fruehstueck());
      expect(kartenNamen()).toEqual(['Frühstück']);
      expect(f).toHaveAttribute('data-einstufung', 'unterdeckung');
      expect(within(f).getByText('Unterdeckung')).toBeInTheDocument();
    });

    it('ein Übergang über `von` wechselt die Einstufung, ohne Abruf', async () => {
      const { neuZeichnen } = renderPage();
      expect(await karte(abend())).toHaveAttribute('data-einstufung', 'offen');
      uhr.wert = dayjs.utc(abend().von_at);
      neuZeichnen();
      // `jetzt == von` gilt als begonnen (D2).
      expect(await karte(abend())).toHaveAttribute('data-einstufung', 'unterdeckung');
      expect(screen.getByText('3 Zeitfenster · 3 mit Unterdeckung')).toBeInTheDocument();
      expect(ladeVerpflegung).toHaveBeenCalledTimes(1);
    });

    it('Leerzustand mit „Zeitfenster anlegen" öffnet den Dialog', async () => {
      liefert([]);
      renderPage();
      expect(await screen.findByText('Noch kein Zeitfenster')).toBeInTheDocument();
      const knoepfe = screen.getAllByRole('button', { name: 'Zeitfenster anlegen' });
      // Kopf und Leerzustand — der Leerzustand öffnet denselben Dialog.
      expect(knoepfe).toHaveLength(2);
      const leer = knoepfe.find((k) => !kopf().contains(k))!;
      await userEvent.click(leer);
      expect(
        await screen.findByRole('dialog', { name: 'Zeitfenster anlegen' }),
      ).toBeInTheDocument();
    });
  });

  it('ohne Schreibrecht: Grund im Kopf, Primäraktion gesperrt, keine Kartenaktionen', async () => {
    einsatz.wert = { ...einsatz.wert, meine_rolle: 'beobachter' };
    renderPage();
    await screen.findAllByRole('article');
    expect(
      screen.getByText(/Nur Einsatzleitung und Führungspersonal können Zeitfenster anlegen/),
    ).toBeInTheDocument();
    expect(within(kopf()).getByRole('button', { name: 'Zeitfenster anlegen' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: /^Ausgabe erfassen/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Aktionen zu/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Zurücknehmen/ })).toBeNull();
  });

  it('ohne Schreibrecht im leeren Modul: Leerzustand ohne Aktion', async () => {
    einsatz.wert = { ...einsatz.wert, meine_rolle: 'beobachter' };
    liefert([]);
    renderPage();
    await screen.findByText('Noch kein Zeitfenster');
    expect(screen.getAllByRole('button', { name: 'Zeitfenster anlegen' })).toHaveLength(1);
  });

  it('Zeitfenster anlegen invalidiert Verpflegung UND Einsatztagebuch', async () => {
    const neu = zeitfenster({ id: 7, bezeichnung: 'Nacht', von_at: um(600), bis_at: um(660) });
    legeZeitfensterAn.mockResolvedValue(neu);
    const { client } = renderPage();
    await screen.findAllByRole('article');
    const spion = vi.spyOn(client, 'invalidateQueries');
    await userEvent.click(within(kopf()).getByRole('button', { name: 'Zeitfenster anlegen' }));
    const dialog = await screen.findByRole('dialog', { name: 'Zeitfenster anlegen' });
    await userEvent.type(within(dialog).getByLabelText('Bezeichnung'), 'Nacht');
    const start = within(dialog).getByPlaceholderText('Beginn');
    await userEvent.click(start);
    await userEvent.type(start, '2026-09-25 18:00');
    await userEvent.keyboard('{Enter}');
    await userEvent.type(within(dialog).getByPlaceholderText('Ende'), '2026-09-25 19:00');
    await userEvent.keyboard('{Enter}');
    await userEvent.type(within(dialog).getByLabelText('Einsatzkräfte (EP)'), '40');
    await userEvent.type(within(dialog).getByLabelText('Betreute (EP)'), '0');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Anlegen' }));
    await waitFor(() => expect(legeZeitfensterAn).toHaveBeenCalled());
    await waitFor(() => {
      const keys = spion.mock.calls.map((c) => JSON.stringify(c[0]?.queryKey));
      expect(keys).toContain(JSON.stringify(['einsatz-verpflegung', 1]));
      expect(keys).toContain(JSON.stringify(['etb', 1]));
    });
  });

  it('Ausgabe erfassen: POST, dann ruft „Rückgängig" die Rücknahme — ohne ETB-Invalidierung', async () => {
    erfasseAusgabe.mockResolvedValue({ ausgabe_id: 55, zeitfenster: mittag() });
    nimmAusgabeZurueck.mockResolvedValue({ ausgabe_id: 55, zeitfenster: mittag() });
    const { client } = renderPage();
    await screen.findAllByRole('article');
    const spion = vi.spyOn(client, 'invalidateQueries');
    await userEvent.click(
      screen.getByRole('button', { name: `Ausgabe erfassen zu ${zeitfensterKennung(mittag())}` }),
    );
    const dialog = await screen.findByRole('dialog', { name: 'Ausgabe erfassen: Mittag' });
    await userEvent.type(within(dialog).getByLabelText('Menge (EP)'), '20');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Erfassen' }));
    await waitFor(() => expect(erfasseAusgabe).toHaveBeenCalledWith(1, 1, { menge: 20 }));
    await userEvent.click(await screen.findByRole('button', { name: /Rückgängig/ }));
    await waitFor(() => expect(nimmAusgabeZurueck).toHaveBeenCalledWith(1, 55));
    const keys = spion.mock.calls.map((c) => JSON.stringify(c[0]?.queryKey));
    expect(keys).not.toContain(JSON.stringify(['etb', 1]));
  });

  it('Zurücknehmen aus der Liste fragt rot zurück; Abbrechen sendet nichts', async () => {
    nimmAusgabeZurueck.mockResolvedValue({ ausgabe_id: 11, zeitfenster: mittag() });
    renderPage();
    await screen.findAllByRole('article');
    await userEvent.click(screen.getByRole('button', { name: /^Zurücknehmen: Ausgabe 230 EP/ }));
    let dialog = await screen.findByRole('dialog', { name: 'Ausgabe zurücknehmen?' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Abbrechen' }));
    expect(nimmAusgabeZurueck).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: /^Zurücknehmen: Ausgabe 230 EP/ }));
    dialog = await screen.findByRole('dialog', { name: 'Ausgabe zurücknehmen?' });
    const ok = within(dialog).getByRole('button', { name: 'Zurücknehmen' });
    expect(ok).toHaveClass('ant-btn-dangerous');
    await userEvent.click(ok);
    await waitFor(() => expect(nimmAusgabeZurueck).toHaveBeenCalledWith(1, 11));
  });

  describe('Nachforderungen (D4/D9)', () => {
    it('„Nachfordern" öffnet die Erfassung der Nachforderung mit der Fehlmenge', async () => {
      renderPage();
      await screen.findAllByRole('article');
      const menue = await oeffneMenue(mittag());
      await userEvent.click(within(menue).getByText('Nachfordern'));
      const ort = await screen.findByTestId('ort');
      const [pfad, suche] = ort.textContent!.split('?');
      expect(pfad).toBe('/einsaetze/1/nachforderungen');
      const params = new URLSearchParams(suche);
      expect(params.get('neu')).toBe('1');
      expect(parseNachforderungVorbelegung(params)).toMatchObject({
        art: 'Verpflegung',
        anzahl: 20,
        begruendung: 'Unterdeckung Verpflegung ‚Mittag‘: Bedarf 250, ausgegeben 230.',
      });
    });

    it('löst den Namen der Nachforderung an der Ausgabe auf', async () => {
      liefert([
        zeitfenster({
          id: 1,
          von_at: um(-30),
          bis_at: um(60),
          ausgaben: [ausgabe({ id: 11, nachforderung_id: 4 })],
        }),
      ]);
      renderPage();
      expect(await screen.findByText('Nachforderung: Feldküche')).toBeInTheDocument();
    });

    it('Modul ausgeblendet: keine Anfrage, kein „Nachfordern", nur „Nachforderung #n"', async () => {
      einsatz.overrides = {
        nachforderungen: { einsatz_id: 1, modul_key: 'nachforderungen', sichtbar: false },
      };
      liefert([
        zeitfenster({
          id: 1,
          von_at: um(-30),
          bis_at: um(60),
          ausgaben: [ausgabe({ id: 11, nachforderung_id: 4 })],
        }),
      ]);
      renderPage();
      expect(await screen.findByText('Nachforderung #4')).toBeInTheDocument();
      expect(listeNachforderungen).not.toHaveBeenCalled();
      expect(screen.queryByRole('button', { name: /^Aktionen zu/ })).toBeNull();
      expect(screen.queryByRole('button', { name: /Nachfordern/ })).toBeNull();
    });

    it('eine abgelehnte Liste (403) bleibt still: kein Fehler, nur „Nachforderung #n"', async () => {
      listeNachforderungen.mockRejectedValue(new Error('403'));
      liefert([
        zeitfenster({
          id: 1,
          von_at: um(-30),
          bis_at: um(60),
          ausgaben: [ausgabe({ id: 11, nachforderung_id: 4 })],
        }),
      ]);
      renderPage();
      expect(await screen.findByText('Nachforderung #4')).toBeInTheDocument();
      await waitFor(() => expect(listeNachforderungen).toHaveBeenCalledTimes(1));
      expect(screen.queryByRole('alert')).toBeNull();
    });
  });

  describe('Live-Zufluss (Spec „Live-Verteilung")', () => {
    // Das fremde Zeitfenster beginnt VOR allen anderen — die Zeitordnung stellt es oben hin.
    // Landete es unten, verschöbe sich auch ohne Schleuse nichts, und der Test bewiese nichts.
    const fremd = () =>
      zeitfenster({ id: 9, bezeichnung: 'Imbiss', von_at: um(-60), bis_at: um(30) });

    it('ein fremd angelegtes Zeitfenster verschiebt keine Karte, bis das Banner bedient wird', async () => {
      const { client } = renderPage();
      await screen.findAllByRole('article');
      expect(sammelbanner()).toBeNull();

      liefert([fruehstueck(), fremd(), mittag(), abend()]);
      await client.invalidateQueries();

      await waitFor(() => expect(sammelbanner()).not.toBeNull());
      expect(sammelbanner()).toHaveTextContent('1 neues Zeitfenster, davon 1 mit Unterdeckung');
      expect(kartenNamen()).toEqual(['Mittag', 'Abend']);
      // Die Zahlen lügen nicht: der Kopf zählt das zurückgehaltene mit.
      expect(screen.getByText('4 Zeitfenster · 3 mit Unterdeckung')).toBeInTheDocument();

      await userEvent.click(
        within(sammelbanner() as HTMLElement).getByRole('button', { name: 'anzeigen' }),
      );
      expect(kartenNamen()).toEqual(['Imbiss', 'Mittag', 'Abend']);
      expect(sammelbanner()).toBeNull();
    });

    it('geänderte Mengen an bestehenden Karten erscheinen sofort, ohne Banner', async () => {
      const { client } = renderPage();
      await screen.findAllByRole('article');
      liefert([
        fruehstueck(),
        zeitfenster({
          id: 1,
          von_at: um(-30),
          bis_at: um(60),
          ausgegeben: { gesamt: 250, sonderkost: { ...KEINE_SONDERKOST, vegan: 3 } },
          fehlmenge: { gesamt: 0, sonderkost: KEINE_SONDERKOST },
        }),
        abend(),
      ]);
      await client.invalidateQueries();
      await waitFor(async () =>
        expect(await karte(mittag())).toHaveAttribute('data-einstufung', 'gedeckt'),
      );
      expect(sammelbanner()).toBeNull();
    });

    it('ein eigenes neues Zeitfenster steht sofort an seinem Platz', async () => {
      const eigen = zeitfenster({
        id: 9,
        bezeichnung: 'Imbiss',
        von_at: um(-60),
        bis_at: um(30),
      });
      legeZeitfensterAn.mockImplementation(async () => {
        liefert([fruehstueck(), eigen, mittag(), abend()]);
        return eigen;
      });
      renderPage();
      await screen.findAllByRole('article');
      await userEvent.click(within(kopf()).getByRole('button', { name: 'Zeitfenster anlegen' }));
      const dialog = await screen.findByRole('dialog', { name: 'Zeitfenster anlegen' });
      await userEvent.type(within(dialog).getByLabelText('Bezeichnung'), 'Imbiss');
      const start = within(dialog).getByPlaceholderText('Beginn');
      await userEvent.click(start);
      await userEvent.type(start, '2026-09-25 18:00');
      await userEvent.keyboard('{Enter}');
      await userEvent.type(within(dialog).getByPlaceholderText('Ende'), '2026-09-25 19:00');
      await userEvent.keyboard('{Enter}');
      await userEvent.type(within(dialog).getByLabelText('Einsatzkräfte (EP)'), '10');
      await userEvent.type(within(dialog).getByLabelText('Betreute (EP)'), '0');
      await userEvent.click(within(dialog).getByRole('button', { name: 'Anlegen' }));
      await waitFor(() => expect(kartenNamen()).toEqual(['Imbiss', 'Mittag', 'Abend']));
      expect(sammelbanner()).toBeNull();
    });

    it('ein Ansichtswechsel gibt die zurückgehaltenen frei', async () => {
      const { client } = renderPage();
      await screen.findAllByRole('article');
      liefert([fruehstueck(), fremd(), mittag(), abend()]);
      await client.invalidateQueries();
      await waitFor(() => expect(sammelbanner()).not.toBeNull());
      await userEvent.click(screen.getByRole('radio', { name: /vergangen/ }));
      await userEvent.click(screen.getByRole('radio', { name: /laufend/ }));
      expect(kartenNamen()).toEqual(['Imbiss', 'Mittag', 'Abend']);
      expect(sammelbanner()).toBeNull();
    });
  });
});
