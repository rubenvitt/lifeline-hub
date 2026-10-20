import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App as AntApp } from 'antd';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import BetreuungPage from './BetreuungPage';
import { ladeEinsatz } from '../api/einsaetze';
import { AuthProvider } from '../auth/AuthContext';
import { ApiError } from '../api/client';
import { einsatzKeys } from '../api/queryKeys';
import type { BetreuungUebersicht, Betreuungsstelle } from '../api/types';
import { queueLeerenFuerTests, schreibaktionenLaden } from '../offline/queue';
import { meHandler, server } from '../test/server';
import { benutzerFixture, freigabenFixture } from '../test/fixtures';
import { setzeOnline } from '../test/utils';

const einsatz = vi.hoisted(() => ({
  wert: { id: 1, bezeichnung: 'Hochwasser', status: 'aktiv', meine_rolle: 'einsatzleitung' },
}));
const freigaben = vi.hoisted(() => ({ wert: undefined as unknown }));
vi.mock('../api/einsaetze', () => ({
  ladeEinsatz: vi.fn(() => Promise.resolve(einsatz.wert)),
  // Freigaben für die Sprung-Sperre (LFH-888); Vorgabe: alles frei.
  ladeModulFreigaben: vi.fn(() => Promise.resolve(freigaben.wert)),
}));
vi.mock('../api/einsatzabschnitte', () => ({
  listeAbschnitte: vi.fn().mockResolvedValue([{ id: 3, name: 'Deichwache Nord' }]),
}));

const api = vi.hoisted(() => ({
  ladeBetreuung: vi.fn(),
  legeStelleAn: vi.fn(),
  aendereStelle: vi.fn(),
  storniereStelle: vi.fn(),
  meldeBelegung: vi.fn(),
  nimmBelegungZurueck: vi.fn(),
  ladeBelegungKopfzahl: vi.fn(),
  ladeBelegungVerlauf: vi.fn(),
}));
vi.mock('../api/betreuung', () => api);

const stelle = (over: Partial<Betreuungsstelle> & { id: number }): Betreuungsstelle => ({
  einsatz_id: 1,
  bezeichnung: `Stelle ${over.id}`,
  art: 'notunterkunft',
  status: 'in_betrieb',
  angelegt_at: '2026-09-23 08:00:00',
  ...over,
});

const TURNHALLE = stelle({
  id: 8,
  bezeichnung: 'Turnhalle Ost',
  kapazitaet_personen: 150,
  belegung: { id: 30, belegt: 89, zeitpunkt_at: '2026-09-23 10:00:00' },
});
const STADION = stelle({
  id: 9,
  bezeichnung: 'Weserstadion',
  art: 'anlaufstelle',
  kapazitaet_personen: 150,
  belegung: { id: 31, belegt: 140, zeitpunkt_at: '2026-09-23 10:00:00' },
});
const SCHULE = stelle({ id: 10, bezeichnung: 'Schule Nord', art: 'betreuungsstelle' });

const MIT_DATEN: BetreuungUebersicht = { stellen: [TURNHALLE, STADION, SCHULE] };

/**
 * Angemeldet als Benutzer 1: Belegungsmeldungen laufen über die Offline-Queue, und die gehört
 * einem Benutzer.
 */
const BENUTZER_ID = 1;

function renderPage(pfad = '/einsaetze/1/betreuung') {
  server.use(meHandler(benutzerFixture({ id: BENUTZER_ID, anzeigename: 'Leitung' })));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const ergebnis = render(
    <QueryClientProvider client={client}>
      <AntApp>
        <AuthProvider>
          <MemoryRouter initialEntries={[pfad]}>
            <Routes>
              <Route path="/einsaetze/:id/betreuung" element={<BetreuungPage />} />
              <Route path="/einsaetze/:id/lagekarte" element={<LagekarteSonde />} />
              <Route path="/einsaetze/:id/evakuierung" element={<EvakuierungSonde />} />
            </Routes>
          </MemoryRouter>
        </AuthProvider>
      </AntApp>
    </QueryClientProvider>,
  );
  return { ...ergebnis, client };
}

/** Ziel des Sprungs „Auf Karte verorten": zeigt die angesteuerte Adresse. */
function LagekarteSonde() {
  const ort = useLocation();
  return <div data-testid="lagekarte-ziel">{ort.pathname + ort.search}</div>;
}

/** Ziel der Umleitung alter Bezirkslinks (LLH-1034): zeigt die angesteuerte Adresse. */
function EvakuierungSonde() {
  const ort = useLocation();
  return <div data-testid="evakuierung-ziel">{ort.pathname + ort.search}</div>;
}

/**
 * Einsatz-Abrufe seit dem ersten. Eine Stelle kippt die Lagekennzahl `evakuiert` nie; der Einsatz
 * wird nach ihren Änderungen nicht neu abgerufen.
 */
