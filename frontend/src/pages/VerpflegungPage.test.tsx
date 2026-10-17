import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App as AntApp } from 'antd';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router';
import { AuthProvider } from '../auth/AuthContext';
import { ApiError } from '../api/client';
import type {
  ModulFreigaben,
  VerpflegungEmpfaenger,
  Verpflegungsstelle,
  VerpflegungZeitfenster,
} from '../api/types';
import { freigabenFixture } from '../test/fixtures';
import {
  DEICH,
  FELDKUECHE,
  GRUPPE_2,
  KEINE_SONDERKOST,
  ausgabe,
  empfaenger,
  stelle,
  verpflegungMitStellen,
  zeitfenster,
} from '../test/verpflegungDaten';
import { zeitfensterKennung } from '../verpflegung/verpflegungText';
import { parseNachforderungVorbelegung } from '../routing/deeplinks';
import { queueLeerenFuerTests, schreibaktionenLaden } from '../offline/queue';
import { meHandler, server } from '../test/server';
import { benutzerFixture } from '../test/fixtures';
import { setzeOnline } from '../test/utils';
import { setzeViewportBreite } from '../test/viewport';
import { waehle } from '../test/auswahlListe';

dayjs.extend(utc);

const einsatz = vi.hoisted(() => ({
  wert: { id: 1, bezeichnung: 'Hochwasser', status: 'aktiv', meine_rolle: 'einsatzleitung' },
  /** Modul-Freigaben des Servers; `beforeEach` setzt „alles frei“. */
  freigaben: {} as ModulFreigaben,
}));
vi.mock('../api/einsaetze', () => ({
  ladeEinsatz: vi.fn(() => Promise.resolve(einsatz.wert)),
  ladeModulFreigaben: vi.fn(() => Promise.resolve(einsatz.freigaben)),
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
const createStelle = vi.fn();
const updateStelle = vi.fn();
const setStelleStatus = vi.fn();
const storniereStelle = vi.fn();
vi.mock('../api/verpflegung', () => ({
  createStelle: (...a: unknown[]) => createStelle(...a),
  updateStelle: (...a: unknown[]) => updateStelle(...a),
  setStelleStatus: (...a: unknown[]) => setStelleStatus(...a),
  storniereStelle: (...a: unknown[]) => storniereStelle(...a),
  ladeVerpflegung: (...a: unknown[]) => ladeVerpflegung(...a),
  legeZeitfensterAn: (...a: unknown[]) => legeZeitfensterAn(...a),
  aendereZeitfenster: (...a: unknown[]) => aendereZeitfenster(...a),
  loescheZeitfenster: (...a: unknown[]) => loescheZeitfenster(...a),
  erfasseAusgabe: (...a: unknown[]) => erfasseAusgabe(...a),
  nimmAusgabeZurueck: (...a: unknown[]) => nimmAusgabeZurueck(...a),
}));

const listeAbschnitte = vi.fn();
vi.mock('../api/einsatzabschnitte', () => ({
  listeAbschnitte: (...a: unknown[]) => listeAbschnitte(...a),
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

function liefert(
  zf: VerpflegungZeitfenster[],
  stellen: Verpflegungsstelle[] = [],
  empfaengerListe?: VerpflegungEmpfaenger,
) {
  ladeVerpflegung.mockImplementation(() =>
    Promise.resolve({
      zeitfenster: zf,
      stellen,
      ...(empfaengerListe ? { empfaenger: empfaengerListe } : {}),
    }),
  );
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
              <Route path="/einsaetze/:id/verpflegung/aus-vorlage" element={<Ort />} />
            </Routes>
          </MemoryRouter>
        </AuthProvider>
      </AntApp>
    </QueryClientProvider>
  );
}

/** Angemeldet als Benutzer 1: Ausgaben laufen über die Offline-Queue, und die gehört einem
 *  Benutzer (LFH-688). */
const BENUTZER_ID = 1;

function renderPage() {
  server.use(meHandler(benutzerFixture({ id: BENUTZER_ID, anzeigename: 'Leitung' })));
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

/** „Ausgabe nachtragen“ an Mittag: am Stab mit drei Aktionen im Menü (LLH-1032, D8). */
async function nachtragenDialog() {
  const menue = await oeffneMenue(mittag());
  await userEvent.click(within(menue).getByText('Ausgabe nachtragen'));
  return screen.findByRole('dialog', { name: 'Ausgabe nachtragen: Mittag' });
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
    einsatz.freigaben = freigabenFixture();
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
    expect(screen.getByText('nur Einsatzleitung und Führungspersonal')).toBeInTheDocument();
    expect(within(kopf()).getByRole('button', { name: 'Zeitfenster anlegen' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: /^Ausgabe nachtragen/ })).toBeNull();
    // Kein Sprung zur Ausgabeansicht: dem Leser zeigt die Karte schon alles (LLH-1032, D1).
    expect(screen.queryByRole('link', { name: /^Ausgabe öffnen/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Aktionen zu/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Zurücknehmen/ })).toBeNull();
  });

  it('Nebenweg „Tag aus Vorlage anlegen“ öffnet die Seite des Tages (LLH-1058)', async () => {
    renderPage();
    await screen.findAllByRole('article');
    const weg = within(kopf()).getByRole('link', { name: 'Tag aus Vorlage anlegen' });
    expect(weg).toHaveAttribute('href', '/einsaetze/1/verpflegung/aus-vorlage');
    await userEvent.click(weg);
    expect(await screen.findByTestId('ort')).toHaveTextContent(
      '/einsaetze/1/verpflegung/aus-vorlage',
    );
  });

  it('ohne Schreibrecht steht „Tag aus Vorlage anlegen“ gesperrt mit Grund (LLH-1058)', async () => {
    einsatz.wert = { ...einsatz.wert, meine_rolle: 'beobachter' };
    renderPage();
    await screen.findAllByRole('article');
    expect(
      within(kopf()).getByRole('button', {
        name: 'Tag aus Vorlage anlegen (nur Einsatzleitung und Führungspersonal)',
      }),
    ).toBeDisabled();
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
    // Beide Zeitfelder tippen und verlassen (Verlassen übernimmt; Enter schickte schon ab).
    await userEvent.type(
      within(dialog).getByRole('textbox', { name: 'Beginn' }),
      '2026-09-25 18:00',
    );
    await userEvent.tab();
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'Ende' }), '2026-09-25 19:00');
    await userEvent.tab();
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

  it('Ausgabe nachtragen: POST, dann ruft „Rückgängig" die Rücknahme — ohne ETB-Invalidierung', async () => {
    erfasseAusgabe.mockResolvedValue({ ausgabe_id: 55, zeitfenster: mittag() });
    nimmAusgabeZurueck.mockResolvedValue({ ausgabe_id: 55, zeitfenster: mittag() });
    const { client } = renderPage();
    await screen.findAllByRole('article');
    const spion = vi.spyOn(client, 'invalidateQueries');
    const dialog = await nachtragenDialog();
    await userEvent.type(within(dialog).getByLabelText('Menge (EP)'), '20');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Nachtragen' }));
    await waitFor(() =>
      expect(erfasseAusgabe).toHaveBeenCalledWith(
        1,
        1,
        { menge: 20, client_id: expect.any(String) },
        { offlineQueueBenutzerId: BENUTZER_ID },
      ),
    );
    expect(erfasseAusgabe.mock.calls[0][2]).not.toHaveProperty('zeitpunkt_at');
    await userEvent.click(await screen.findByRole('button', { name: /Rückgängig/ }));
    await waitFor(() => expect(nimmAusgabeZurueck).toHaveBeenCalledWith(1, 55));
    const keys = spion.mock.calls.map((c) => JSON.stringify(c[0]?.queryKey));
    expect(keys).not.toContain(JSON.stringify(['etb', 1]));
    expect(screen.queryByText(/Offline vorgemerkt/)).toBeNull();
  });

  /**
   * Rückgängig kommt aus dem Toast, kein Dialog und oft keine sichtbare Karte mehr: der Grund
   * einer abgelehnten Rücknahme steht im Hinweis der Seite, kein Fehler-Toast (LFH-1077).
   */
  describe('Rückgängig abgelehnt (LFH-1077)', () => {
    async function erfasseUndNimmZurueck() {
      await screen.findAllByRole('article');
      const dialog = await nachtragenDialog();
      await userEvent.type(within(dialog).getByLabelText('Menge (EP)'), '20');
      await userEvent.click(within(dialog).getByRole('button', { name: 'Nachtragen' }));
      const rueckgaengig = await screen.findAllByRole('button', { name: /Rückgängig/ });
      await userEvent.click(rueckgaengig[rueckgaengig.length - 1]);
    }
    const seitenHinweis = () =>
      waitFor(() => {
        const h = document.querySelector<HTMLElement>('[data-lfh="seiten-beschreibung"]');
        expect(h).not.toBeNull();
        return h as HTMLElement;
      });

    it('der Grund steht im Seitenhinweis, kein Fehler-Toast', async () => {
      erfasseAusgabe.mockResolvedValue({ ausgabe_id: 55, zeitfenster: mittag() });
      nimmAusgabeZurueck.mockRejectedValue(new ApiError(409, 'Ausgabe bereits zurückgenommen'));
      renderPage();
      await erfasseUndNimmZurueck();

      const hinweis = await seitenHinweis();
      expect(await within(hinweis).findByRole('alert')).toHaveTextContent(
        'Ausgabe bereits zurückgenommen',
      );
      expect(document.querySelectorAll('.ant-message-error')).toHaveLength(0);
    });

    it('die nächste Rücknahme räumt den Hinweis', async () => {
      erfasseAusgabe.mockResolvedValue({ ausgabe_id: 55, zeitfenster: mittag() });
      nimmAusgabeZurueck
        .mockRejectedValueOnce(new ApiError(409, 'Ausgabe bereits zurückgenommen'))
        .mockImplementationOnce(() => new Promise(() => {}));
      renderPage();
      await erfasseUndNimmZurueck();
      await screen.findByText('Ausgabe bereits zurückgenommen');

      await erfasseUndNimmZurueck();
      await waitFor(() => expect(nimmAusgabeZurueck).toHaveBeenCalledTimes(2));
      await waitFor(() =>
        expect(screen.queryByText('Ausgabe bereits zurückgenommen')).not.toBeInTheDocument(),
      );
    });
  });

  describe('Ausgabe ohne Verbindung (LFH-688)', () => {
    afterEach(async () => {
      setzeOnline(true);
      await queueLeerenFuerTests();
    });

    it('offline: vorgemerkt — Hinweis ohne Rückgängig, Dialog schließt, „ausstehend“ an der Karte', async () => {
      await queueLeerenFuerTests();
      renderPage();
      await screen.findAllByRole('article');
      // Geladen wird online, dann fällt das Netz weg — auch für TanStacks `onlineManager`.
      setzeOnline(false);
      const dialog = await nachtragenDialog();
      await userEvent.type(within(dialog).getByLabelText('Menge (EP)'), '40');
      await userEvent.click(within(dialog).getByRole('button', { name: 'Nachtragen' }));

      expect(await screen.findByText(/Offline vorgemerkt: 40 EP/)).toBeInTheDocument();
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      expect(screen.queryByRole('button', { name: /Rückgängig/ })).toBeNull();
      expect(erfasseAusgabe).not.toHaveBeenCalled();
      const [zeile] = await schreibaktionenLaden(BENUTZER_ID, 1);
      expect(zeile.aktion).toMatchObject({
        art: 'ausgabe',
        zeitfenster_id: 1,
        bezeichnung: 'Mittag',
        daten: { menge: 40, zeitpunkt_at: expect.any(String), client_id: expect.any(String) },
      });

      const k = await karte(mittag());
      const ausstehend = await waitFor(() => {
        const z = k.querySelector<HTMLElement>('[data-lfh="verpflegung-ausgabe-ausstehend"]');
        expect(z).not.toBeNull();
        return z!;
      });
      expect(within(ausstehend).getByText('40 EP')).toBeInTheDocument();
      // Nicht in der Deckung: die Karte zeigt weiter die Zahlen des Servers (Fehlmenge 20).
      expect(k).toHaveAttribute('data-einstufung', 'unterdeckung');
      expect(
        [...k.querySelectorAll<HTMLElement>('[data-lfh="kennzahl"]')].find((x) =>
          x.textContent?.startsWith('fehlt'),
        )?.textContent,
      ).toContain('20');
      // Die vorgemerkte Ausgabe steht nur an IHREM Zeitfenster.
      const andere = await karte(abend());
      expect(andere.querySelector('[data-lfh="verpflegung-ausgabe-ausstehend"]')).toBeNull();
    });
  });

  it('„Ausgabe öffnen“ führt laufend und anstehend in die Ausgabeansicht, vergangen nicht (LLH-1032)', async () => {
    renderPage();
    await screen.findAllByRole('article');
    expect(
      screen.getByRole('link', { name: `Ausgabe öffnen zu ${zeitfensterKennung(mittag())}` }),
    ).toHaveAttribute('href', '/einsaetze/1/verpflegung/1/ausgabe');
    expect(
      screen.getByRole('link', { name: `Ausgabe öffnen zu ${zeitfensterKennung(abend())}` }),
    ).toHaveAttribute('href', '/einsaetze/1/verpflegung/2/ausgabe');
    await userEvent.click(screen.getByRole('radio', { name: /^vergangen/ }));
    await screen.findByRole('article', {
      name: `Zeitfenster ${zeitfensterKennung(fruehstueck())}`,
    });
    expect(screen.queryByRole('link', { name: /^Ausgabe öffnen/ })).toBeNull();
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
      einsatz.freigaben = freigabenFixture({ nachforderungen: { sichtbar: false } });
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
    // Das fremde Zeitfenster beginnt vor allen anderen und steht oben. Landete es unten, verschöbe
    // sich auch ohne Schleuse nichts.
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
      // Der Kopf zählt das zurückgehaltene mit.
      expect(screen.getByText('4 Zeitfenster · 3 mit Unterdeckung')).toBeInTheDocument();

      await userEvent.click(
        within(sammelbanner() as HTMLElement).getByRole('button', { name: 'anzeigen' }),
      );
      expect(kartenNamen()).toEqual(['Imbiss', 'Mittag', 'Abend']);
      expect(sammelbanner()).toBeNull();
    });

    it('auf dem Handschirm: Segmente „aktuell (n)“, „vergangen“ und „Stellen“, Banner als Knopf „1 neu“, voller Satz im Status (LFH-694)', async () => {
      setzeViewportBreite(390);
      const { client } = renderPage();
      await screen.findAllByRole('article');
      // Unter `md` kurz, damit neben der Segmentleiste Platz für das Banner bleibt.
      expect(screen.getByRole('radio', { name: 'aktuell (2)' })).toBeInTheDocument();
      expect(screen.getByRole('radio', { name: 'vergangen' })).toBeInTheDocument();
      expect(screen.queryByRole('radio', { name: /laufend & anstehend/ })).toBeNull();
      // „vergangen“ und „Stellen“ schmal ohne Zahl (LLH-1040, design.md Risiken).
      expect(screen.getByRole('radio', { name: 'Stellen' })).toBeInTheDocument();

      liefert([fruehstueck(), fremd(), mittag(), abend()]);
      await client.invalidateQueries();
      await waitFor(() => expect(sammelbanner()).not.toBeNull());

      const banner = sammelbanner() as HTMLElement;
      expect(banner).toHaveTextContent('1 neues Zeitfenster, davon 1 mit Unterdeckung');
      const knopf = within(banner).getByRole('button', { name: '1 neu anzeigen' });
      expect(knopf).toHaveTextContent(/^1 neu$/);
      await userEvent.click(knopf);
      expect(kartenNamen()).toEqual(['Imbiss', 'Mittag', 'Abend']);
      expect(sammelbanner()).toBeNull();
    });

    it('breit bleiben Segmentbeschriftung und Banner wie bisher (LFH-694)', async () => {
      const { client } = renderPage();
      await screen.findAllByRole('article');
      expect(screen.getByRole('radio', { name: 'laufend & anstehend (2)' })).toBeInTheDocument();
      liefert([fruehstueck(), fremd(), mittag(), abend()]);
      await client.invalidateQueries();
      await waitFor(() => expect(sammelbanner()).not.toBeNull());
      expect(
        within(sammelbanner() as HTMLElement).getByRole('button', { name: 'anzeigen' }),
      ).toBeInTheDocument();
      expect(within(sammelbanner() as HTMLElement).queryByText('1 neu')).toBeNull();
    });

    it('ein fremd vorgezogener Beginn ordnet nicht unter dem Cursor um (Muster LFH-660)', async () => {
      const { client } = renderPage();
      await screen.findAllByRole('article');
      expect(kartenNamen()).toEqual(['Mittag', 'Abend']);

      // Eine andere Person zieht „Abend" vor „Mittag" — die Server-Ordnung dreht sich.
      liefert([fruehstueck(), { ...abend(), von_at: um(-60), bis_at: um(120) }, mittag()]);
      await client.invalidateQueries();

      await waitFor(() => expect(sammelbanner()).not.toBeNull());
      expect(sammelbanner()).toHaveTextContent('Reihenfolge geändert');
      expect(kartenNamen()).toEqual(['Mittag', 'Abend']);

      await userEvent.click(
        within(sammelbanner() as HTMLElement).getByRole('button', { name: 'anzeigen' }),
      );
      expect(kartenNamen()).toEqual(['Abend', 'Mittag']);
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
      // Beide Zeitfelder tippen und verlassen (Verlassen übernimmt; Enter schickte schon ab).
      await userEvent.type(
        within(dialog).getByRole('textbox', { name: 'Beginn' }),
        '2026-09-25 18:00',
      );
      await userEvent.tab();
      await userEvent.type(
        within(dialog).getByRole('textbox', { name: 'Ende' }),
        '2026-09-25 19:00',
      );
      await userEvent.tab();
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

  describe('Ansicht „Stellen“ (LLH-1040, D13 Punkte 1–3)', () => {
    /** Drei offene aus dem Ticket und eine aufgelöste, die nicht mitzählt. */
    const stellen = () => [
      ...verpflegungMitStellen().stellen,
      stelle({ id: 30, bezeichnung: 'Ausgabe Schule', status: 'aufgeloest' }),
    ];

    it('dritter Wert der Segmentleiste zählt ohne aufgelöste; Primäraktion folgt der Ansicht', async () => {
      liefert([fruehstueck(), mittag(), abend()], stellen());
      renderPage();
      await screen.findAllByRole('article');
      const segment = screen.getByRole('radio', { name: 'Stellen (3)' });
      expect(within(kopf()).getByRole('button', { name: 'Zeitfenster anlegen' })).toBeEnabled();
      expect(within(kopf()).queryByRole('button', { name: 'Stelle anlegen' })).toBeNull();

      await userEvent.click(segment);
      const liste = await screen.findByRole('region', { name: 'Verpflegungsstellen' });
      expect(within(liste).getByRole('article', { name: 'Stelle Zuführung Deich' })).toBeVisible();
      expect(screen.queryByRole('article', { name: /^Zeitfenster/ })).toBeNull();
      expect(within(kopf()).getByRole('button', { name: 'Stelle anlegen' })).toBeEnabled();
      expect(within(kopf()).queryByRole('button', { name: 'Zeitfenster anlegen' })).toBeNull();

      await userEvent.click(screen.getByRole('radio', { name: /^laufend/ }));
      expect(await karte(mittag())).toBeVisible();
      expect(within(kopf()).getByRole('button', { name: 'Zeitfenster anlegen' })).toBeEnabled();
    });

    it('Stelle anlegen: POST, Verpflegung invalidiert, Erfolg als Toast', async () => {
      liefert([mittag()], []);
      createStelle.mockResolvedValue(stelle({ id: 40, bezeichnung: 'Feldküche Nord' }));
      const { client } = renderPage();
      await screen.findAllByRole('article');
      await userEvent.click(screen.getByRole('radio', { name: 'Stellen (0)' }));
      expect(await screen.findByText('Keine Verpflegungsstellen')).toBeInTheDocument();
      const spion = vi.spyOn(client, 'invalidateQueries');
      await userEvent.click(within(kopf()).getByRole('button', { name: 'Stelle anlegen' }));
      const dialog = await screen.findByRole('dialog', { name: 'Stelle anlegen' });
      await userEvent.type(within(dialog).getByLabelText('Bezeichnung'), 'Feldküche Nord');
      await userEvent.click(within(dialog).getByRole('combobox', { name: 'Art' }));
      await userEvent.click(
        await waitFor(() => {
          const o = document.querySelector<HTMLElement>(
            '.ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option[title="Feldküche"]',
          );
          expect(o).not.toBeNull();
          return o!;
        }),
      );
      await userEvent.click(within(dialog).getByRole('button', { name: 'Anlegen' }));
      await waitFor(() =>
        expect(createStelle).toHaveBeenCalledWith(1, {
          bezeichnung: 'Feldküche Nord',
          art: 'feldkueche',
        }),
      );
      expect(await screen.findByText('Stelle ‚Feldküche Nord‘ angelegt')).toBeInTheDocument();
      await waitFor(() =>
        expect(spion.mock.calls.map((c) => JSON.stringify(c[0]?.queryKey))).toContain(
          JSON.stringify(['einsatz-verpflegung', 1]),
        ),
      );
    });

    it('In Betrieb nehmen invalidiert Verpflegung UND Einsatztagebuch', async () => {
      liefert([mittag()], stellen());
      setStelleStatus.mockResolvedValue(
        stelle({ id: DEICH, bezeichnung: 'Zuführung Deich', status: 'aktiv' }),
      );
      const { client } = renderPage();
      await screen.findAllByRole('article');
      await userEvent.click(screen.getByRole('radio', { name: /^Stellen/ }));
      const spion = vi.spyOn(client, 'invalidateQueries');
      await userEvent.click(
        await screen.findByRole('button', { name: 'Aktionen zu Stelle Zuführung Deich' }),
      );
      const menue = await waitFor(() => {
        const m = document.querySelector<HTMLElement>(
          '.ant-dropdown:not(.ant-dropdown-hidden) [role="menu"]',
        );
        expect(m).not.toBeNull();
        return m!;
      });
      await userEvent.click(within(menue).getByText('In Betrieb nehmen'));
      await waitFor(() => expect(setStelleStatus).toHaveBeenCalledWith(1, DEICH, 'aktiv'));
      await waitFor(() => {
        const keys = spion.mock.calls.map((c) => JSON.stringify(c[0]?.queryKey));
        expect(keys).toContain(JSON.stringify(['einsatz-verpflegung', 1]));
        expect(keys).toContain(JSON.stringify(['etb', 1]));
      });
      expect(
        await screen.findByText('Stelle ‚Zuführung Deich‘ in Betrieb genommen'),
      ).toBeInTheDocument();
    });

    it('Bearbeiten öffnet die Maske vorbelegt und schickt nur Geändertes', async () => {
      liefert([mittag()], stellen());
      listeAbschnitte.mockResolvedValue([]);
      updateStelle.mockResolvedValue(stelle({ id: FELDKUECHE, bezeichnung: 'Feldküche' }));
      renderPage();
      await screen.findAllByRole('article');
      await userEvent.click(screen.getByRole('radio', { name: /^Stellen/ }));
      await userEvent.click(
        await screen.findByRole('button', {
          name: 'Bearbeiten … zu Stelle Feldküche BR Sportplatz',
        }),
      );
      const dialog = await screen.findByRole('dialog', {
        name: 'Stelle bearbeiten: Feldküche BR Sportplatz',
      });
      const bez = within(dialog).getByLabelText('Bezeichnung');
      await userEvent.clear(bez);
      await userEvent.type(bez, 'Feldküche');
      await userEvent.click(within(dialog).getByRole('button', { name: 'Speichern' }));
      await waitFor(() =>
        expect(updateStelle).toHaveBeenCalledWith(1, FELDKUECHE, { bezeichnung: 'Feldküche' }),
      );
      expect(await screen.findByText('Stelle ‚Feldküche‘ gespeichert')).toBeInTheDocument();
    });

    it('ohne Schreibrecht: „Stelle anlegen“ gesperrt mit Grund, keine Zeilenaktionen', async () => {
      einsatz.wert = { ...einsatz.wert, meine_rolle: 'beobachter' };
      liefert([mittag()], stellen());
      renderPage();
      await screen.findAllByRole('article');
      await userEvent.click(screen.getByRole('radio', { name: /^Stellen/ }));
      await screen.findByRole('region', { name: 'Verpflegungsstellen' });
      expect(within(kopf()).getByRole('button', { name: 'Stelle anlegen' })).toBeDisabled();
      expect(screen.getByText('nur Einsatzleitung und Führungspersonal')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /^Aktionen zu Stelle/ })).toBeNull();
      expect(screen.queryByRole('button', { name: /zu Stelle/ })).toBeNull();
    });
  });
  describe('Empfänger (LLH-1055 Teil II)', () => {
    it('die Karte nennt Empfänger und Einheiten; der Nachtrag bietet „Empfänger“ und sendet ihn', async () => {
      erfasseAusgabe.mockResolvedValue({ ausgabe_id: 55, zeitfenster: mittag() });
      liefert(
        [{ ...mittag(), ausgaben: [ausgabe({ id: 11, menge: 230, einheit_id: GRUPPE_2 })] }],
        [],
        empfaenger(),
      );
      renderPage();
      const k = await karte(mittag());
      expect(k.querySelector('[data-lfh="verpflegung-ausgabe"]')).toHaveTextContent(
        '230 EP · an 2. Gruppe',
      );
      expect(
        within(k).getByRole('button', {
          name: 'Einheiten · 2 noch nicht verpflegt · 1 ohne Eintreffen · 1 verpflegt',
        }),
      ).toBeInTheDocument();
      const dialog = await nachtragenDialog();
      await waehle('Empfänger', '2. Gruppe · Florian 1-2 · 0/1/8//9');
      await waitFor(() => expect(within(dialog).getByLabelText('Menge (EP)')).toHaveValue('9'));
      await userEvent.click(within(dialog).getByRole('button', { name: 'Nachtragen' }));
      await waitFor(() =>
        expect(erfasseAusgabe).toHaveBeenCalledWith(
          1,
          1,
          expect.objectContaining({ menge: 9, einheit_id: GRUPPE_2 }),
          expect.anything(),
        ),
      );
    });
  });
});
