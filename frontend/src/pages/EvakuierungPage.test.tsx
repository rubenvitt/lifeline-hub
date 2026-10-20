import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App as AntApp } from 'antd';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import EvakuierungPage from './EvakuierungPage';
import { ladeEinsatz } from '../api/einsaetze';
import { AuthProvider } from '../auth/AuthContext';
import { ApiError } from '../api/client';
import { einsatzKeys } from '../api/queryKeys';
import type { EvakuierungUebersicht, Evakuierungsbezirk } from '../api/types';
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
  ladeEvakuierung: vi.fn(),
  legeBezirkAn: vi.fn(),
  aendereBezirk: vi.fn(),
  storniereBezirk: vi.fn(),
  meldeStand: vi.fn(),
  nimmStandZurueck: vi.fn(),
  ladeStandVerlauf: vi.fn(),
}));
vi.mock('../api/evakuierung', () => api);

/**
 * Tausendertrenner, wie `getByText` ihn sieht: die Seite setzt ein schmales geschütztes Leerzeichen
 * (U+202F, gepinnt in `betreuungText.test.ts`), der Normalisierer von Testing Library faltet jedes
 * `\s` des Knotentextes zu einem Leerzeichen — der Suchtext nicht.
 */
const T = ' ';

const bezirk = (over: Partial<Evakuierungsbezirk> & { id: number }): Evakuierungsbezirk => ({
  einsatz_id: 1,
  bezeichnung: `Bezirk ${over.id}`,
  plan_personen: 640,
  plan_erhebung: 'geschaetzt',
  raeumung: 'angeordnet',
  flaechen: 0,
  angelegt_at: '2026-09-23 08:00:00',
  ...over,
});

const UFER = bezirk({
  id: 5,
  bezeichnung: 'Uferstraße 12–40',
  raeumung: 'laeuft',
  abschnitt_id: 3,
  abschnitt_name: 'Deichwache Nord',
  // Die AKTUELLE Meldung trägt id 55 — die gerade gemeldete (77) ist eine andere.
  stand: { id: 55, evakuiert: 480, erhebung: 'gezaehlt', zeitpunkt_at: '2026-09-23 10:15:00' },
});
const HAFEN = bezirk({
  id: 6,
  bezeichnung: 'Hafenviertel',
  plan_personen: 1210,
  plan_erhebung: 'gezaehlt',
});

const MIT_DATEN: EvakuierungUebersicht = { bezirke: [UFER, HAFEN] };

/**
 * Angemeldet als Benutzer 1: Standmeldungen laufen über die Offline-Queue, und die gehört einem
 * Benutzer.
 */
const BENUTZER_ID = 1;

function renderPage(pfad = '/einsaetze/1/evakuierung') {
  server.use(meHandler(benutzerFixture({ id: BENUTZER_ID, anzeigename: 'Leitung' })));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const ergebnis = render(
    <QueryClientProvider client={client}>
      <AntApp>
        <AuthProvider>
          <MemoryRouter initialEntries={[pfad]}>
            <Routes>
              <Route path="/einsaetze/:id/evakuierung" element={<EvakuierungPage />} />
              <Route path="/einsaetze/:id/lagekarte" element={<LagekarteSonde />} />
            </Routes>
          </MemoryRouter>
        </AuthProvider>
      </AntApp>
    </QueryClientProvider>,
  );
  return { ...ergebnis, client };
}

/** Ziel des Sprungs „Auf Karte zeigen": zeigt die angesteuerte Adresse. */
function LagekarteSonde() {
  const ort = useLocation();
  return <div data-testid="lagekarte-ziel">{ort.pathname + ort.search}</div>;
}

/**
 * Einsatz-Abrufe seit dem ersten. Eine Bezirksänderung kann den Auslöser der Lagekennzahl
 * `evakuiert` kippen und muss den Einsatz neu abrufen lassen.
 */
