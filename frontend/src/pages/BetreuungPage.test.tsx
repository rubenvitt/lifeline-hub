import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App as AntApp } from 'antd';
import { MemoryRouter, Route, Routes } from 'react-router';
import BetreuungPage from './BetreuungPage';
import { AuthProvider } from '../auth/AuthContext';
import type { BetreuungUebersicht, Betreuungsstelle, Evakuierungsbezirk } from '../api/types';

const einsatz = vi.hoisted(() => ({
  wert: { id: 1, bezeichnung: 'Hochwasser', status: 'aktiv', meine_rolle: 'einsatzleitung' },
}));
vi.mock('../api/einsaetze', () => ({
  ladeEinsatz: vi.fn(() => Promise.resolve(einsatz.wert)),
}));
vi.mock('../api/einsatzabschnitte', () => ({
  listeAbschnitte: vi.fn().mockResolvedValue([{ id: 3, name: 'Deichwache Nord' }]),
}));

const api = vi.hoisted(() => ({
  ladeBetreuung: vi.fn(),
  legeBezirkAn: vi.fn(),
  aendereBezirk: vi.fn(),
  storniereBezirk: vi.fn(),
  meldeStand: vi.fn(),
  nimmStandZurueck: vi.fn(),
  legeStelleAn: vi.fn(),
  aendereStelle: vi.fn(),
  storniereStelle: vi.fn(),
  meldeBelegung: vi.fn(),
  nimmBelegungZurueck: vi.fn(),
  ladeBelegungKopfzahl: vi.fn(),
}));
vi.mock('../api/betreuung', () => api);

/**
 * Tausendertrenner, wie `getByText` ihn sieht: die Seite setzt ein schmales geschütztes
 * Leerzeichen (U+202F, gepinnt in `betreuungText.test.ts`), der Standard-Normalisierer von
 * Testing Library faltet jedes `\s` des Knotentextes zu einem Leerzeichen — der Suchtext nicht.
 */
const T = ' ';

const bezirk = (over: Partial<Evakuierungsbezirk> & { id: number }): Evakuierungsbezirk => ({
  einsatz_id: 1,
  bezeichnung: `Bezirk ${over.id}`,
  plan_personen: 640,
  plan_erhebung: 'geschaetzt',
  raeumung: 'angeordnet',
  angelegt_at: '2026-09-23 08:00:00',
  ...over,
});

const stelle = (over: Partial<Betreuungsstelle> & { id: number }): Betreuungsstelle => ({
  einsatz_id: 1,
  bezeichnung: `Stelle ${over.id}`,
  art: 'notunterkunft',
  status: 'in_betrieb',
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

const MIT_DATEN: BetreuungUebersicht = {
  bezirke: [UFER, HAFEN],
  stellen: [TURNHALLE, STADION, SCHULE],
};

function renderPage(pfad = '/einsaetze/1/betreuung') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <AntApp>
        <AuthProvider>
          <MemoryRouter initialEntries={[pfad]}>
            <Routes>
              <Route path="/einsaetze/:id/betreuung" element={<BetreuungPage />} />
            </Routes>
          </MemoryRouter>
        </AuthProvider>
      </AntApp>
    </QueryClientProvider>,
  );
}

const karteVon = (titel: string) =>
  screen.getByText(titel).closest('[data-lfh="datensicht-karte"]') as HTMLElement;
const zeileVon = (titel: string) => screen.getByText(titel).closest('tr') as HTMLElement;

/**
 * Der offene Dialog mit diesem Titel. Nicht über `findByRole('dialog', { name })`: in diesem
 * Render ohne `ConfigProvider` vergibt antd ids über `useId` im Testmodus als „test-id", der
 * Name aus `aria-labelledby` zeigt dann auf den ERSTEN Knoten dieser id im Dokument.
 */
async function dialogMit(titel: string): Promise<HTMLElement> {
  const dialog = await screen.findByRole('dialog');
  expect(within(dialog).getByText(titel, { selector: '.ant-modal-title' })).toBeInTheDocument();
  return dialog;
}