async function einsatzAbrufeNach(aktion: () => Promise<void>): Promise<() => number> {
  await waitFor(() => expect(vi.mocked(ladeEinsatz)).toHaveBeenCalled());
  const vorher = vi.mocked(ladeEinsatz).mock.calls.length;
  await aktion();
  return () => vi.mocked(ladeEinsatz).mock.calls.length - vorher;
}

const zeileVon = (titel: string) => screen.getByText(titel).closest('tr') as HTMLElement;

/**
 * Der offene Dialog mit diesem Titel. Nicht über `findByRole('dialog', { name })`: ohne
 * `ConfigProvider` vergibt antd im Testmodus die id „test-id", der Name aus `aria-labelledby`
 * zeigte auf den ersten Knoten dieser id.
 */
async function dialogMit(titel: string): Promise<HTMLElement> {
  const dialog = await screen.findByRole('dialog');
  expect(within(dialog).getByText(titel, { selector: '.ant-modal-title' })).toBeInTheDocument();
  return dialog;
}

/** Wie `dialogMit`, aber auch, solange ein zweiter (schließender) Dialog noch im Baum steht. */
async function dialogUnter(titel: string): Promise<HTMLElement> {
  return waitFor(() => {
    const dialog = screen
      .getAllByRole('dialog')
      .find((d) => d.querySelector('.ant-modal-title')?.textContent === titel);
    expect(dialog).toBeDefined();
    return dialog!;
  });
}

/** Das geöffnete Menü — antd lässt die Portale geschlossener Dropdowns im Baum stehen. */
async function offenesMenue() {
  return waitFor(() => {
    const m = document.querySelector(
      '.ant-dropdown:not(.ant-dropdown-hidden) [role="menu"]',
    ) as HTMLElement | null;
    expect(m).not.toBeNull();
    return m!;
  });
}