async function einsatzAbrufeNach(aktion: () => Promise<void>): Promise<() => number> {
  await waitFor(() => expect(vi.mocked(ladeEinsatz)).toHaveBeenCalled());
  const vorher = vi.mocked(ladeEinsatz).mock.calls.length;
  await aktion();
  return () => vi.mocked(ladeEinsatz).mock.calls.length - vorher;
}

const zeileVon = (titel: string) => screen.getByText(titel).closest('tr') as HTMLElement;
const band = () => screen.getByRole('group', { name: 'Räumung in Zahlen' });

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
    const offen = document.querySelectorAll(
      '.ant-dropdown:not(.ant-dropdown-hidden) [role="menu"]',
    );
    expect(offen.length).toBeGreaterThan(0);
    return offen[offen.length - 1] as HTMLElement;
  });
}

async function meldeStand(evakuiert: string) {
  await userEvent.click(
    await screen.findByRole('button', { name: 'Stand melden für Bezirk Uferstraße 12–40' }),
  );
  const dialog = await dialogMit('Stand melden: Uferstraße 12–40');
  await userEvent.type(within(dialog).getByLabelText('Evakuiert gesamt (Personen)'), evakuiert);
  await userEvent.click(within(dialog).getByRole('button', { name: 'Melden' }));
}

