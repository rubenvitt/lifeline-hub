import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App as AntApp } from 'antd';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import BetreuungPage from './BetreuungPage';
import { ladeEinsatz } from '../api/einsaetze';
import { AuthProvider } from '../auth/AuthContext';
import { ApiError } from '../api/client';
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
  flaechen: 0,
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
              <Route path="/einsaetze/:id/lagekarte" element={<LagekarteSonde />} />
            </Routes>
          </MemoryRouter>
        </AuthProvider>
      </AntApp>
    </QueryClientProvider>,
  );
}

/** Ziel des Sprungs „Auf Karte verorten" (LFH-673): zeigt die angesteuerte Adresse. */
function LagekarteSonde() {
  const ort = useLocation();
  return <div data-testid="lagekarte-ziel">{ort.pathname + ort.search}</div>;
}

/**
 * Einsatz-Abrufe seit dem ersten (LFH-607). Eine Bezirksänderung kann den Auslöser der
 * Lagekennzahl `evakuiert` kippen — sie muss den Einsatz neu abrufen lassen, sonst sähe die
 * festlegende Person den neuen Zuschnitt des Lage-Dashboards erst beim nächsten Fokus.
 */
async function einsatzAbrufeNach(aktion: () => Promise<void>): Promise<() => number> {
  await waitFor(() => expect(vi.mocked(ladeEinsatz)).toHaveBeenCalled());
  const vorher = vi.mocked(ladeEinsatz).mock.calls.length;
  await aktion();
  return () => vi.mocked(ladeEinsatz).mock.calls.length - vorher;
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
      expect(within(turnhalle).getByText('· davon namentlich 2')).toBeInTheDocument();
      expect(within(zeileVon('Schule Nord')).getByText('· namentlich 3')).toBeInTheDocument();
      // Stelle ohne Eintrag in der Liste: 0 → kein Text.
      expect(within(zeileVon('Weserstadion')).queryByText(/namentlich/)).toBeNull();
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
    // Spec (Kopfzahl): „nichts gemeldet" ist nicht „niemand in Betreuung".
    api.ladeBetreuung.mockResolvedValue({
      bezirke: [],
      stellen: [SCHULE, stelle({ id: 11, bezeichnung: 'Halle West' })],
    });
    renderPage();
    await screen.findByText('Halle West');
    expect(screen.getByText('keine Meldung · 2 ohne Meldung')).toBeInTheDocument();
    expect(screen.queryByText(/0 untergebracht/)).toBeNull();
  });

  it('volle Stellen im Blickfeld: „n voll" im Seitenkopf und im Blockkopf, „fast voll" zählt nicht (LFH-678)', async () => {
    api.ladeBetreuung.mockResolvedValue({
      bezirke: [UFER],
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
    // Seitenkopf: die einzige Zeile, die auch mit vielen Bezirkskarten über der Falz steht.
    expect(screen.getByText('1 Bezirk · 5 Betreuungsstellen · 2 voll')).toBeInTheDocument();
    // Blockkopf: dieselbe Zahl neben der Summe.
    expect(screen.getByText('361 untergebracht · 2 voll · 1 ohne Meldung')).toBeInTheDocument();
    // Die Zeilen tragen weiter ihr eigenes Wort — der Kopf fasst nur zusammen.
    expect(within(zeileVon('Halle Süd')).getByText('voll')).toBeInTheDocument();
    expect(within(zeileVon('Gemeindehaus')).getByText('überbelegt')).toBeInTheDocument();
  });

  it('ohne volle Stelle kein „0 voll" — weder im Seitenkopf noch im Blockkopf (LFH-678)', async () => {
    renderPage();
    await screen.findByText('Turnhalle Ost');
    expect(screen.getByText('2 Bezirke · 3 Betreuungsstellen')).toBeInTheDocument();
    expect(screen.queryByText(/\bvoll\b.*·|· \d+ voll/)).toBeNull();
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
      const neu = await einsatzAbrufeNach(async () => {
        await userEvent.click(within(dialog).getByRole('button', { name: 'Melden' }));
        await waitFor(() =>
          expect(api.meldeStand).toHaveBeenCalledWith(1, 5, {
            evakuiert: 500,
            erhebung: 'gezaehlt',
          }),
        );
        await userEvent.click(await screen.findByRole('button', { name: /Rückgängig/ }));
        await waitFor(() => expect(api.nimmStandZurueck).toHaveBeenCalledWith(1, 77));
      });
      expect(api.nimmStandZurueck).not.toHaveBeenCalledWith(1, 55);
      // LFH-607: eine Standmeldung ist ein Messwert, keine Entscheidung — der Einsatz bleibt.
      expect(neu()).toBe(0);
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

  describe('Fehler einer Rücknahme (C10/H14)', () => {
    const TITEL = 'Meldung konnte nicht zurückgenommen werden';

    async function meldeStandUndNimmZurueck() {
      await userEvent.click(
        await screen.findByRole('button', { name: 'Stand melden für Bezirk Uferstraße 12–40' }),
      );
      const dialog = await dialogMit('Stand melden: Uferstraße 12–40');
      await userEvent.type(within(dialog).getByLabelText('Evakuiert (Personen)'), '500');
      await userEvent.click(within(dialog).getByRole('button', { name: 'Melden' }));
      await userEvent.click(await screen.findByRole('button', { name: /Rückgängig/ }));
      await waitFor(() => expect(api.nimmStandZurueck).toHaveBeenCalledWith(1, 77));
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    }

    async function meldeBelegung() {
      await userEvent.click(
        screen.getByRole('button', { name: 'Belegung melden für Turnhalle Ost' }),
      );
      const dialog = await dialogMit('Belegung melden: Turnhalle Ost');
      await userEvent.type(within(dialog).getByLabelText('Belegt (Personen)'), '95');
      await userEvent.click(within(dialog).getByRole('button', { name: 'Melden' }));
      await waitFor(() => expect(api.meldeBelegung).toHaveBeenCalledWith(1, 8, { belegt: 95 }));
    }

    beforeEach(() => {
      api.meldeStand.mockResolvedValue({ meldung_id: 77, bezirk: UFER });
      api.meldeBelegung.mockResolvedValue({ meldung_id: 91, stelle: TURNHALLE });
      // Zwei VERSCHIEDENE Wortlaute als `ApiError`: mit einem nackten `Error` zeigte der
      // Alert beide Male denselben Rückfalltext, und „der neue Text steht da" wäre trivial.
      api.nimmStandZurueck.mockRejectedValue(new ApiError(422, 'Stand-Rücknahme abgelehnt'));
      api.nimmBelegungZurueck.mockRejectedValue(new ApiError(422, 'Belegungs-Rücknahme abgelehnt'));
    });

    it('eine spätere Ablehnung der anderen Rücknahme wird gezeigt, nicht vom alten Fehler verdeckt', async () => {
      renderPage();
      await meldeStandUndNimmZurueck();
      expect(await screen.findByText('Stand-Rücknahme abgelehnt')).toBeInTheDocument();
      expect(screen.getByText(TITEL)).toBeInTheDocument();

      await meldeBelegung();
      await userEvent.click(await screen.findByRole('button', { name: /Rückgängig/ }));
      await waitFor(() => expect(api.nimmBelegungZurueck).toHaveBeenCalledWith(1, 91));
      expect(await screen.findByText('Belegungs-Rücknahme abgelehnt')).toBeInTheDocument();
      expect(screen.queryByText('Stand-Rücknahme abgelehnt')).toBeNull();
    });

    it('nach einer erfolgreichen Meldung ist der Fehler der Rücknahme weg', async () => {
      renderPage();
      await meldeStandUndNimmZurueck();
      expect(await screen.findByText('Stand-Rücknahme abgelehnt')).toBeInTheDocument();

      await meldeBelegung();
      await waitFor(() => expect(screen.queryByText(TITEL)).toBeNull());
      expect(screen.queryByText('Stand-Rücknahme abgelehnt')).toBeNull();
    });
  });

  it('„Auf Karte verorten" nur an unverorteter Stelle, führt in den Platziermodus (LFH-673)', async () => {
    api.ladeBetreuung.mockResolvedValue({
      bezirke: [],
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
      '/einsaetze/1/lagekarte?platzieren=betreuungsstelle%3A8',
    );
  });

  it('„Auf Karte zeigen" am Bezirk mit Fläche führt zur Fläche (LFH-673)', async () => {
    api.ladeBetreuung.mockResolvedValue({
      bezirke: [{ ...UFER, flaechen: 2 }, HAFEN],
      stellen: [],
    });
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
    await waitFor(() => {
      const offen = document.querySelectorAll(
        '.ant-dropdown:not(.ant-dropdown-hidden) [role="menu"]',
      );
      expect(
        within(offen[offen.length - 1] as HTMLElement).getByRole('menuitem', {
          name: /Auf Karte zeigen/,
        }),
      ).toBeTruthy();
    });
    const offen = document.querySelectorAll(
      '.ant-dropdown:not(.ant-dropdown-hidden) [role="menu"]',
    );
    await userEvent.click(
      within(offen[offen.length - 1] as HTMLElement).getByRole('menuitem', {
        name: /Auf Karte zeigen/,
      }),
    );
    expect(await screen.findByTestId('lagekarte-ziel')).toHaveTextContent(
      '/einsaetze/1/lagekarte?evakuierungsbezirk=5',
    );
  });

  it('ohne Schreibrecht: am Bezirk mit Fläche nur „Auf Karte zeigen", ohne Fläche kein Menü (LFH-673)', async () => {
    einsatz.wert = { ...einsatz.wert, meine_rolle: 'beobachter' };
    api.ladeBetreuung.mockResolvedValue({
      bezirke: [{ ...UFER, flaechen: 1 }, HAFEN],
      stellen: [],
    });
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

  it('ohne Schreibrecht gibt es keinen Einstieg „Auf Karte verorten" (LFH-673)', async () => {
    einsatz.wert = { ...einsatz.wert, meine_rolle: 'beobachter' };
    api.ladeBetreuung.mockResolvedValue({ bezirke: [], stellen: [TURNHALLE] });
    renderPage();
    await screen.findByText('Turnhalle Ost');
    expect(screen.queryByRole('button', { name: 'Aktionen zu Stelle Turnhalle Ost' })).toBeNull();
    expect(screen.queryByText(/Auf Karte verorten/)).toBeNull();
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
    const neu = await einsatzAbrufeNach(async () => {
      await userEvent.click(ok);
      await waitFor(() => expect(api.storniereBezirk).toHaveBeenCalledWith(1, 5));
    });
    // LFH-607: Stornieren kann die Lagekennzahl `evakuiert` wegnehmen.
    await waitFor(() => expect(neu()).toBeGreaterThan(0));
  });

  it('Bezirk anlegen aus dem Kopf: Dialog, POST mit den Feldern', async () => {
    api.legeBezirkAn.mockResolvedValue(bezirk({ id: 11 }));
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
    // LFH-607: Anlegen IST die Anordnung — der Einsatz trägt danach `evakuiert`.
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
    // LFH-607: „aufgehoben" nähme die Lagekennzahl weg; jede Bezirksänderung fragt nach.
    await waitFor(() => expect(neu()).toBeGreaterThan(0));
  });
});