describe('BetreuungPage (LFH-639)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    einsatz.wert = {
      id: 1,
      bezeichnung: 'Hochwasser',
      status: 'aktiv',
      meine_rolle: 'einsatzleitung',
    };
    api.ladeBetreuung.mockResolvedValue(MIT_DATEN);
    freigaben.wert = freigabenFixture();
  });

  it('Leerzustand: die Tabelle sagt, dass keine Stelle da ist', async () => {
    api.ladeBetreuung.mockResolvedValue({ stellen: [] });
    renderPage();
    expect(await screen.findByText(/Keine Betreuungsstellen/)).toBeInTheDocument();
    // Die Bezirke sind das Modul Evakuierung (LLH-1034).
    expect(screen.queryByText(/Evakuierungsbezirk/)).toBeNull();
  });

  it('ein Abruffehler ist kein Leerzustand', async () => {
    api.ladeBetreuung.mockRejectedValue(new Error('500'));
    renderPage();
    expect(await screen.findByText('Betreuung konnte nicht geladen werden')).toBeInTheDocument();
    expect(screen.queryByText(/Keine Betreuungsstellen/)).toBeNull();
  });

  it('Block Betreuungsstellen: Tabelle, „frei" nur mit Kapazität, Auslastungswort als zweiter Kanal', async () => {
    renderPage();
    await screen.findByText('Turnhalle Ost');
    const block = screen.getByRole('region', { name: 'Betreuungsstellen' });
    expect(block.querySelector('.ant-table')).not.toBeNull();
    const turnhalle = zeileVon('Turnhalle Ost');
    expect(within(turnhalle).getByText('Notunterkunft')).toBeInTheDocument();
    expect(within(turnhalle).getByText('in Betrieb')).toBeInTheDocument();
    expect(within(turnhalle).getByText('89')).toBeInTheDocument();
    expect(within(turnhalle).getByText('61')).toBeInTheDocument();
    expect(within(zeileVon('Weserstadion')).getByText('fast voll')).toBeInTheDocument();
    // Ohne Kapazität keine Zahl freier Plätze und keine Einstufung.
    const schule = zeileVon('Schule Nord');
    expect(within(schule).getByText('keine Meldung')).toBeInTheDocument();
    expect(within(schule).queryByText(/voll|überbelegt/)).toBeNull();
  });

  it('Kopf Betreuungsstellen: gemeldete Summe mit „ohne Meldung" — ohne jede Meldung „keine Meldung", nie 0', async () => {
    renderPage();
    await screen.findByText('Turnhalle Ost');
    // 89 + 140, die Schule hat nicht gemeldet.
    expect(screen.getByText('229 untergebracht · 1 ohne Meldung')).toBeInTheDocument();
  });

  describe('„davon namentlich" (LFH-674, design.md D7)', () => {
    const MIT_NAMENTLICH: BetreuungUebersicht = {
      ...MIT_DATEN,
      namentlich: [
        { stelle_id: TURNHALLE.id, anzahl: 2 },
        { stelle_id: SCHULE.id, anzahl: 3 },
      ],
    };

    it('steht in der Zelle „belegt" hinter der Belegung, ohne Meldung ohne „davon"', async () => {
      api.ladeBetreuung.mockResolvedValue(MIT_NAMENTLICH);
      renderPage();
      await screen.findByText('Turnhalle Ost');
      const turnhalle = zeileVon('Turnhalle Ost');
      expect(within(turnhalle).getByText('89')).toBeInTheDocument();
      const hinweis = (zeile: HTMLElement) =>
        zeile.querySelector<HTMLElement>('[data-lfh="stelle-namentlich"]');
      expect(hinweis(turnhalle)).toHaveTextContent('· davon namentlich 2');
      // Die Zahl läuft Mono mit tabular-nums, das Wort nicht.
      expect(within(hinweis(turnhalle)!).getByText('2')).toHaveStyle({
        fontVariantNumeric: 'tabular-nums',
      });
      expect(hinweis(zeileVon('Schule Nord'))).toHaveTextContent('· namentlich 3');
      // Stelle ohne Eintrag in der Liste: 0 → kein Text.
      expect(hinweis(zeileVon('Weserstadion'))).toBeNull();
    });

    it('geht in keine Summe ein — Kopf und „frei" lesen nur die Belegung', async () => {
      api.ladeBetreuung.mockResolvedValue(MIT_NAMENTLICH);
      renderPage();
      await screen.findByText('Turnhalle Ost');
      expect(screen.getByText('229 untergebracht · 1 ohne Meldung')).toBeInTheDocument();
      expect(within(zeileVon('Turnhalle Ost')).getByText('61')).toBeInTheDocument();
    });

    it('fehlt `namentlich` in der Antwort (kein Personenrecht), steht nirgends etwas', async () => {
      renderPage();
      await screen.findByText('Turnhalle Ost');
      expect(document.querySelector('[data-lfh="stelle-namentlich"]')).toBeNull();
      expect(screen.queryByText(/namentlich/)).toBeNull();
    });
  });

  it('Kopf Betreuungsstellen ohne jede Meldung: „keine Meldung", nicht „0 untergebracht"', async () => {
    // „nichts gemeldet" ist nicht „niemand in Betreuung".
    api.ladeBetreuung.mockResolvedValue({
      stellen: [SCHULE, stelle({ id: 11, bezeichnung: 'Halle West' })],
    });
    renderPage();
    await screen.findByText('Halle West');
    expect(screen.getByText('keine Meldung · 2 ohne Meldung')).toBeInTheDocument();
    expect(screen.queryByText(/0 untergebracht/)).toBeNull();
  });

  it('volle Stellen im Blickfeld: „n voll" im Seitenkopf und im Blockkopf, „fast voll" zählt nicht (LFH-678)', async () => {
    api.ladeBetreuung.mockResolvedValue({
      stellen: [
        TURNHALLE,
        STADION, // fast voll — zählt nicht
        stelle({
          id: 12,
          bezeichnung: 'Halle Süd',
          kapazitaet_personen: 80,
          belegung: { id: 32, belegt: 80, zeitpunkt_at: '2026-09-23 10:00:00' },
        }),
        stelle({
          id: 13,
          bezeichnung: 'Gemeindehaus',
          kapazitaet_personen: 40,
          belegung: { id: 33, belegt: 52, zeitpunkt_at: '2026-09-23 10:00:00' },
        }),
        SCHULE,
      ],
    });
    renderPage();
    await screen.findByText('Halle Süd');
    // Seitenkopf: die einzige Zeile, die auch bei langer Tabelle über der Falz steht.
    expect(screen.getByText('5 Betreuungsstellen · 2 voll')).toBeInTheDocument();
    // Blockkopf: dieselbe Zahl neben der Summe.
    expect(screen.getByText('361 untergebracht · 2 voll · 1 ohne Meldung')).toBeInTheDocument();
    // Die Zeilen tragen weiter ihr eigenes Wort — der Kopf fasst nur zusammen.
    expect(within(zeileVon('Halle Süd')).getByText('voll')).toBeInTheDocument();
    expect(within(zeileVon('Gemeindehaus')).getByText('überbelegt')).toBeInTheDocument();
  });

  it('ohne volle Stelle kein „0 voll" — weder im Seitenkopf noch im Blockkopf (LFH-678)', async () => {
    renderPage();
    await screen.findByText('Turnhalle Ost');
    expect(screen.getByText('3 Betreuungsstellen')).toBeInTheDocument();
    expect(screen.queryByText(/\bvoll\b.*·|· \d+ voll/)).toBeNull();
  });

  it('genau EINE Primäraktion im Kopf: „Betreuungsstelle anlegen" (LLH-1034)', async () => {
    renderPage();
    await screen.findByText('Turnhalle Ost');
    const kopf = document.querySelector('[data-lfh="seitenkopf-aktionen"]') as HTMLElement;
    const primaer = [...kopf.querySelectorAll('button')].filter((b) =>
      b.className.includes('-btn-primary'),
    );
    expect(primaer).toHaveLength(1);
    expect(primaer[0]).toHaveAccessibleName('Betreuungsstelle anlegen');
    // Kein zweiter Anlegen-Knopf im Block, kein Bezirk mehr auf dieser Seite.
    expect(screen.getAllByRole('button', { name: 'Betreuungsstelle anlegen' })).toHaveLength(1);
    expect(screen.queryByRole('button', { name: 'Evakuierungsbezirk anlegen' })).toBeNull();
  });

  it('Betreuungsstelle anlegen aus dem Kopf: Dialog, POST mit den Feldern', async () => {
    api.legeStelleAn.mockResolvedValue(stelle({ id: 14, bezeichnung: 'Halle West' }));
    renderPage();
    await screen.findByText('Turnhalle Ost');
    await userEvent.click(screen.getByRole('button', { name: 'Betreuungsstelle anlegen' }));
    const dialog = await dialogMit('Betreuungsstelle anlegen');
    await userEvent.type(within(dialog).getByLabelText('Bezeichnung'), 'Halle West');
    await userEvent.type(within(dialog).getByLabelText('Kapazität (Personen)'), '80');
    const neu = await einsatzAbrufeNach(async () => {
      await userEvent.click(within(dialog).getByRole('button', { name: 'Anlegen' }));
      await waitFor(() =>
        expect(api.legeStelleAn).toHaveBeenCalledWith(
          1,
          expect.objectContaining({ bezeichnung: 'Halle West', kapazitaet_personen: 80 }),
        ),
      );
    });
    expect(await screen.findByText('Betreuungsstelle Halle West angelegt')).toBeInTheDocument();
    // Eine Stelle kippt die Lagekennzahl nie — der Einsatz wird nicht neu gefragt.
    expect(neu()).toBe(0);
  });

  it('Beobachter: Hinweis mit Grund, Primäraktion gesperrt — Zeilenaktionen entfallen', async () => {
    einsatz.wert = { ...einsatz.wert, meine_rolle: 'beobachter' };
    renderPage();
    await screen.findByText('Turnhalle Ost');
    expect(screen.getByText('nur Einsatzleitung und Führungspersonal')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Betreuungsstelle anlegen' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: /^Belegung melden/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Aktionen zu/ })).toBeNull();
  });

  it('Gegenstück mit Schreibrecht: Zeilenaktionen tragen die Zeilenkennung', async () => {
    renderPage();
    await screen.findByText('Turnhalle Ost');
    expect(
      screen.getByRole('button', { name: 'Belegung melden für Turnhalle Ost' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Aktionen zu Stelle Turnhalle Ost' })).toBeEnabled();
  });

  describe('Deeplink', () => {
    const vorher = Element.prototype.scrollIntoView;
    let gescrollt: Element[];
    beforeEach(() => {
      gescrollt = [];
      Element.prototype.scrollIntoView = function (this: Element) {
        gescrollt.push(this);
      };
    });
    afterEach(() => {
      Element.prototype.scrollIntoView = vorher;
    });

    it('ein alter Link ?bezirk=<id> leitet zur Evakuierung um, ohne die Betreuung zu laden (LLH-1034)', async () => {
      renderPage('/einsaetze/1/betreuung?bezirk=6');
      expect(await screen.findByTestId('evakuierung-ziel')).toHaveTextContent(
        '/einsaetze/1/evakuierung?bezirk=6',
      );
      expect(api.ladeBetreuung).not.toHaveBeenCalled();
    });

    it('ein unlesbarer ?bezirk= führt auf die Evakuierung ohne Auswahl (LLH-1034)', async () => {
      renderPage('/einsaetze/1/betreuung?bezirk=abc');
      expect(await screen.findByTestId('evakuierung-ziel')).toHaveTextContent(
        /^\/einsaetze\/1\/evakuierung$/,
      );
    });

    it('?stelle=<id> hebt die Tabellenzeile hervor und scrollt zu ihr', async () => {
      renderPage('/einsaetze/1/betreuung?stelle=9');
      await screen.findByText('Weserstadion');
      await waitFor(() => expect(zeileVon('Weserstadion')).toHaveClass('zeile-hervorgehoben'));
      expect(zeileVon('Turnhalle Ost')).not.toHaveClass('zeile-hervorgehoben');
      await waitFor(() => expect(gescrollt).toContain(zeileVon('Weserstadion')));
    });
  });

  describe('Rückgängig nach dem Melden (4.3)', () => {
    it('„Rückgängig" nimmt die GERADE gemeldete Belegung zurück, nicht die aktuelle', async () => {
      api.meldeBelegung.mockResolvedValue({ meldung_id: 91, stelle: TURNHALLE });
      api.nimmBelegungZurueck.mockResolvedValue({ meldung_id: 91, stelle: TURNHALLE });
      renderPage();
      await userEvent.click(
        await screen.findByRole('button', { name: 'Belegung melden für Turnhalle Ost' }),
      );
      const dialog = await dialogMit('Belegung melden: Turnhalle Ost');
      await userEvent.type(within(dialog).getByLabelText('Belegt gesamt (Personen)'), '95');
      const neu = await einsatzAbrufeNach(async () => {
        await userEvent.click(within(dialog).getByRole('button', { name: 'Melden' }));
        await userEvent.click(await screen.findByRole('button', { name: /Rückgängig/ }));
        await waitFor(() => expect(api.nimmBelegungZurueck).toHaveBeenCalledWith(1, 91));
      });
      // Die aktuelle Meldung der Stelle (30) bleibt unberührt.
      expect(api.nimmBelegungZurueck).not.toHaveBeenCalledWith(1, 30);
      expect(neu()).toBe(0);
    });

    it('eine zweite Meldung ersetzt den stehenden Toast — ein Rückweg, der zur jüngsten gehört', async () => {
      api.meldeBelegung
        .mockResolvedValueOnce({ meldung_id: 91, stelle: TURNHALLE })
        .mockResolvedValueOnce({ meldung_id: 92, stelle: STADION });
      api.nimmBelegungZurueck.mockResolvedValue({ meldung_id: 92, stelle: STADION });
      renderPage();
      await userEvent.click(
        await screen.findByRole('button', { name: 'Belegung melden für Turnhalle Ost' }),
      );
      let dialog = await dialogMit('Belegung melden: Turnhalle Ost');
      await userEvent.type(within(dialog).getByLabelText('Belegt gesamt (Personen)'), '95');
      await userEvent.click(within(dialog).getByRole('button', { name: 'Melden' }));
      await screen.findByRole('button', { name: /Rückgängig/ });
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

      await userEvent.click(
        screen.getByRole('button', { name: 'Belegung melden für Weserstadion' }),
      );
      dialog = await dialogMit('Belegung melden: Weserstadion');
      await userEvent.type(within(dialog).getByLabelText('Belegt gesamt (Personen)'), '120');
      await userEvent.click(within(dialog).getByRole('button', { name: 'Melden' }));
      await waitFor(() =>
        expect(screen.getByText(/Belegung Weserstadion gemeldet/)).toBeInTheDocument(),
      );
      const rueckwege = screen.getAllByRole('button', { name: /Rückgängig/ });
      expect(rueckwege).toHaveLength(1);
      await userEvent.click(rueckwege[0]);
      await waitFor(() => expect(api.nimmBelegungZurueck).toHaveBeenCalledWith(1, 92));
      expect(api.nimmBelegungZurueck).not.toHaveBeenCalledWith(1, 91);
    });
  });

  describe('Melden ohne Verbindung (LFH-675)', () => {
    afterEach(async () => {
      setzeOnline(true);
      await queueLeerenFuerTests();
    });

    it('offline: Belegung wird vorgemerkt — Hinweis statt Rückgängig, Dialog schließt', async () => {
      await queueLeerenFuerTests();
      renderPage();
      const melden = await screen.findByRole('button', {
        name: 'Belegung melden für Turnhalle Ost',
      });
      // Online geladen, dann fällt das Netz weg: so liegt es im Einsatz.
      setzeOnline(false);
      await userEvent.click(melden);
      const dialog = await dialogMit('Belegung melden: Turnhalle Ost');
      await userEvent.type(within(dialog).getByLabelText('Belegt gesamt (Personen)'), '95');
      await userEvent.click(within(dialog).getByRole('button', { name: 'Melden' }));

      expect(await screen.findByText(/Offline vorgemerkt/)).toBeInTheDocument();
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      expect(screen.queryByRole('button', { name: /Rückgängig/ })).toBeNull();
      expect(api.meldeBelegung).not.toHaveBeenCalled();
      const [zeile] = await schreibaktionenLaden(BENUTZER_ID, 1);
      expect(zeile.aktion).toMatchObject({
        art: 'belegung',
        stelle_id: 8,
        bezeichnung: 'Turnhalle Ost',
        daten: { belegt: 95, zeitpunkt_at: expect.any(String) },
      });
    });

    it('online: gesendet ohne Zeitpunkt — die Serveruhr gilt, Rückgängig bleibt', async () => {
      api.meldeBelegung.mockResolvedValue({ meldung_id: 91, stelle: TURNHALLE });
      renderPage();
      await userEvent.click(
        await screen.findByRole('button', { name: 'Belegung melden für Turnhalle Ost' }),
      );
      const dialog = await dialogMit('Belegung melden: Turnhalle Ost');
      await userEvent.type(within(dialog).getByLabelText('Belegt gesamt (Personen)'), '95');
      await userEvent.click(within(dialog).getByRole('button', { name: 'Melden' }));
      expect(await screen.findByRole('button', { name: /Rückgängig/ })).toBeInTheDocument();
      expect(api.meldeBelegung.mock.calls[0][2]).not.toHaveProperty('zeitpunkt_at');
      expect(screen.queryByText(/Offline vorgemerkt/)).toBeNull();
    });
  });

  describe('Fehler einer Rücknahme (C10/H14)', () => {
    const TITEL = 'Meldung konnte nicht zurückgenommen werden';

    async function meldeBelegung() {
      await userEvent.click(
        await screen.findByRole('button', { name: 'Belegung melden für Turnhalle Ost' }),
      );
      const dialog = await dialogMit('Belegung melden: Turnhalle Ost');
      await userEvent.type(within(dialog).getByLabelText('Belegt gesamt (Personen)'), '95');
      await userEvent.click(within(dialog).getByRole('button', { name: 'Melden' }));
      await waitFor(() =>
        expect(api.meldeBelegung).toHaveBeenCalledWith(
          1,
          8,
          { belegt: 95, client_id: expect.any(String) },
          { offlineQueueBenutzerId: BENUTZER_ID },
        ),
      );
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    }

    beforeEach(() => {
      api.meldeBelegung.mockResolvedValue({ meldung_id: 91, stelle: TURNHALLE });
      api.nimmBelegungZurueck.mockRejectedValue(new ApiError(422, 'Belegungs-Rücknahme abgelehnt'));
    });

    it('steht über der Seite und verschwindet mit der nächsten Meldung', async () => {
      renderPage();
      await meldeBelegung();
      await userEvent.click(await screen.findByRole('button', { name: /Rückgängig/ }));
      await waitFor(() => expect(api.nimmBelegungZurueck).toHaveBeenCalledWith(1, 91));
      expect(await screen.findByText('Belegungs-Rücknahme abgelehnt')).toBeInTheDocument();
      expect(screen.getByText(TITEL)).toBeInTheDocument();

      await meldeBelegung();
      await waitFor(() => expect(screen.queryByText(TITEL)).toBeNull());
      expect(screen.queryByText('Belegungs-Rücknahme abgelehnt')).toBeNull();
    });
  });

  it('„Auf Karte verorten" nur an unverorteter Stelle, führt in den Platziermodus (LFH-673)', async () => {
    api.ladeBetreuung.mockResolvedValue({
      stellen: [TURNHALLE, { ...SCHULE, lat: 51.9, lon: 8.8 }],
    });
    renderPage();
    // Verortet: kein Eintrag.
    await userEvent.click(
      await screen.findByRole('button', { name: 'Aktionen zu Stelle Schule Nord' }),
    );
    expect(
      within(await offenesMenue()).queryByRole('menuitem', { name: /Auf Karte verorten/ }),
    ).toBeNull();
    await userEvent.keyboard('{Escape}');
    // Unverortet: Eintrag, Sprung mit Platzier-Auftrag.
    await userEvent.click(screen.getByRole('button', { name: 'Aktionen zu Stelle Turnhalle Ost' }));
    await waitFor(() => {
      const offen = document.querySelectorAll(
        '.ant-dropdown:not(.ant-dropdown-hidden) [role="menu"]',
      );
      const menue = offen[offen.length - 1] as HTMLElement;
      expect(within(menue).getByRole('menuitem', { name: /Auf Karte verorten/ })).toBeTruthy();
    });
    const offen = document.querySelectorAll(
      '.ant-dropdown:not(.ant-dropdown-hidden) [role="menu"]',
    );
    await userEvent.click(
      within(offen[offen.length - 1] as HTMLElement).getByRole('menuitem', {
        name: /Auf Karte verorten/,
      }),
    );
    expect(await screen.findByTestId('lagekarte-ziel')).toHaveTextContent(
      // Mit Herkunft: die Karte bietet danach „Zurück zu …“ an (LLH-1125).
      '/einsaetze/1/lagekarte?platzieren=betreuungsstelle%3A8&zurueck=1',
    );
  });

  it('gesperrte Lagekarte: „Auf Karte verorten" steht gesperrt mit Grund (LFH-888)', async () => {
    freigaben.wert = freigabenFixture({ lagekarte: { zugriff: false } });
    api.ladeBetreuung.mockResolvedValue({ stellen: [TURNHALLE] });
    const { client } = renderPage();
    await waitFor(() => expect(client.getQueryData(einsatzKeys.modulFreigaben(1))).toBeDefined());
    await userEvent.click(
      await screen.findByRole('button', { name: 'Aktionen zu Stelle Turnhalle Ost' }),
    );
    const eintrag = within(await offenesMenue()).getByRole('menuitem', {
      name: /Auf Karte verorten \(Keine Berechtigung\)/,
    });
    expect(eintrag).toHaveAttribute('aria-disabled', 'true');
  });

  it('ohne Schreibrecht gibt es keinen Einstieg „Auf Karte verorten" (LFH-673)', async () => {
    einsatz.wert = { ...einsatz.wert, meine_rolle: 'beobachter' };
    api.ladeBetreuung.mockResolvedValue({ stellen: [TURNHALLE] });
    renderPage();
    await screen.findByText('Turnhalle Ost');
    expect(screen.queryByRole('button', { name: 'Aktionen zu Stelle Turnhalle Ost' })).toBeNull();
    expect(screen.queryByText(/Auf Karte verorten/)).toBeNull();
  });

  it('Menü „Bearbeiten" an einer Stelle: Dialog mit ihren Werten, PATCH nur mit der Änderung (LFH-682)', async () => {
    api.aendereStelle.mockResolvedValue({ ...TURNHALLE, kapazitaet_personen: 200 });
    renderPage();
    await userEvent.click(
      await screen.findByRole('button', { name: 'Aktionen zu Stelle Turnhalle Ost' }),
    );
    await userEvent.click(
      within(await offenesMenue()).getByRole('menuitem', { name: /Bearbeiten/ }),
    );
    const dialog = await dialogMit('Stelle bearbeiten: Turnhalle Ost');
    const feld = within(dialog).getByLabelText('Kapazität (Personen)');
    expect(feld).toHaveValue('150');
    await userEvent.clear(feld);
    await userEvent.type(feld, '200');
    const abrufeVorher = api.ladeBetreuung.mock.calls.length;
    const neu = await einsatzAbrufeNach(async () => {
      await userEvent.click(within(dialog).getByRole('button', { name: 'Speichern' }));
      await waitFor(() =>
        expect(api.aendereStelle).toHaveBeenCalledWith(1, 8, { kapazitaet_personen: 200 }),
      );
    });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(
      await screen.findByText('Betreuungsstelle Turnhalle Ost gespeichert'),
    ).toBeInTheDocument();
    await waitFor(() => expect(api.ladeBetreuung.mock.calls.length).toBeGreaterThan(abrufeVorher));
    // Eine Stelle kippt die Lagekennzahl nie — der Einsatz wird nicht neu gefragt.
    expect(neu()).toBe(0);
    expect(api.meldeBelegung).not.toHaveBeenCalled();
  });

  it('Schließen einer belegten Stelle über die Seite: erst die Leermeldung an DIESE Stelle, dann der Status — ohne Rückweg auf die 0 (LFH-682)', async () => {
    api.meldeBelegung.mockResolvedValue({
      meldung_id: 92,
      stelle: {
        ...TURNHALLE,
        belegung: { id: 92, belegt: 0, zeitpunkt_at: '2026-09-23 11:00:00' },
      },
    });
    api.aendereStelle.mockResolvedValue({ ...TURNHALLE, status: 'geschlossen' });
    renderPage();
    await userEvent.click(
      await screen.findByRole('button', { name: 'Aktionen zu Stelle Turnhalle Ost' }),
    );
    await userEvent.click(
      within(await offenesMenue()).getByRole('menuitem', { name: /Bearbeiten/ }),
    );
    const dialog = await dialogMit('Stelle bearbeiten: Turnhalle Ost');
    await userEvent.click(
      within(dialog).getByRole('radio', { name: 'geschlossen' }).closest('label')!,
    );
    await userEvent.click(
      await within(dialog).findByRole('checkbox', { name: /Belegung 0 melden/ }),
    );
    await userEvent.click(within(dialog).getByRole('button', { name: 'Speichern' }));
    await waitFor(() =>
      expect(api.aendereStelle).toHaveBeenCalledWith(1, 8, { status: 'geschlossen' }),
    );
    expect(api.meldeBelegung).toHaveBeenCalledTimes(1);
    expect(api.meldeBelegung).toHaveBeenCalledWith(1, 8, { belegt: 0 });
    expect(api.meldeBelegung.mock.invocationCallOrder[0]).toBeLessThan(
      api.aendereStelle.mock.invocationCallOrder[0],
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    // Die Leermeldung ist Teil des Schließens: ein Rückweg auf sie ließe eine geschlossene, belegte
    // Stelle zu — deshalb kein Rückgängig-Toast.
    expect(
      await screen.findByText('Betreuungsstelle Turnhalle Ost gespeichert'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Rückgängig/ })).toBeNull();
  });

  it('Stelle stornieren über das Menü: eigener Dialog mit rotem Knopf, dann POST an DIESE Stelle (LFH-682)', async () => {
    api.storniereStelle.mockResolvedValue({ ...TURNHALLE, storniert_at: '2026-09-23 11:00:00' });
    renderPage();
    await userEvent.click(
      await screen.findByRole('button', { name: 'Aktionen zu Stelle Turnhalle Ost' }),
    );
    await userEvent.click(
      within(await offenesMenue()).getByRole('menuitem', { name: /Stornieren/ }),
    );
    const dialog = await dialogMit('Betreuungsstelle Turnhalle Ost stornieren?');
    const ok = within(dialog).getByRole('button', { name: 'Stornieren' });
    expect(ok).toHaveClass('ant-btn-dangerous');
    const abrufeVorher = api.ladeBetreuung.mock.calls.length;
    const neu = await einsatzAbrufeNach(async () => {
      await userEvent.click(ok);
      await waitFor(() => expect(api.storniereStelle).toHaveBeenCalledWith(1, 8));
    });
    expect(api.storniereStelle).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(await screen.findByText('Betreuungsstelle Turnhalle Ost storniert')).toBeInTheDocument();
    await waitFor(() => expect(api.ladeBetreuung.mock.calls.length).toBeGreaterThan(abrufeVorher));
    expect(neu()).toBe(0);
  });

  it('Stelle stornieren: Abbrechen sendet nichts (LFH-682)', async () => {
    renderPage();
    await userEvent.click(
      await screen.findByRole('button', { name: 'Aktionen zu Stelle Turnhalle Ost' }),
    );
    await userEvent.click(
      within(await offenesMenue()).getByRole('menuitem', { name: /Stornieren/ }),
    );
    const dialog = await dialogMit('Betreuungsstelle Turnhalle Ost stornieren?');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Abbrechen' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(api.storniereStelle).not.toHaveBeenCalled();
  });

  it('Stelle stornieren zeigt „Stattdessen Status setzen“ und öffnet „Stelle bearbeiten“ (LFH-1078)', async () => {
    renderPage();
    await userEvent.click(
      await screen.findByRole('button', { name: 'Aktionen zu Stelle Turnhalle Ost' }),
    );
    await userEvent.click(
      within(await offenesMenue()).getByRole('menuitem', { name: /Stornieren/ }),
    );
    const stelleStorno = await dialogMit('Betreuungsstelle Turnhalle Ost stornieren?');
    await userEvent.click(
      within(stelleStorno).getByRole('button', { name: 'Stattdessen Status setzen' }),
    );
    await dialogUnter('Stelle bearbeiten: Turnhalle Ost');
    expect(api.storniereStelle).not.toHaveBeenCalled();
  });

  // ── Verlauf (LFH-676) ──
  it('Verlauf: Auslöser an jeder Zeile, auch ohne Schreibrecht, Abruf erst beim Aufklappen (LFH-676)', async () => {
    einsatz.wert = { ...einsatz.wert, meine_rolle: 'beobachter' };
    api.ladeBelegungVerlauf.mockResolvedValue([]);
    renderPage();
    const knopf = await screen.findByRole('button', { name: 'Verlauf zu Stelle Turnhalle Ost' });
    expect(
      screen.getByRole('button', { name: 'Verlauf zu Stelle Weserstadion' }),
    ).toBeInTheDocument();
    expect(api.ladeBelegungVerlauf).not.toHaveBeenCalled();
    await userEvent.click(knopf);
    await waitFor(() => expect(api.ladeBelegungVerlauf).toHaveBeenCalledWith(1, 8));
  });

  it('Verlauf einer geschlossenen Stelle: Hinweis statt Auslöser (LFH-676)', async () => {
    api.ladeBetreuung.mockResolvedValue({
      stellen: [{ ...TURNHALLE, status: 'geschlossen' }],
    });
    api.ladeBelegungVerlauf.mockResolvedValue([
      {
        id: 30,
        belegt: 89,
        zeitpunkt_at: '2026-09-23 10:00:00',
        erfasst_at: '2026-09-23 10:00:00',
        erfasst_von: 'Leitung',
        aktuell: true,
      },
    ]);
    renderPage();
    await userEvent.click(
      await screen.findByRole('button', { name: 'Verlauf zu Stelle Turnhalle Ost' }),
    );
    expect(
      await screen.findByText('Stelle geschlossen: Zurücknehmen gesperrt'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /zurücknehmen$/ })).toBeNull();
  });

  describe('Dialoge rechnen gegen die aktuellen Daten (LFH-681)', () => {
    /** Ein Live-Refetch bei offenem Dialog: der Cache trägt den neuen Serverstand. */
    const liveStand = (client: QueryClient, daten: BetreuungUebersicht) =>
      act(() => {
        client.setQueryData(einsatzKeys.betreuung(1), daten);
      });

    it('seit dem Öffnen belegt: der Dialog bietet die Leermeldung an, statt am 422 zu scheitern', async () => {
      api.meldeBelegung.mockResolvedValue({ meldung_id: 92, stelle: SCHULE });
      api.aendereStelle.mockResolvedValue({ ...SCHULE, status: 'geschlossen' });
      const { client } = renderPage();
      await userEvent.click(
        await screen.findByRole('button', { name: 'Aktionen zu Stelle Schule Nord' }),
      );
      await userEvent.click(
        within(await offenesMenue()).getByRole('menuitem', { name: /Bearbeiten/ }),
      );
      const dialog = await dialogMit('Stelle bearbeiten: Schule Nord');
      liveStand(client, {
        ...MIT_DATEN,
        stellen: [
          TURNHALLE,
          STADION,
          { ...SCHULE, belegung: { id: 40, belegt: 12, zeitpunkt_at: '2026-09-23 11:00:00' } },
        ],
      });
      await userEvent.click(
        within(dialog).getByRole('radio', { name: 'geschlossen' }).closest('label')!,
      );
      await userEvent.click(
        await within(dialog).findByRole('checkbox', { name: /Belegung 0 melden/ }),
      );
      await userEvent.click(within(dialog).getByRole('button', { name: 'Speichern' }));
      await waitFor(() =>
        expect(api.aendereStelle).toHaveBeenCalledWith(1, 10, { status: 'geschlossen' }),
      );
      expect(api.meldeBelegung).toHaveBeenCalledWith(1, 10, { belegt: 0 });
    });
  });
});
