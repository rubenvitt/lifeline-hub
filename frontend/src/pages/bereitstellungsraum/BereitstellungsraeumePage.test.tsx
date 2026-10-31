import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes, useLocation, useNavigate } from 'react-router';
import { server } from '../../test/server';
import { renderMitProviders, sortTarget } from '../../test/utils';
import BereitstellungsraeumePage from './BereitstellungsraeumePage';
import { einsatzKeys } from '../../api/queryKeys';
import type { BrListenEintrag, Einheit, EinsatzAnzeige } from '../../api/types';
import { CommandPaletteProvider } from '../../command-palette/CommandPaletteProvider';
import { einsatzFixture } from '../../test/fixtures';
import { setzeViewportBreite } from '../../test/viewport';
import { kopfFilterWaehlen } from '../../test/kopfFilter';

function einsatz(over: Partial<EinsatzAnzeige> = {}): EinsatzAnzeige {
  return einsatzFixture({ bezeichnung: 'Lage', ...over });
}

function br(over: Partial<BrListenEintrag> = {}): BrListenEintrag {
  return {
    id: 1,
    einsatz_id: 1,
    abschnitt_id: null,
    bezeichnung: 'BR Ost',
    standort: null,
    notiz: null,
    status: 'aktiv',
    erfasst_at: 'x',
    erfasst_von: 1,
    geaendert_at: 'x',
    geaendert_von: 1,
    storniert_at: null,
    abschnitt_name: null,
    belegung: { einheiten: 0, fahrzeuge: 0, laengste_seit_at: null },
    einheit_ids: [],
    ...over,
  };
}

/** Macht den Query-String sichtbar — der Beleg, dass `?neu=1` verbraucht wurde. */
function SuchAnzeige() {
  return <span data-testid="suche">{useLocation().search}</span>;
}

function renderPage(route = '/einsaetze/1/bereitstellungsraeume/liste') {
  return renderMitProviders(
    <CommandPaletteProvider>
      <Routes>
        <Route
          path="/einsaetze/:id/bereitstellungsraeume/liste"
          element={<BereitstellungsraeumePage />}
        />
      </Routes>
      <SuchAnzeige />
    </CommandPaletteProvider>,
    { route },
  );
}

function EinsatzWechsel() {
  const navigate = useNavigate();
  return (
    <button onClick={() => navigate('/einsaetze/2/bereitstellungsraeume/liste')}>
      Zu Einsatz B
    </button>
  );
}

function PfadProbe() {
  return <output data-testid="pfad">{useLocation().pathname}</output>;
}

function renderWechselPage() {
  return renderMitProviders(
    <CommandPaletteProvider>
      <EinsatzWechsel />
      <PfadProbe />
      <Routes>
        <Route
          path="/einsaetze/:id/bereitstellungsraeume/liste"
          element={<BereitstellungsraeumePage />}
        />
        <Route path="/einsaetze/:id/bereitstellungsraeume/:brId" element={<div>BR-DETAIL</div>} />
      </Routes>
    </CommandPaletteProvider>,
    { route: '/einsaetze/1/bereitstellungsraeume/liste' },
  );
}