/** Das GEÖFFNETE Menü — antd lässt die Portale geschlossener Dropdowns im Baum stehen. */
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
  });

  it('Leerzustand: beide Blöcke sagen, dass nichts da ist', async () => {
    api.ladeBetreuung.mockResolvedValue({ bezirke: [], stellen: [] });
    renderPage();
    expect(await screen.findByText(/Keine Evakuierungsbezirke/)).toBeInTheDocument();
    expect(screen.getByText(/Keine Betreuungsstellen/)).toBeInTheDocument();
    expect(screen.getByText('keine geplante Evakuierung')).toBeInTheDocument();
  });

  it('ein Abruffehler ist kein Leerzustand', async () => {
    api.ladeBetreuung.mockRejectedValue(new Error('500'));
    renderPage();
    expect(await screen.findByText('Betreuung konnte nicht geladen werden')).toBeInTheDocument();
    expect(screen.queryByText(/Keine Evakuierungsbezirke/)).toBeNull();
    expect(screen.queryByText('keine geplante Evakuierung')).toBeNull();
  });

  it('Block Evakuierung: Karte mit Status, „N · von M geplant", ≈ und „keine Meldung"', async () => {
    renderPage();
    await screen.findByText('Uferstraße 12–40');
    const ufer = karteVon('Uferstraße 12–40');
    expect(within(ufer).getByText('läuft')).toBeInTheDocument();
    expect(within(ufer).getByText('480 · von ≈ 640 geplant')).toBeInTheDocument();
    expect(within(ufer).getByText('Deichwache Nord')).toBeInTheDocument();
    const hafen = karteVon('Hafenviertel');
    expect(within(hafen).getByText(`keine Meldung · von 1${T}210 geplant`)).toBeInTheDocument();
    // Blockkopf: die Kennzahl über alle aktiven Bezirke.
    expect(
      screen.getByText(`480 · von 1${T}850 geplant · 1 ohne Meldung`, { exact: false }),
    ).toBeInTheDocument();
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

  it('genau EINE Primäraktion im Kopf; „Betreuungsstelle anlegen" steht sekundär im Block', async () => {
    renderPage();
    await screen.findByText('Uferstraße 12–40');
    const kopf = document.querySelector('[data-lfh="seitenkopf-aktionen"]') as HTMLElement;
    const primaer = [...kopf.querySelectorAll('button')].filter((b) =>
      b.className.includes('-btn-primary'),
    );
    expect(primaer).toHaveLength(1);
    expect(primaer[0]).toHaveAccessibleName('Evakuierungsbezirk anlegen');
    const stelleAnlegen = screen.getByRole('button', { name: 'Betreuungsstelle anlegen' });
    expect(kopf.contains(stelleAnlegen)).toBe(false);
    expect(stelleAnlegen.className).not.toContain('-btn-primary');
  });

  it('Beobachter: Hinweis mit Grund, Primäraktion gesperrt — Zeilenaktionen entfallen', async () => {
    einsatz.wert = { ...einsatz.wert, meine_rolle: 'beobachter' };
    renderPage();
    await screen.findByText('Uferstraße 12–40');
    expect(
      screen.getByText(/Nur Einsatzleitung und Führungspersonal können Bezirke/),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Evakuierungsbezirk anlegen' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Betreuungsstelle anlegen' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: /^Stand melden/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Belegung melden/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Aktionen zu/ })).toBeNull();
  });

  it('Gegenstück mit Schreibrecht: Zeilenaktionen tragen die Zeilenkennung', async () => {
    renderPage();
    await screen.findByText('Uferstraße 12–40');
    expect(
      screen.getByRole('button', { name: 'Stand melden für Bezirk Uferstraße 12–40' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Aktionen zu Bezirk Uferstraße 12–40' }),
    ).toBeInTheDocument();
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

    it('?bezirk=<id> hebt die Karte hervor und scrollt zu ihr', async () => {
      renderPage('/einsaetze/1/betreuung?bezirk=6');
      await screen.findByText('Hafenviertel');
      await waitFor(() => expect(karteVon('Hafenviertel')).toHaveClass('zeile-hervorgehoben'));
      expect(karteVon('Uferstraße 12–40')).not.toHaveClass('zeile-hervorgehoben');
      await waitFor(() => expect(gescrollt).toContain(karteVon('Hafenviertel')));
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
    it('„Rückgängig" nimmt die GERADE gemeldete Standmeldung zurück, nicht die aktuelle', async () => {
      api.meldeStand.mockResolvedValue({ meldung_id: 77, bezirk: UFER });
      api.nimmStandZurueck.mockResolvedValue({ meldung_id: 77, bezirk: UFER });
      renderPage();
      await userEvent.click(
        await screen.findByRole('button', { name: 'Stand melden für Bezirk Uferstraße 12–40' }),
      );
      const dialog = await dialogMit('Stand melden: Uferstraße 12–40');
      await userEvent.type(within(dialog).getByLabelText('Evakuiert (Personen)'), '500');
      await userEvent.click(within(dialog).getByRole('button', { name: 'Melden' }));
      await waitFor(() =>
        expect(api.meldeStand).toHaveBeenCalledWith(1, 5, { evakuiert: 500, erhebung: 'gezaehlt' }),
      );
      await userEvent.click(await screen.findByRole('button', { name: /Rückgängig/ }));
      await waitFor(() => expect(api.nimmStandZurueck).toHaveBeenCalledWith(1, 77));
      expect(api.nimmStandZurueck).not.toHaveBeenCalledWith(1, 55);
    });

    it('eine zweite Meldung ersetzt den stehenden Toast — ein Rückweg, der zur jüngsten gehört', async () => {
      api.meldeStand.mockResolvedValue({ meldung_id: 77, bezirk: UFER });
      api.meldeBelegung.mockResolvedValue({ meldung_id: 91, stelle: TURNHALLE });
      api.nimmBelegungZurueck.mockResolvedValue({ meldung_id: 91, stelle: TURNHALLE });
      renderPage();
      await userEvent.click(
        await screen.findByRole('button', { name: 'Stand melden für Bezirk Uferstraße 12–40' }),
      );
      let dialog = await screen.findByRole('dialog');
      await userEvent.type(within(dialog).getByLabelText('Evakuiert (Personen)'), '500');
      await userEvent.click(within(dialog).getByRole('button', { name: 'Melden' }));
      await screen.findByRole('button', { name: /Rückgängig/ });
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

      await userEvent.click(
        screen.getByRole('button', { name: 'Belegung melden für Turnhalle Ost' }),
      );
      dialog = await dialogMit('Belegung melden: Turnhalle Ost');
      await userEvent.type(within(dialog).getByLabelText('Belegt (Personen)'), '95');
      await userEvent.click(within(dialog).getByRole('button', { name: 'Melden' }));
      await waitFor(() => expect(api.meldeBelegung).toHaveBeenCalledWith(1, 8, { belegt: 95 }));
      await waitFor(() =>
        expect(screen.getByText(/Belegung Turnhalle Ost gemeldet/)).toBeInTheDocument(),
      );
      const rueckwege = screen.getAllByRole('button', { name: /Rückgängig/ });
      expect(rueckwege).toHaveLength(1);
      await userEvent.click(rueckwege[0]);
      await waitFor(() => expect(api.nimmBelegungZurueck).toHaveBeenCalledWith(1, 91));
      expect(api.nimmStandZurueck).not.toHaveBeenCalled();
    });
  });

  it('Stornieren über das Menü: eigener Dialog mit rotem Knopf, dann POST', async () => {
    api.storniereBezirk.mockResolvedValue({ ...UFER, storniert_at: '2026-09-23 11:00:00' });
    renderPage();
    await userEvent.click(
      await screen.findByRole('button', { name: 'Aktionen zu Bezirk Uferstraße 12–40' }),
    );
    const menue = await offenesMenue();
    await userEvent.click(within(menue).getByRole('menuitem', { name: /Stornieren/ }));
    const dialog = await dialogMit('Bezirk Uferstraße 12–40 stornieren?');
    const ok = within(dialog).getByRole('button', { name: 'Stornieren' });
    expect(ok).toHaveClass('ant-btn-dangerous');
    await userEvent.click(ok);
    await waitFor(() => expect(api.storniereBezirk).toHaveBeenCalledWith(1, 5));
  });

  it('Bezirk anlegen aus dem Kopf: Dialog, POST mit den Feldern', async () => {
    api.legeBezirkAn.mockResolvedValue(bezirk({ id: 11 }));
    renderPage();
    await screen.findByText('Uferstraße 12–40');
    await userEvent.click(screen.getByRole('button', { name: 'Evakuierungsbezirk anlegen' }));
    const dialog = await dialogMit('Evakuierungsbezirk anlegen');
    await userEvent.type(within(dialog).getByLabelText('Bezeichnung'), 'Deichweg 1–9');
    await userEvent.type(within(dialog).getByLabelText('Plangröße (Personen)'), '120');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Anlegen' }));
    await waitFor(() =>
      expect(api.legeBezirkAn).toHaveBeenCalledWith(1, {
        bezeichnung: 'Deichweg 1–9',
        plan_personen: 120,
        plan_erhebung: 'geschaetzt',
      }),
    );
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
    await userEvent.click(within(dialog).getByRole('button', { name: 'Speichern' }));
    await waitFor(() =>
      expect(api.aendereBezirk).toHaveBeenCalledWith(1, 5, { raeumung: 'geraeumt' }),
    );
  });
});