describe('EvakuierungPage (LLH-1034)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    einsatz.wert = {
      id: 1,
      bezeichnung: 'Hochwasser',
      status: 'aktiv',
      meine_rolle: 'einsatzleitung',
    };
    api.ladeEvakuierung.mockResolvedValue(MIT_DATEN);
    freigaben.wert = freigabenFixture();
  });

  it('Leerzustand: die Tabelle sagt, dass nichts da ist; kein Kennzahlenband aus Nullen', async () => {
    api.ladeEvakuierung.mockResolvedValue({ bezirke: [] });
    renderPage();
    expect(await screen.findByText(/Keine Evakuierungsbezirke/)).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Räumung in Zahlen' })).toBeNull();
    expect(screen.getByText('0 Bezirke')).toBeInTheDocument();
  });

  it('ein Abruffehler ist kein Leerzustand', async () => {
    api.ladeEvakuierung.mockRejectedValue(new Error('500'));
    renderPage();
    expect(await screen.findByText('Evakuierung konnte nicht geladen werden')).toBeInTheDocument();
    expect(screen.queryByText(/Keine Evakuierungsbezirke/)).toBeNull();
    expect(screen.queryByRole('group', { name: 'Räumung in Zahlen' })).toBeNull();
  });

  it('Tabelle: Zeile je Bezirk mit Status, „N · von M geplant", ≈ und „keine Meldung"', async () => {
    renderPage();
    await screen.findByText('Uferstraße 12–40');
    // Tabelle in jeder Breite: verglichen wird über Bezirke hinweg.
    expect(zeileVon('Uferstraße 12–40').closest('.ant-table')).not.toBeNull();
    const ufer = zeileVon('Uferstraße 12–40');
    expect(within(ufer).getByText('läuft')).toBeInTheDocument();
    expect(within(ufer).getByText('480 · von ≈ 640 geplant')).toBeInTheDocument();
    // Der Balken trägt denselben Wortlaut als Namen (zweiter Kanal, nie Farbe allein).
    expect(
      within(ufer).getByRole('img', { name: 'Bezirk Uferstraße 12–40: 480 · von ≈ 640 geplant' }),
    ).toBeInTheDocument();
    const hafen = zeileVon('Hafenviertel');
    expect(within(hafen).getByText(`keine Meldung · von 1${T}210 geplant`)).toBeInTheDocument();
    expect(within(hafen).queryByRole('img')).toBeNull();
    expect(within(hafen).getByText('keine')).toBeInTheDocument();
  });

  it('Kennzahlenband: Evakuiert, Geplant (≈), Räumung läuft, Geräumt, Ohne Meldung', async () => {
    renderPage();
    await screen.findByText('Uferstraße 12–40');
    const zellen = band();
    expect(zellen).toHaveTextContent('Evakuiert');
    expect(zellen).toHaveTextContent('480');
    expect(zellen).toHaveTextContent(`≈ 1 850`);
    expect(zellen).toHaveTextContent('in 2 Bezirken');
    expect(zellen).toHaveTextContent('Räumung läuft');
    expect(zellen).toHaveTextContent('1 angeordnet');
    expect(zellen).toHaveTextContent('Geräumt');
    expect(zellen).toHaveTextContent('Ohne Meldung');
  });

  it('Kennzahlenband ohne jede Standmeldung: „—" statt 0 bei „Evakuiert"', async () => {
    api.ladeEvakuierung.mockResolvedValue({ bezirke: [HAFEN] });
    renderPage();
    await screen.findByText('Hafenviertel');
    expect(band()).toHaveTextContent('—');
    expect(band()).toHaveTextContent('keine Meldung');
  });

  it('Seitenkopf: Zahl der Bezirke, genau EINE Primäraktion „Evakuierungsbezirk anlegen"', async () => {
    renderPage();
    await screen.findByText('Uferstraße 12–40');
    expect(screen.getByText('2 Bezirke')).toBeInTheDocument();
    const kopf = document.querySelector('[data-lfh="seitenkopf-aktionen"]') as HTMLElement;
    const primaer = [...kopf.querySelectorAll('button')].filter((b) =>
      b.className.includes('-btn-primary'),
    );
    expect(primaer).toHaveLength(1);
    expect(primaer[0]).toHaveAccessibleName('Evakuierungsbezirk anlegen');
    // Die Stellen gehören zur Betreuung, nicht hierher.
    expect(screen.queryByRole('button', { name: 'Betreuungsstelle anlegen' })).toBeNull();
  });

  it('Beobachter: Hinweis mit Grund, Primäraktion gesperrt — Zeilenaktionen entfallen', async () => {
    einsatz.wert = { ...einsatz.wert, meine_rolle: 'beobachter' };
    renderPage();
    await screen.findByText('Uferstraße 12–40');
    expect(screen.getByText('nur Einsatzleitung und Führungspersonal')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Evakuierungsbezirk anlegen' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: /^Stand melden/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Aktionen zu/ })).toBeNull();
  });

  it('mit Schreibrecht tragen die Zeilenaktionen die Zeilenkennung', async () => {
    renderPage();
    await screen.findByText('Uferstraße 12–40');
    expect(
      screen.getByRole('button', { name: 'Stand melden für Bezirk Uferstraße 12–40' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Aktionen zu Bezirk Uferstraße 12–40' }),
    ).toBeInTheDocument();
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

    it('?bezirk=<id> hebt die Zeile hervor und scrollt zu ihr', async () => {
      renderPage('/einsaetze/1/evakuierung?bezirk=6');
      await screen.findByText('Hafenviertel');
      await waitFor(() => expect(zeileVon('Hafenviertel')).toHaveClass('zeile-hervorgehoben'));
      expect(zeileVon('Uferstraße 12–40')).not.toHaveClass('zeile-hervorgehoben');
      await waitFor(() => expect(gescrollt).toContain(zeileVon('Hafenviertel')));
    });

    it('ein unbekannter Bezirk hebt nichts hervor', async () => {
      renderPage('/einsaetze/1/evakuierung?bezirk=99');
      await screen.findByText('Hafenviertel');
      expect(document.querySelector('.zeile-hervorgehoben')).toBeNull();
    });
  });

  describe('Rückgängig nach dem Melden', () => {
    it('„Rückgängig" nimmt die GERADE gemeldete Standmeldung zurück, nicht die aktuelle', async () => {
      api.meldeStand.mockResolvedValue({ meldung_id: 77, bezirk: UFER });
      api.nimmStandZurueck.mockResolvedValue({ meldung_id: 77, bezirk: UFER });
      renderPage();
      const neu = await einsatzAbrufeNach(async () => {
        await meldeStand('500');
        await waitFor(() =>
          expect(api.meldeStand).toHaveBeenCalledWith(
            1,
            5,
            { evakuiert: 500, erhebung: 'gezaehlt', client_id: expect.any(String) },
            { offlineQueueBenutzerId: BENUTZER_ID },
          ),
        );
        await userEvent.click(await screen.findByRole('button', { name: /Rückgängig/ }));
        await waitFor(() => expect(api.nimmStandZurueck).toHaveBeenCalledWith(1, 77));
      });
      expect(api.nimmStandZurueck).not.toHaveBeenCalledWith(1, 55);
      // Eine Standmeldung ist ein Messwert, keine Entscheidung — der Einsatz bleibt.
      expect(neu()).toBe(0);
    });
  });

  describe('Melden ohne Verbindung (LFH-705)', () => {
    afterEach(async () => {
      setzeOnline(true);
      await queueLeerenFuerTests();
    });

    it('offline: Standmeldung wird vorgemerkt — Hinweis statt Rückgängig, Dialog schließt', async () => {
      await queueLeerenFuerTests();
      renderPage();
      const melden = await screen.findByRole('button', {
        name: 'Stand melden für Bezirk Uferstraße 12–40',
      });
      // Online geladen, dann fällt das Netz weg: so liegt es im Einsatz.
      setzeOnline(false);
      await userEvent.click(melden);
      const dialog = await dialogMit('Stand melden: Uferstraße 12–40');
      await userEvent.type(within(dialog).getByLabelText('Evakuiert gesamt (Personen)'), '200');
      await userEvent.click(within(dialog).getByRole('button', { name: 'Melden' }));

      expect(await screen.findByText(/Offline vorgemerkt: Standmeldung/)).toBeInTheDocument();
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      expect(screen.queryByRole('button', { name: /Rückgängig/ })).toBeNull();
      expect(api.meldeStand).not.toHaveBeenCalled();
      const [zeile] = await schreibaktionenLaden(BENUTZER_ID, 1);
      expect(zeile.aktion).toMatchObject({
        art: 'stand',
        bezirk_id: 5,
        bezeichnung: 'Uferstraße 12–40',
        daten: { evakuiert: 200, zeitpunkt_at: expect.any(String) },
      });
    });

    it('online: gesendet ohne Zeitpunkt — die Serveruhr gilt, Rückgängig bleibt', async () => {
      api.meldeStand.mockResolvedValue({ meldung_id: 77, bezirk: UFER });
      renderPage();
      await meldeStand('500');
      expect(await screen.findByRole('button', { name: /Rückgängig/ })).toBeInTheDocument();
      expect(api.meldeStand.mock.calls[0][2]).not.toHaveProperty('zeitpunkt_at');
      expect(screen.queryByText(/Offline vorgemerkt/)).toBeNull();
    });
  });

  describe('Fehler einer Rücknahme (C10/H14)', () => {
    const TITEL = 'Meldung konnte nicht zurückgenommen werden';

    beforeEach(() => {
      api.meldeStand.mockResolvedValue({ meldung_id: 77, bezirk: UFER });
      api.nimmStandZurueck.mockRejectedValue(new ApiError(422, 'Stand-Rücknahme abgelehnt'));
    });

    it('steht über der Seite und verschwindet mit der nächsten Meldung', async () => {
      renderPage();
      await meldeStand('500');
      await userEvent.click(await screen.findByRole('button', { name: /Rückgängig/ }));
      await waitFor(() => expect(api.nimmStandZurueck).toHaveBeenCalledWith(1, 77));
      expect(await screen.findByText('Stand-Rücknahme abgelehnt')).toBeInTheDocument();
      expect(screen.getByText(TITEL)).toBeInTheDocument();
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

      await meldeStand('510');
      await waitFor(() => expect(screen.queryByText(TITEL)).toBeNull());
      expect(screen.queryByText('Stand-Rücknahme abgelehnt')).toBeNull();
    });
  });

  it('gesperrte Lagekarte: „Auf Karte zeigen" am Bezirk steht gesperrt mit Grund (LFH-888)', async () => {
    freigaben.wert = freigabenFixture({ lagekarte: { zugriff: false } });
    api.ladeEvakuierung.mockResolvedValue({ bezirke: [{ ...UFER, flaechen: 2 }] });
    const { client } = renderPage();
    await waitFor(() => expect(client.getQueryData(einsatzKeys.modulFreigaben(1))).toBeDefined());
    await userEvent.click(
      await screen.findByRole('button', { name: 'Aktionen zu Bezirk Uferstraße 12–40' }),
    );
    const eintrag = within(await offenesMenue()).getByRole('menuitem', {
      name: /Auf Karte zeigen \(Keine Berechtigung\)/,
    });
    expect(eintrag).toHaveAttribute('aria-disabled', 'true');
  });

  it('„Auf Karte zeigen" am Bezirk mit Fläche führt zur Fläche (LFH-673)', async () => {
    api.ladeEvakuierung.mockResolvedValue({ bezirke: [{ ...UFER, flaechen: 2 }, HAFEN] });
    renderPage();
    // Ohne Fläche: kein Eintrag.
    await userEvent.click(
      await screen.findByRole('button', { name: 'Aktionen zu Bezirk Hafenviertel' }),
    );
    expect(
      within(await offenesMenue()).queryByRole('menuitem', { name: /Auf Karte zeigen/ }),
    ).toBeNull();
    await userEvent.keyboard('{Escape}');
    await userEvent.click(
      screen.getByRole('button', { name: 'Aktionen zu Bezirk Uferstraße 12–40' }),
    );
    // Das Menü des ersten Bezirks steht noch im Baum; `offenesMenue` nimmt das zuletzt geöffnete.
    await waitFor(async () =>
      expect(
        within(await offenesMenue()).getByRole('menuitem', { name: /Auf Karte zeigen/ }),
      ).toBeTruthy(),
    );
    await userEvent.click(
      within(await offenesMenue()).getByRole('menuitem', { name: /Auf Karte zeigen/ }),
    );
    expect(await screen.findByTestId('lagekarte-ziel')).toHaveTextContent(
      '/einsaetze/1/lagekarte?evakuierungsbezirk=5',
    );
  });

  it('ohne Schreibrecht: am Bezirk mit Fläche nur „Auf Karte zeigen", ohne Fläche kein Menü (LFH-673)', async () => {
    einsatz.wert = { ...einsatz.wert, meine_rolle: 'beobachter' };
    api.ladeEvakuierung.mockResolvedValue({ bezirke: [{ ...UFER, flaechen: 1 }, HAFEN] });
    renderPage();
    await screen.findByText('Hafenviertel');
    expect(screen.queryByRole('button', { name: 'Aktionen zu Bezirk Hafenviertel' })).toBeNull();
    await userEvent.click(
      screen.getByRole('button', { name: 'Aktionen zu Bezirk Uferstraße 12–40' }),
    );
    const menue = await offenesMenue();
    expect(
      within(menue)
        .getAllByRole('menuitem')
        .map((m) => m.textContent),
    ).toEqual(['Auf Karte zeigen']);
  });

  it('Stornieren über das Menü: eigener Dialog mit rotem Knopf, dann POST', async () => {
    api.storniereBezirk.mockResolvedValue({ ...UFER, storniert_at: '2026-09-23 11:00:00' });
    renderPage();
    await userEvent.click(
      await screen.findByRole('button', { name: 'Aktionen zu Bezirk Uferstraße 12–40' }),
    );
    await userEvent.click(
      within(await offenesMenue()).getByRole('menuitem', { name: /Stornieren/ }),
    );
    const dialog = await dialogMit('Bezirk Uferstraße 12–40 stornieren?');
    const ok = within(dialog).getByRole('button', { name: 'Stornieren' });
    expect(ok).toHaveClass('ant-btn-dangerous');
    const neu = await einsatzAbrufeNach(async () => {
      await userEvent.click(ok);
      await waitFor(() => expect(api.storniereBezirk).toHaveBeenCalledWith(1, 5));
    });
    expect(await screen.findByText('Bezirk Uferstraße 12–40 storniert')).toBeInTheDocument();
    // Stornieren kann die Lagekennzahl `evakuiert` wegnehmen.
    await waitFor(() => expect(neu()).toBeGreaterThan(0));
  });

  it('Bezirk stornieren zeigt „Stattdessen Räumung setzen“ und öffnet den Räumungsdialog (LFH-1078)', async () => {
    renderPage();
    await userEvent.click(
      await screen.findByRole('button', { name: 'Aktionen zu Bezirk Uferstraße 12–40' }),
    );
    await userEvent.click(
      within(await offenesMenue()).getByRole('menuitem', { name: /Stornieren/ }),
    );
    const storno = await dialogMit('Bezirk Uferstraße 12–40 stornieren?');
    await userEvent.click(
      within(storno).getByRole('button', { name: 'Stattdessen Räumung setzen' }),
    );
    await dialogUnter('Räumung: Uferstraße 12–40');
    expect(api.storniereBezirk).not.toHaveBeenCalled();
  });

  it('Bezirk anlegen aus dem Kopf: Dialog, POST mit den Feldern, Einsatz neu', async () => {
    api.legeBezirkAn.mockResolvedValue(bezirk({ id: 11, bezeichnung: 'Deichweg 1–9' }));
    renderPage();
    await screen.findByText('Uferstraße 12–40');
    await userEvent.click(screen.getByRole('button', { name: 'Evakuierungsbezirk anlegen' }));
    const dialog = await dialogMit('Evakuierungsbezirk anlegen');
    await userEvent.type(within(dialog).getByLabelText('Bezeichnung'), 'Deichweg 1–9');
    await userEvent.type(within(dialog).getByLabelText('Plangröße (Personen)'), '120');
    const neu = await einsatzAbrufeNach(async () => {
      await userEvent.click(within(dialog).getByRole('button', { name: 'Anlegen' }));
      await waitFor(() =>
        expect(api.legeBezirkAn).toHaveBeenCalledWith(1, {
          bezeichnung: 'Deichweg 1–9',
          plan_personen: 120,
          plan_erhebung: 'geschaetzt',
        }),
      );
    });
    expect(await screen.findByText('Evakuierungsbezirk Deichweg 1–9 angelegt')).toBeInTheDocument();
    // Anlegen ist die Anordnung — der Einsatz trägt danach `evakuiert`.
    await waitFor(() => expect(neu()).toBeGreaterThan(0));
  });

  it('Menü „Plangröße fortschreiben": Bearbeiten-Dialog, PATCH nur mit der neuen Plangröße (LFH-682)', async () => {
    api.aendereBezirk.mockResolvedValue({ ...UFER, plan_personen: 820 });
    renderPage();
    await userEvent.click(
      await screen.findByRole('button', { name: 'Aktionen zu Bezirk Uferstraße 12–40' }),
    );
    await userEvent.click(
      within(await offenesMenue()).getByRole('menuitem', { name: /Plangröße fortschreiben/ }),
    );
    const dialog = await dialogMit('Bezirk bearbeiten: Uferstraße 12–40');
    const feld = within(dialog).getByLabelText('Plangröße (Personen)');
    expect(feld).toHaveValue('640');
    await userEvent.clear(feld);
    await userEvent.type(feld, '820');
    const abrufeVorher = api.ladeEvakuierung.mock.calls.length;
    const neu = await einsatzAbrufeNach(async () => {
      await userEvent.click(within(dialog).getByRole('button', { name: 'Speichern' }));
      await waitFor(() =>
        expect(api.aendereBezirk).toHaveBeenCalledWith(1, 5, { plan_personen: 820 }),
      );
    });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(await screen.findByText('Bezirk Uferstraße 12–40 gespeichert')).toBeInTheDocument();
    await waitFor(() =>
      expect(api.ladeEvakuierung.mock.calls.length).toBeGreaterThan(abrufeVorher),
    );
    // Jede Bezirksänderung fragt den Einsatz neu, auch die Plangröße.
    await waitFor(() => expect(neu()).toBeGreaterThan(0));
  });

  it('Menü „Räumung setzen" öffnet den Räumungsdialog und schickt den neuen Zustand', async () => {
    api.aendereBezirk.mockResolvedValue({ ...UFER, raeumung: 'geraeumt' });
    renderPage();
    await userEvent.click(
      await screen.findByRole('button', { name: 'Aktionen zu Bezirk Uferstraße 12–40' }),
    );
    await userEvent.click(
      within(await offenesMenue()).getByRole('menuitem', { name: /Räumung setzen/ }),
    );
    const dialog = await dialogMit('Räumung: Uferstraße 12–40');
    await userEvent.click(within(dialog).getByRole('radio', { name: 'geräumt' }).closest('label')!);
    const neu = await einsatzAbrufeNach(async () => {
      await userEvent.click(within(dialog).getByRole('button', { name: 'Speichern' }));
      await waitFor(() =>
        expect(api.aendereBezirk).toHaveBeenCalledWith(1, 5, { raeumung: 'geraeumt' }),
      );
    });
    // „aufgehoben" nähme die Lagekennzahl weg; jede Bezirksänderung fragt nach.
    await waitFor(() => expect(neu()).toBeGreaterThan(0));
  });

  it('Verlauf: Auslöser an jeder Zeile, auch ohne Schreibrecht, Abruf erst beim Aufklappen (LFH-676)', async () => {
    einsatz.wert = { ...einsatz.wert, meine_rolle: 'beobachter' };
    api.ladeStandVerlauf.mockResolvedValue([
      {
        id: 55,
        evakuiert: 480,
        erhebung: 'gezaehlt',
        zeitpunkt_at: '2026-09-23 10:15:00',
        erfasst_at: '2026-09-23 10:15:00',
        erfasst_von: 'Leitung',
        aktuell: true,
      },
    ]);
    renderPage();
    const knopf = await screen.findByRole('button', {
      name: 'Verlauf zu Bezirk Uferstraße 12–40',
    });
    expect(
      screen.getByRole('button', { name: 'Verlauf zu Bezirk Hafenviertel' }),
    ).toBeInTheDocument();
    expect(api.ladeStandVerlauf).not.toHaveBeenCalled();

    await userEvent.click(knopf);
    expect(await screen.findByText('480 evakuiert (gezählt)')).toBeInTheDocument();
    expect(api.ladeStandVerlauf).toHaveBeenCalledWith(1, 5);
    // Ohne Schreibrecht kein Auslöser „Zurücknehmen".
    expect(screen.queryByRole('button', { name: /zurücknehmen$/ })).toBeNull();
  });

  it('Räumung: der Dialog rechnet gegen den Live-Stand, zurück auf den alten geht als PATCH raus (LFH-681)', async () => {
    api.aendereBezirk.mockResolvedValue(UFER);
    const { client } = renderPage();
    await userEvent.click(
      await screen.findByRole('button', { name: 'Aktionen zu Bezirk Uferstraße 12–40' }),
    );
    await userEvent.click(
      within(await offenesMenue()).getByRole('menuitem', { name: /Räumung setzen/ }),
    );
    const dialog = await dialogMit('Räumung: Uferstraße 12–40');
    // Fremd auf „geräumt" gesetzt: der Dialog zeigt es, die Person wählt zurück auf „läuft".
    act(() => {
      client.setQueryData<EvakuierungUebersicht>(einsatzKeys.evakuierung(1), {
        bezirke: [{ ...UFER, raeumung: 'geraeumt' }, HAFEN],
      });
    });
    await waitFor(() =>
      expect(within(dialog).getByRole('radio', { name: 'geräumt' })).toBeChecked(),
    );
    await userEvent.click(within(dialog).getByRole('radio', { name: 'läuft' }).closest('label')!);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Speichern' }));
    await waitFor(() =>
      expect(api.aendereBezirk).toHaveBeenCalledWith(1, 5, { raeumung: 'laeuft' }),
    );
  });
});