describe('BereitstellungsraeumePage', () => {
  it('zeigt die Bereitstellungsräume der Lage', async () => {
    server.use(
      http.get('/api/einsaetze/1', () => HttpResponse.json(einsatz())),
      http.get('/api/einsaetze/1/bereitstellungsraeume', () => HttpResponse.json([br()])),
    );
    renderPage();
    expect(await screen.findByText('BR Ost')).toBeInTheDocument();
  });

  /**
   * Die Listen-Query gehört an die Stelle der Liste, nicht in den Seitenguard: ein gescheiterter
   * Abruf zeigt den Fehler statt eines ewigen Ladebilds. Beide Hälften nennen dasselbe
   * Leertext-Literal, damit die Zusicherung die Zustandsweiche prüft.
   */
  it('zeigt bei gescheitertem Abruf den Fehler und NICHT den Leertext', async () => {
    server.use(
      http.get('/api/einsaetze/1', () => HttpResponse.json(einsatz())),
      http.get(
        '/api/einsaetze/1/bereitstellungsraeume',
        () => new HttpResponse(null, { status: 500 }),
      ),
    );
    renderPage();
    expect(await screen.findByRole('button', { name: 'Erneut abrufen' })).toBeInTheDocument();
    expect(screen.queryByText('Noch keine Bereitstellungsräume erfasst')).not.toBeInTheDocument();
  });

  it('zeigt bei leerer Liste den Leertext und KEINEN Fehler', async () => {
    server.use(
      http.get('/api/einsaetze/1', () => HttpResponse.json(einsatz())),
      http.get('/api/einsaetze/1/bereitstellungsraeume', () => HttpResponse.json([])),
    );
    renderPage();
    expect(await screen.findByText('Noch keine Bereitstellungsräume erfasst')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Erneut abrufen' })).not.toBeInTheDocument();
    // Leerzustand mit Knopf statt Anleitung (LFH-1078).
    expect(screen.getByRole('button', { name: 'Ersten BR anlegen' })).toBeInTheDocument();
    expect(screen.queryByText(/Lege einen Bereitstellungsraum an/)).not.toBeInTheDocument();
  });

  /**
   * Veralteter Stand = `isError` MIT Zeilen im Zwischenspeicher. Der Ablauf ist bewusst der echte
   * (erst Erfolg, dann gescheiterte Aktualisierung); ein bloß vorbefüllter Cache belegte den
   * Produktionsweg nicht.
   */
  it('meldet den veralteten Stand, wenn die Aktualisierung mit Zeilen im Cache scheitert', async () => {
    server.use(
      http.get('/api/einsaetze/1', () => HttpResponse.json(einsatz())),
      http.get('/api/einsaetze/1/bereitstellungsraeume', () => HttpResponse.json([br()])),
    );
    const { client } = renderPage();
    await screen.findByText('BR Ost');

    server.use(
      http.get(
        '/api/einsaetze/1/bereitstellungsraeume',
        () => new HttpResponse(null, { status: 500 }),
      ),
    );
    await client.refetchQueries({ queryKey: einsatzKeys.br(1) });

    expect(await screen.findByText(/Aktualisierung fehlgeschlagen/)).toBeInTheDocument();
    // Die Zeile aus dem Zwischenspeicher bleibt stehen — der Fehler verdrängt sie NICHT.
    expect(screen.getByText('BR Ost')).toBeInTheDocument();
    expect(
      screen.queryByText('Bereitstellungsräume konnten nicht geladen werden'),
    ).not.toBeInTheDocument();
  });

  /**
   * Eine vollständig stornierte Liste ist ein echter Leerzustand: der Seitenfilter läuft durch
   * dieselbe Weiche wie eine leere Antwort.
   */
  it('behandelt eine ausschließlich stornierte Liste als Leerzustand', async () => {
    server.use(
      http.get('/api/einsaetze/1', () => HttpResponse.json(einsatz())),
      http.get('/api/einsaetze/1/bereitstellungsraeume', () =>
        HttpResponse.json([br({ storniert_at: '2026-07-29 10:00:00' })]),
      ),
    );
    renderPage();
    expect(await screen.findByText('Noch keine Bereitstellungsräume erfasst')).toBeInTheDocument();
    expect(screen.queryByText('BR Ost')).not.toBeInTheDocument();
  });

  /**
   * Pinnt die Messachse der Zustandsflaggen: sie messen an der ungefilterten Menge (`alle`), nicht
   * an `sichtbar`. An `sichtbar` gemessen verdrängte bei „alles storniert + gescheiterte
   * Aktualisierung" wieder der Seitenfehler das Banner. Dass das Banner dann über einer leeren
   * Tabelle steht, ist gewollt (siehe Seite).
   */
  it('misst an der ungefilterten Menge: alles storniert + Fehler ergibt Banner, nicht Seitenfehler', async () => {
    server.use(
      http.get('/api/einsaetze/1', () => HttpResponse.json(einsatz())),
      http.get('/api/einsaetze/1/bereitstellungsraeume', () =>
        HttpResponse.json([br({ storniert_at: '2026-07-29 10:00:00' })]),
      ),
    );
    const { client } = renderPage();
    await screen.findByText('Noch keine Bereitstellungsräume erfasst');

    server.use(
      http.get(
        '/api/einsaetze/1/bereitstellungsraeume',
        () => new HttpResponse(null, { status: 500 }),
      ),
    );
    await client.refetchQueries({ queryKey: einsatzKeys.br(1) });

    expect(await screen.findByText(/Aktualisierung fehlgeschlagen/)).toBeInTheDocument();
    expect(screen.getByText('Noch keine Bereitstellungsräume erfasst')).toBeInTheDocument();
    expect(
      screen.queryByText('Bereitstellungsräume konnten nicht geladen werden'),
    ).not.toBeInTheDocument();
  });

  /**
   * Schnellaktion der Sprungpalette (LFH-506). Die Route ist die LISTEN-Route, die
   * `bereitstellungsraeumeListePfad` baut — der Pin dazu steht in `routing/deeplinks.test.ts`.
   * Als Paar: ohne den Parameter bleibt der Drawer zu.
   */
  describe('Schnellerfassung per ?neu=1', () => {
    function mitListe(e: EinsatzAnzeige = einsatz()) {
      server.use(
        http.get('/api/einsaetze/1', () => HttpResponse.json(e)),
        http.get('/api/einsaetze/1/bereitstellungsraeume', () => HttpResponse.json([br()])),
      );
    }

    it('?neu=1 öffnet den Anlege-Drawer und räumt den Parameter', async () => {
      mitListe();
      renderPage('/einsaetze/1/bereitstellungsraeume/liste?neu=1');
      expect(await screen.findByPlaceholderText('z. B. BR Ost')).toBeInTheDocument();
      await waitFor(() => expect(screen.getByTestId('suche')).toHaveTextContent(/^$/));
    });

    it('ohne ?neu=1 bleibt der Drawer zu', async () => {
      mitListe();
      renderPage();
      await screen.findByText('BR Ost');
      await act(async () => {
        await new Promise((r) => setTimeout(r, 50));
      });
      expect(screen.queryByPlaceholderText('z. B. BR Ost')).not.toBeInTheDocument();
    });

    it('?neu=1 öffnet den Drawer NICHT für Beobachter', async () => {
      mitListe(einsatz({ meine_rolle: 'beobachter' }));
      renderPage('/einsaetze/1/bereitstellungsraeume/liste?neu=1');
      // Synchronisationspunkt ist das Räumen des Parameters — erst danach hat der Effekt
      // entschieden.
      await waitFor(() => expect(screen.getByTestId('suche')).toHaveTextContent(/^$/));
      await act(async () => {
        await new Promise((r) => setTimeout(r, 50));
      });
      expect(screen.queryByPlaceholderText('z. B. BR Ost')).not.toBeInTheDocument();
    });
  });

  it('fokussiert Bezeichnung und legt per Enter aus diesem Feld an', async () => {
    let body: unknown = null;
    server.use(
      http.get('/api/einsaetze/1', () => HttpResponse.json(einsatz())),
      http.get('/api/einsaetze/1/bereitstellungsraeume', () => HttpResponse.json([])),
      http.post('/api/einsaetze/1/bereitstellungsraeume', async ({ request }) => {
        body = await request.json();
        return HttpResponse.json(br({ id: 2, bezeichnung: 'BR West' }), { status: 201 });
      }),
    );
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Neu' }));
    const bezeichnung = screen.getByPlaceholderText('z. B. BR Ost');
    await waitFor(() => expect(bezeichnung).toHaveFocus());
    await userEvent.keyboard('BR West{Enter}');

    await waitFor(() => expect(body).toMatchObject({ bezeichnung: 'BR West' }));
  });

  it('setzt beim Einsatzwechsel alle Werte des offenen BR-Drawers zurück', async () => {
    server.use(
      http.get('/api/einsaetze/:einsatzId', ({ params }) =>
        HttpResponse.json(einsatz({ id: Number(params.einsatzId) })),
      ),
      http.get('/api/einsaetze/:einsatzId/bereitstellungsraeume', () => HttpResponse.json([])),
    );
    renderWechselPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Neu' }));
    await userEvent.type(screen.getByLabelText('Bezeichnung'), 'BR Einsatz A');
    await userEvent.type(screen.getByLabelText('Standort (optional)'), 'Standort A');
    await userEvent.type(screen.getByLabelText('Notiz (optional)'), 'Notiz A');

    await userEvent.click(screen.getByRole('button', { name: 'Zu Einsatz B' }));

    await waitFor(() => expect(screen.getByLabelText('Bezeichnung')).toHaveValue(''));
    expect(screen.getByLabelText('Standort (optional)')).toHaveValue('');
    expect(screen.getByLabelText('Notiz (optional)')).toHaveValue('');
  });

  it('schließt den BR-Drawer mit Provider per Escape und setzt das Formular zurück', async () => {
    server.use(
      http.get('/api/einsaetze/1', () => HttpResponse.json(einsatz())),
      http.get('/api/einsaetze/1/bereitstellungsraeume', () => HttpResponse.json([])),
    );
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Neu' }));
    await userEvent.type(screen.getByLabelText('Bezeichnung'), 'Wird verworfen');

    await userEvent.keyboard('{Escape}');
    await userEvent.click(screen.getByRole('button', { name: 'Neu' }));

    expect(screen.getByLabelText('Bezeichnung')).toHaveValue('');
  });

  it('lässt den Drawer und die Bezeichnung bei einem Anlegefehler stehen', async () => {
    server.use(
      http.get('/api/einsaetze/1', () => HttpResponse.json(einsatz())),
      http.get('/api/einsaetze/1/bereitstellungsraeume', () => HttpResponse.json([])),
      http.post('/api/einsaetze/1/bereitstellungsraeume', () =>
        HttpResponse.json({ error: 'Bereitstellungsraum abgelehnt' }, { status: 500 }),
      ),
    );
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Neu' }));
    const bezeichnung = screen.getByPlaceholderText('z. B. BR Ost');
    await userEvent.type(bezeichnung, 'BR Fehler');
    await userEvent.click(screen.getByRole('button', { name: 'Anlegen' }));

    expect(await screen.findByText('Bereitstellungsraum abgelehnt')).toBeInTheDocument();
    expect(bezeichnung).toHaveValue('BR Fehler');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  // Schließen wartet auf die Antwort (LFH-1077, design.md D3): eine Ablehnung braucht den Drawer.
  it('sperrt das Schließen, solange das Anlegen läuft, und öffnet dann den Raum', async () => {
    let postGestartet!: () => void;
    let antwortFreigeben!: () => void;
    const postStart = new Promise<void>((resolve) => {
      postGestartet = resolve;
    });
    const antwortGate = new Promise<void>((resolve) => {
      antwortFreigeben = resolve;
    });
    server.use(
      http.get('/api/einsaetze/1', () => HttpResponse.json(einsatz())),
      http.get('/api/einsaetze/1/bereitstellungsraeume', () => HttpResponse.json([])),
      http.post('/api/einsaetze/1/bereitstellungsraeume', async () => {
        postGestartet();
        await antwortGate;
        return HttpResponse.json(br({ id: 22 }), { status: 201 });
      }),
    );
    renderWechselPage();

    await userEvent.click(await screen.findByRole('button', { name: 'Neu' }));
    await userEvent.type(screen.getByPlaceholderText('z. B. BR Ost'), 'BR West{Enter}');
    await postStart;
    expect(screen.getByRole('button', { name: /Close|Schliessen|Schließen/i })).toBeDisabled();
    await act(async () => {
      antwortFreigeben();
    });
    await screen.findByText('Bereitstellungsraum angelegt');

    await waitFor(() =>
      expect(screen.getByTestId('pfad')).toHaveTextContent('/einsaetze/1/bereitstellungsraeume/22'),
    );
  });

  it('bindet einen laufenden Auftrag an dessen Einsatz-ID', async () => {
    let postGestartet!: () => void;
    let antwortFreigeben!: () => void;
    const postStart = new Promise<void>((resolve) => {
      postGestartet = resolve;
    });
    const antwortGate = new Promise<void>((resolve) => {
      antwortFreigeben = resolve;
    });
    server.use(
      http.get('/api/einsaetze/:einsatzId', ({ params }) =>
        HttpResponse.json(einsatz({ id: Number(params.einsatzId) })),
      ),
      http.get('/api/einsaetze/:einsatzId/bereitstellungsraeume', () => HttpResponse.json([])),
      http.post('/api/einsaetze/1/bereitstellungsraeume', async () => {
        postGestartet();
        await antwortGate;
        return HttpResponse.json(br({ id: 23 }), { status: 201 });
      }),
    );
    renderWechselPage();

    await userEvent.click(await screen.findByRole('button', { name: 'Neu' }));
    await userEvent.type(screen.getByPlaceholderText('z. B. BR Ost'), 'BR Nord{Enter}');
    await postStart;
    await userEvent.click(screen.getByRole('button', { name: 'Zu Einsatz B' }));
    await waitFor(() => expect(screen.getByTestId('pfad')).toHaveTextContent('/einsaetze/2/'));
    await act(async () => {
      antwortFreigeben();
    });

    await waitFor(() =>
      expect(screen.getByTestId('pfad')).toHaveTextContent('/einsaetze/1/bereitstellungsraeume/23'),
    );
  });
});

/** Einheit der Einheitenliste, nur mit dem, was die Stärke braucht. */
function einheit(over: Partial<Einheit> & Pick<Einheit, 'id'>): Einheit {
  return {
    einsatz_id: 1,
    abschnitt_id: null,
    abschnitt_name: null,
    ueber_einheit_id: null,
    typ_id: null,
    typ_label: null,
    name: `Einheit ${over.id}`,
    fuehrer_id: null,
    fuehrer_name: null,
    bemerkung: null,
    sortier: 0,
    soll: null,
    ist: { fuehrer: 0, unterfuehrer: 0, mannschaft: 0 },
    ist_kumuliert: { fuehrer: 0, unterfuehrer: 0, mannschaft: 0 },
    personal_mitglieder: [],
    fahrzeug_mitglieder: [],
    material_mitglieder: [],
    lat: null,
    lon: null,
    tz_fachaufgabe: null,
    tz_organisation: null,
    aktueller_br_id: null,
    sprechgruppen: [],
    status: { quelle: 'ohne', verteilung: [] },
    unangemeldet: false,
    verbindungen: [],
    ...over,
  };
}

describe('BereitstellungsraeumePage — Liste zeigt die Belegung (LLH-1095 D13)', () => {
  // 14:30 Berliner Sommerzeit; nur `Date` und das Intervall der Uhr sind gefälscht.
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
    vi.setSystemTime(new Date('2026-10-15T14:30:00+02:00'));
  });
  afterEach(() => vi.useRealTimers());

  // Dieselbe Fixture wie die Detailseite (BrDetailPage.test.tsx, „Kennzahlenband der Belegung“):
  // zwei Einheiten (0/1/5//6) mit je einem Fahrzeug und ein Fahrzeug ohne Einheit.
  const ZUG = einheit({
    id: 10,
    ist: { fuehrer: 0, unterfuehrer: 1, mannschaft: 3 },
    ist_kumuliert: { fuehrer: 0, unterfuehrer: 1, mannschaft: 3 },
  });
  const TRUPP = einheit({
    id: 11,
    ist: { fuehrer: 0, unterfuehrer: 0, mannschaft: 2 },
    ist_kumuliert: { fuehrer: 0, unterfuehrer: 0, mannschaft: 2 },
  });
  // Verband für LLH-1289: „2. Zug“ (Zugtrupp 1/1/2) mit zwei Gruppen zu je 0/1/8.
  const ZUG2 = einheit({
    id: 20,
    ist: { fuehrer: 1, unterfuehrer: 1, mannschaft: 2 },
    ist_kumuliert: { fuehrer: 1, unterfuehrer: 3, mannschaft: 18 },
  });
  const GRUPPE_A = einheit({
    id: 21,
    ueber_einheit_id: 20,
    ist: { fuehrer: 0, unterfuehrer: 1, mannschaft: 8 },
    ist_kumuliert: { fuehrer: 0, unterfuehrer: 1, mannschaft: 8 },
  });
  const GRUPPE_B = einheit({
    id: 22,
    ueber_einheit_id: 20,
    ist: { fuehrer: 0, unterfuehrer: 1, mannschaft: 8 },
    ist_kumuliert: { fuehrer: 0, unterfuehrer: 1, mannschaft: 8 },
  });
  const SPORTPLATZ = br({
    id: 1,
    bezeichnung: 'BR Sportplatz',
    abschnitt_id: 4,
    abschnitt_name: 'Nord',
    standort: 'Sportplatz',
    einheit_ids: [10, 11],
    belegung: { einheiten: 2, fahrzeuge: 3, laengste_seit_at: '2026-10-15 11:42:00' },
  });

  function stelleBereit(raeume: BrListenEintrag[], einheiten: () => Response) {
    server.use(
      http.get('/api/einsaetze/1', () => HttpResponse.json(einsatz())),
      http.get('/api/einsaetze/1/bereitstellungsraeume', () => HttpResponse.json(raeume)),
      http.get('/api/einsaetze/1/einheiten', einheiten),
    );
  }

  /** Zellen der Zeile eines Raums, je Spaltenkopf. */
  async function zeileVon(bezeichnung: string): Promise<Record<string, string>> {
    const zeile = (await screen.findByText(bezeichnung)).closest('tr')!;
    const koepfe = screen
      .getAllByRole('columnheader')
      .map((k) => k.textContent ?? '')
      .filter((k) => k !== '');
    const zellen = within(zeile).getAllByRole('cell');
    return Object.fromEntries(koepfe.map((k, i) => [k, zellen[i]?.textContent ?? '']));
  }

  it('zeigt Abschnitt, Stärke, Fahrzeuge, Einheiten und längste Wartezeit wie die Detailseite', async () => {
    stelleBereit([SPORTPLATZ], () => HttpResponse.json([ZUG, TRUPP]));
    renderPage();
    await waitFor(async () => expect((await zeileVon('BR Sportplatz')).Stärke).toBe('0/1/5//6'));
    expect(await zeileVon('BR Sportplatz')).toMatchObject({
      Abschnitt: 'Nord',
      Standort: 'Sportplatz',
      Fahrzeuge: '3',
      Einheiten: '2',
      'Längste Wartezeit': '48 min',
    });
  });

  it('zählt nur, wer im Raum steht: eine Gruppe in einem anderen Raum zählt dort (LLH-1289)', async () => {
    // Gruppe A steht mit dem 2. Zug im BR Sportplatz, Gruppe B im BR Schule.
    stelleBereit(
      [
        { ...SPORTPLATZ, einheit_ids: [20, 21] },
        br({ id: 2, bezeichnung: 'BR Schule', einheit_ids: [22] }),
      ],
      () => HttpResponse.json([ZUG, TRUPP, ZUG2, GRUPPE_A, GRUPPE_B]),
    );
    renderPage();
    await waitFor(async () => expect((await zeileVon('BR Sportplatz')).Stärke).toBe('1/2/10//13'));
    expect((await zeileVon('BR Schule')).Stärke).toBe('0/1/8//9');
  });

  it('ohne Einheitenliste (403) steht in „Stärke“ „—“ mit sichtbarem Grund', async () => {
    stelleBereit([SPORTPLATZ], () => new HttpResponse(null, { status: 403 }));
    renderPage();
    // Sichtbar an der Zelle, nicht nur als Tooltip (Touch): ein leerer Raum zeigt nur „—“.
    await waitFor(async () =>
      expect((await zeileVon('BR Sportplatz')).Stärke).toBe('— unvollständig'),
    );
    expect((await zeileVon('BR Sportplatz')).Fahrzeuge).toBe('3');
  });

  it('ohne Abschnitt und ohne Belegung „—“, ein leerer Raum ist nicht unvollständig', async () => {
    stelleBereit([br({ bezeichnung: 'BR Ost' })], () => HttpResponse.json([]));
    renderPage();
    const zeile = await zeileVon('BR Ost');
    expect(zeile).toMatchObject({
      Abschnitt: '—',
      Stärke: '—',
      Fahrzeuge: '0',
      Einheiten: '0',
      'Längste Wartezeit': '—',
    });
    expect(screen.queryByText(/unvollständig/)).not.toBeInTheDocument();
  });

  it.each(['Abschnitt', 'Standort'])(
    '%s lässt sich ausblenden, die Zahlspalten bleiben',
    async (spalte) => {
      setzeViewportBreite(1024);
      stelleBereit([SPORTPLATZ], () => HttpResponse.json([ZUG, TRUPP]));
      renderPage();
      await screen.findByText('BR Sportplatz');
      expect(screen.getByRole('columnheader', { name: spalte })).toBeInTheDocument();

      await userEvent.click(screen.getByRole('button', { name: /Spalten.*Bereitstellungsräume/ }));
      const menue = await waitFor(() => {
        const m = document.querySelector<HTMLElement>(
          '.ant-dropdown:not(.ant-dropdown-hidden) [role="menu"]',
        );
        expect(m).not.toBeNull();
        return m!;
      });
      const eintraege = within(menue)
        .getAllByRole('menuitem')
        .map((e) => e.textContent?.trim());
      for (const zahl of ['Stärke', 'Fahrzeuge', 'Einheiten', 'Längste Wartezeit']) {
        expect(eintraege).not.toContain(zahl);
      }
      await userEvent.click(within(menue).getByRole('menuitem', { name: spalte }));

      await waitFor(() =>
        expect(screen.queryByRole('columnheader', { name: spalte })).not.toBeInTheDocument(),
      );
      for (const bleibt of ['Fahrzeuge', 'Einheiten', 'Längste Wartezeit']) {
        expect(screen.getByRole('columnheader', { name: bleibt })).toBeInTheDocument();
      }
    },
  );

  it('unter md weichen Abschnitt und Standort, die Zahlspalten bleiben', async () => {
    setzeViewportBreite(390);
    stelleBereit([SPORTPLATZ], () => HttpResponse.json([ZUG, TRUPP]));
    renderPage();
    await screen.findByText('BR Sportplatz');
    expect(screen.queryByRole('columnheader', { name: 'Abschnitt' })).not.toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: 'Standort' })).not.toBeInTheDocument();
    for (const bleibt of ['Stärke', 'Fahrzeuge', 'Einheiten', 'Längste Wartezeit']) {
      expect(screen.getByRole('columnheader', { name: bleibt })).toBeInTheDocument();
    }
    expect(
      screen.getByRole('button', { name: /Spalten · 2 ausgeblendet.*Bereitstellungsräume/ }),
    ).toBeInTheDocument();
  });

  it('die Wartezeit läuft mit der Uhr ohne neuen Abruf', async () => {
    stelleBereit([SPORTPLATZ], () => HttpResponse.json([ZUG, TRUPP]));
    renderPage();
    await waitFor(async () =>
      expect((await zeileVon('BR Sportplatz'))['Längste Wartezeit']).toBe('48 min'),
    );
    act(() => vi.advanceTimersByTime(60_000));
    expect((await zeileVon('BR Sportplatz'))['Längste Wartezeit']).toBe('49 min');
  });
});

describe('BereitstellungsraeumePage · Sortieren und Filtern (LLH-1096)', () => {
  const OST = br({
    id: 1,
    bezeichnung: 'BR Ost',
    status: 'aktiv',
    abschnitt_name: 'Nord',
    belegung: { einheiten: 1, fahrzeuge: 4, laengste_seit_at: null },
  });
  const WEST = br({
    id: 2,
    bezeichnung: 'BR West',
    status: 'geplant',
    abschnitt_name: 'Mitte',
    belegung: { einheiten: 3, fahrzeuge: 1, laengste_seit_at: null },
  });
  const bezeichnungen = () =>
    [...document.querySelectorAll('tbody tr[data-row-key]')].map(
      (z) => z.querySelector('td')?.textContent,
    );

  beforeEach(() => {
    setzeViewportBreite(1366);
    server.use(
      http.get('/api/einsaetze/1', () => HttpResponse.json(einsatz())),
      http.get('/api/einsaetze/1/bereitstellungsraeume', () => HttpResponse.json([OST, WEST])),
      http.get('/api/einsaetze/1/einheiten', () => HttpResponse.json([])),
    );
  });

  it('Sortieren und Filtern ändern die Menge und die Adresse', async () => {
    renderPage();
    await screen.findByText('BR West');
    expect(bezeichnungen()).toEqual(['BR Ost', 'BR West']);

    await kopfFilterWaehlen('Abschnitt', [/^Mitte/]);
    await waitFor(() => expect(bezeichnungen()).toEqual(['BR West']));
    await waitFor(() =>
      expect(screen.getByTestId('suche')).toHaveTextContent('?f.abschnitt=Mitte'),
    );

    await userEvent.click(screen.getByRole('button', { name: 'Filter zurücksetzen' }));
    await userEvent.click(sortTarget(screen.getByRole('columnheader', { name: /^Fahrzeuge/ })));
    await waitFor(() => expect(bezeichnungen()).toEqual(['BR West', 'BR Ost']));
    await waitFor(() =>
      expect(screen.getByTestId('suche')).toHaveTextContent('?sort=fahrzeuge%3Aauf'),
    );
  });

  it('eine Adresse mit Status-Filter und Sortierung zeigt dieselbe Liste', async () => {
    renderPage('/einsaetze/1/bereitstellungsraeume/liste?f.status=aktiv,geplant&sort=einheiten:ab');
    await screen.findByText('BR West');
    expect(bezeichnungen()).toEqual(['BR West', 'BR Ost']);
    expect(
      screen.getByRole('button', { name: 'Filter Status: aktiv entfernen' }),
    ).toBeInTheDocument();
  });
});
