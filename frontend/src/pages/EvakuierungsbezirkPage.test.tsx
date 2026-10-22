import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router';
import EvakuierungsbezirkPage from './EvakuierungsbezirkPage';
import { einsatzKeys } from '../api/queryKeys';
import type { EvakuierungUebersicht, Evakuierungsbezirk, LageZone } from '../api/types';
import { http, HttpResponse } from 'msw';
import { meHandler, server } from '../test/server';
import { benutzerFixture, freigabenFixture } from '../test/fixtures';
import { renderMitProviders } from '../test/utils';

const einsatz = vi.hoisted(() => ({
  wert: { id: 1, bezeichnung: 'Hochwasser', status: 'aktiv', meine_rolle: 'einsatzleitung' },
}));
const freigaben = vi.hoisted(() => ({ wert: undefined as unknown }));
vi.mock('../api/einsaetze', () => ({
  ladeEinsatz: vi.fn(() => Promise.resolve(einsatz.wert)),
  ladeModulFreigaben: vi.fn(() => Promise.resolve(freigaben.wert)),
}));
vi.mock('../api/einsatzabschnitte', () => ({
  listeAbschnitte: vi.fn().mockResolvedValue([{ id: 3, name: 'Deichwache Nord' }]),
}));
const zonenApi = vi.hoisted(() => ({ listeZonen: vi.fn() }));
vi.mock('../api/lagezonen', () => zonenApi);
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
// MapLibre bleibt draußen: das Kartenbild ist hier nur sein zugänglicher Name.
vi.mock('../betreuung/BezirkKartenbild', () => ({
  default: ({ etikett }: { etikett: string }) => <div role="img" aria-label={etikett} />,
}));
vi.mock('../anzeige/Kartenausschnitt', () => ({
  Kartenausschnitt: ({
    punkt,
    etikett,
  }: {
    punkt: { lat: number; lon: number } | null;
    etikett: string;
  }) => (
    <div role="group" aria-label={`Karte: ${etikett}`}>
      {punkt && `${punkt.lat},${punkt.lon}`}
    </div>
  ),
}));

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
  sammelstelle: 'Turnhalle Süd',
  stand: { id: 55, evakuiert: 480, erhebung: 'gezaehlt', zeitpunkt_at: '2026-09-23 10:15:00' },
});
const HAFEN = bezirk({ id: 6, bezeichnung: 'Hafenviertel', plan_erhebung: 'gezaehlt' });

const ZONE: LageZone = {
  id: 40,
  einsatz_id: 1,
  typ: 'evakuierungsbezirk',
  evakuierungsbezirk_id: 5,
  geometrie_typ: 'Polygon',
  geometrie: JSON.stringify({
    type: 'Polygon',
    coordinates: [
      [
        [8.6, 50.1],
        [8.62, 50.1],
        [8.62, 50.12],
        [8.6, 50.1],
      ],
    ],
  }),
  erstellt_at: '2026-09-23 08:00:00',
  erstellt_von: 1,
  geaendert_at: '2026-09-23 08:00:00',
};

const verlaufEintrag = (id: number, evakuiert: number, zeit: string, aktuell = false) => ({
  id,
  evakuiert,
  erhebung: 'gezaehlt' as const,
  zeitpunkt_at: zeit,
  erfasst_at: zeit,
  erfasst_von: 'Leitung',
  aktuell,
});

function renderSeite(pfad = '/einsaetze/1/evakuierung/5') {
  server.use(meHandler(benutzerFixture({ id: 1, anzeigename: 'Leitung' })));
  return renderMitProviders(
    <Routes>
      <Route path="/einsaetze/:id/evakuierung" element={<div>UEBERSICHT</div>} />
      <Route path="/einsaetze/:id/evakuierung/:bezirkId" element={<EvakuierungsbezirkPage />} />
      <Route path="/einsaetze/:id/lagekarte" element={<div>LAGEKARTE</div>} />
    </Routes>,
    // Data Router: der Verlassen-Schutz der Stammdaten nutzt `useBlocker`.
    { route: pfad, datenRouter: true },
  );
}

const titel = () => screen.findByRole('heading', { name: /Bezirk Uferstraße 12–40/ });

/** Das geöffnete Menü — antd lässt die Portale geschlossener Dropdowns im Baum stehen. */
async function kopfmenue(): Promise<HTMLElement> {
  await userEvent.click(
    await screen.findByRole('button', { name: 'Weitere Aktionen zu Bezirk Uferstraße 12–40' }),
  );
  return waitFor(() => {
    const offen = document.querySelectorAll(
      '.ant-dropdown:not(.ant-dropdown-hidden) [role="menu"]',
    );
    expect(offen.length).toBeGreaterThan(0);
    return offen[offen.length - 1] as HTMLElement;
  });
}

describe('EvakuierungsbezirkPage (LLH-1076)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    einsatz.wert = {
      id: 1,
      bezeichnung: 'Hochwasser',
      status: 'aktiv',
      meine_rolle: 'einsatzleitung',
    };
    freigaben.wert = freigabenFixture();
    api.ladeEvakuierung.mockResolvedValue({
      bezirke: [UFER, HAFEN],
    } satisfies EvakuierungUebersicht);
    api.ladeStandVerlauf.mockResolvedValue([]);
    zonenApi.listeZonen.mockResolvedValue([ZONE]);
  });

  describe('Kopf und Räumung', () => {
    it('Titel mit Zustand, genau EINE Primäraktion „Stand melden", ein Räumungsschritt daneben', async () => {
      renderSeite();
      await titel();
      expect(screen.getByText('läuft')).toBeInTheDocument();
      const kopf = document.querySelector('[data-lfh="seitenkopf-aktionen"]') as HTMLElement;
      const primaer = [...kopf.querySelectorAll('button')].filter((b) =>
        b.className.includes('-btn-primary'),
      );
      expect(primaer).toHaveLength(1);
      expect(primaer[0]).toHaveAccessibleName('Stand melden');
      expect(within(kopf).getByRole('button', { name: 'Als geräumt melden' })).toBeInTheDocument();
      expect(within(kopf).getByRole('button', { name: 'Bearbeiten' })).toBeInTheDocument();
      // Die Brotkrume führt zurück zur Übersicht.
      expect(screen.getByRole('link', { name: 'Evakuierung' })).toHaveAttribute(
        'href',
        '/einsaetze/1/evakuierung',
      );
    });

    it('Menü: Rückweg neutral, „Anordnung aufheben" und „Stornieren" rot hinter dem Trenner', async () => {
      renderSeite();
      const menue = await kopfmenue();
      const eintraege = within(menue).getAllByRole('menuitem');
      expect(eintraege.map((m) => m.textContent)).toEqual([
        'Zurück auf angeordnet',
        'Anordnung aufheben',
        'Stornieren',
      ]);
      expect(eintraege[1]).toHaveClass('ant-dropdown-menu-item-danger');
      expect(eintraege[2]).toHaveClass('ant-dropdown-menu-item-danger');
    });

    it('„Als geräumt melden" schickt den Zustand als PATCH und meldet ihn in Worten', async () => {
      api.aendereBezirk.mockResolvedValue({ ...UFER, raeumung: 'geraeumt' });
      renderSeite();
      await titel();
      await userEvent.click(screen.getByRole('button', { name: 'Als geräumt melden' }));
      await waitFor(() =>
        expect(api.aendereBezirk).toHaveBeenCalledWith(1, 5, { raeumung: 'geraeumt' }),
      );
      expect(await screen.findByText('Räumung Uferstraße 12–40: geräumt')).toBeInTheDocument();
    });

    it('„Anordnung aufheben" fragt zuerst nach, rot; erst die Bestätigung sendet', async () => {
      api.aendereBezirk.mockResolvedValue({ ...UFER, raeumung: 'aufgehoben' });
      renderSeite();
      await userEvent.click(
        within(await kopfmenue()).getByRole('menuitem', { name: 'Anordnung aufheben' }),
      );
      const dialog = await screen.findByRole('dialog', {
        name: 'Anordnung für Bezirk Uferstraße 12–40 aufheben?',
      });
      expect(api.aendereBezirk).not.toHaveBeenCalled();
      const ok = within(dialog).getByRole('button', { name: 'Anordnung aufheben' });
      expect(ok).toHaveClass('ant-btn-dangerous');
      await userEvent.click(ok);
      await waitFor(() =>
        expect(api.aendereBezirk).toHaveBeenCalledWith(1, 5, { raeumung: 'aufgehoben' }),
      );
    });

    it('ein fremd schon gesetzter Zustand geht nicht noch einmal hinaus', async () => {
      const { client } = renderSeite();
      await titel();
      const knopf = screen.getByRole('button', { name: 'Als geräumt melden' });
      // Zwischen Anzeige und Klick hat jemand anders geräumt gemeldet; der Knopf steht noch.
      act(() => {
        client.setQueryData<EvakuierungUebersicht>(einsatzKeys.evakuierung(1), {
          bezirke: [{ ...UFER, raeumung: 'geraeumt' }, HAFEN],
        });
      });
      // Der Kopf folgt dem Live-Stand; der alte Knopf ist weg.
      await waitFor(() => expect(knopf).not.toBeInTheDocument());
      expect(screen.queryByRole('button', { name: 'Als geräumt melden' })).toBeNull();
      expect(api.aendereBezirk).not.toHaveBeenCalled();
    });

    it('„Stand melden" öffnet den Meldedialog dieses Bezirks', async () => {
      api.meldeStand.mockResolvedValue({ meldung_id: 77, bezirk: { ...UFER } });
      renderSeite();
      await titel();
      await userEvent.click(screen.getByRole('button', { name: 'Stand melden' }));
      const dialog = await screen.findByRole('dialog', { name: 'Stand melden: Uferstraße 12–40' });
      await userEvent.type(within(dialog).getByLabelText('Evakuiert gesamt (Personen)'), '500');
      await userEvent.click(within(dialog).getByRole('button', { name: 'Melden' }));
      await waitFor(() =>
        expect(api.meldeStand).toHaveBeenCalledWith(
          1,
          5,
          { evakuiert: 500, erhebung: 'gezaehlt', client_id: expect.any(String) },
          { offlineQueueBenutzerId: 1 },
        ),
      );
    });

    it('Stornieren über das Menü: Rückfrage, POST, danach zurück zur Übersicht', async () => {
      api.storniereBezirk.mockResolvedValue({ ...UFER, storniert_at: '2026-09-23 11:00:00' });
      renderSeite();
      await userEvent.click(
        within(await kopfmenue()).getByRole('menuitem', { name: 'Stornieren' }),
      );
      const dialog = await screen.findByRole('dialog', {
        name: 'Bezirk Uferstraße 12–40 stornieren?',
      });
      // Die Übersicht führt den stornierten Bezirk nicht mehr.
      api.ladeEvakuierung.mockResolvedValue({ bezirke: [HAFEN] });
      await userEvent.click(within(dialog).getByRole('button', { name: 'Stornieren' }));
      await waitFor(() => expect(api.storniereBezirk).toHaveBeenCalledWith(1, 5));
      expect(await screen.findByText('UEBERSICHT')).toBeInTheDocument();
    });
  });

  describe('Kennzahlen', () => {
    it('Evakuiert, Geplant (≈), Anteil mit Balken, letzte Meldung', async () => {
      renderSeite();
      const band = await screen.findByRole('group', { name: 'Bezirk in Zahlen' });
      expect(band).toHaveTextContent('Evakuiert');
      expect(band).toHaveTextContent('480');
      expect(band).toHaveTextContent('≈ 640');
      expect(band).toHaveTextContent('75 %');
      expect(band).toHaveTextContent('Letzte Meldung');
      expect(
        within(band).getByRole('img', {
          name: 'Bezirk Uferstraße 12–40: 75 % der Planung evakuiert',
        }),
      ).toBeInTheDocument();
    });

    it('ohne Meldung: „—" statt 0, kein Balken', async () => {
      renderSeite('/einsaetze/1/evakuierung/6');
      const band = await screen.findByRole('group', { name: 'Bezirk in Zahlen' });
      expect(band).toHaveTextContent('—');
      expect(band).toHaveTextContent('keine Meldung');
      expect(within(band).queryByRole('img')).toBeNull();
    });
  });

  describe('Gebiet', () => {
    it('ohne Fläche: Leerzustand mit „Gebiet zeichnen“, kein Sprung, kein Zonenabruf (LLH-1069)', async () => {
      renderSeite('/einsaetze/1/evakuierung/6');
      expect(await screen.findByText('Kein Gebiet auf der Lagekarte')).toBeInTheDocument();
      expect(screen.queryByRole('link', { name: /Auf Lagekarte öffnen/ })).toBeNull();
      expect(screen.queryByRole('button', { name: /Auf Lagekarte öffnen/ })).toBeNull();
      expect(zonenApi.listeZonen).not.toHaveBeenCalled();
      const zeichnen = screen.getByRole('link', { name: 'Gebiet zeichnen' });
      expect(zeichnen).toHaveAttribute(
        'href',
        '/einsaetze/1/lagekarte?zeichnen=evakuierungsbezirk&bezirk=6',
      );
      await userEvent.click(zeichnen);
      expect(await screen.findByText('LAGEKARTE')).toBeInTheDocument();
    });

    it('mit Fläche: „Weitere Teilfläche zeichnen“ neben „Auf Lagekarte öffnen“ (LLH-1069)', async () => {
      api.ladeEvakuierung.mockResolvedValue({ bezirke: [{ ...UFER, flaechen: 1 }] });
      renderSeite();
      const zeichnen = await screen.findByRole('link', { name: 'Weitere Teilfläche zeichnen' });
      expect(zeichnen).toHaveAttribute(
        'href',
        '/einsaetze/1/lagekarte?zeichnen=evakuierungsbezirk&bezirk=5',
      );
      expect(screen.queryByRole('link', { name: 'Gebiet zeichnen' })).toBeNull();
    });

    it('gesperrte Lagekarte: „Gebiet zeichnen“ gesperrt mit Grund (LLH-1069)', async () => {
      freigaben.wert = freigabenFixture({ lagekarte: { zugriff: false } });
      renderSeite('/einsaetze/1/evakuierung/6');
      expect(
        await screen.findByRole('button', { name: 'Gebiet zeichnen (Keine Berechtigung)' }),
      ).toBeDisabled();
    });

    it('mit Fläche: Kartenausschnitt und „Auf Lagekarte öffnen" mit dem Bezirk als Ziel', async () => {
      api.ladeEvakuierung.mockResolvedValue({ bezirke: [{ ...UFER, flaechen: 1 }] });
      renderSeite();
      expect(
        await screen.findByRole('img', { name: 'Karte: Gebiet von Bezirk Uferstraße 12–40' }),
      ).toBeInTheDocument();
      expect(screen.getByText('1 Fläche')).toBeInTheDocument();
      const sprung = screen.getByRole('link', { name: /Auf Lagekarte öffnen/ });
      expect(sprung).toHaveAttribute('href', '/einsaetze/1/lagekarte?evakuierungsbezirk=5');
      await userEvent.click(sprung);
      expect(await screen.findByText('LAGEKARTE')).toBeInTheDocument();
    });

    it('gesperrte Lagekarte: Zahl der Flächen, Sprung gesperrt mit Grund, kein Zonenabruf', async () => {
      freigaben.wert = freigabenFixture({ lagekarte: { zugriff: false } });
      api.ladeEvakuierung.mockResolvedValue({ bezirke: [{ ...UFER, flaechen: 2 }] });
      renderSeite();
      expect(
        await screen.findByRole('button', { name: 'Auf Lagekarte öffnen (Keine Berechtigung)' }),
      ).toBeDisabled();
      expect(screen.getByText('2 Flächen auf der Lagekarte')).toBeInTheDocument();
      expect(zonenApi.listeZonen).not.toHaveBeenCalled();
    });
  });

  describe('Stammdaten bearbeiten', () => {
    it('Lesemodus zeigt die Felder; Bearbeiten schaltet um und nimmt dem Kopf die Handlungen', async () => {
      renderSeite();
      await titel();
      const raster = document.querySelector(
        'dl[aria-label="Stammdaten Bezirk Uferstraße 12–40"]',
      ) as HTMLElement;
      expect(raster).toHaveTextContent('Turnhalle Süd');
      expect(raster).toHaveTextContent('Deichwache Nord');
      await userEvent.click(screen.getByRole('button', { name: 'Bearbeiten' }));
      expect(await screen.findByLabelText('Plangröße (Personen)')).toHaveValue('640');
      expect(screen.queryByRole('button', { name: 'Stand melden' })).toBeNull();
      expect(screen.queryByRole('button', { name: 'Bearbeiten' })).toBeNull();
      const leiste = screen
        .getByRole('button', { name: 'Speichern' })
        .closest('[data-lfh="speicherleiste"]');
      expect(leiste?.closest('form')).not.toBeNull();
    });

    it('Speichern sendet nur das Geänderte, auch wenn fremd ein anderes Feld kam (dreiseitig)', async () => {
      api.aendereBezirk.mockResolvedValue({ ...UFER, plan_personen: 820 });
      const { client } = renderSeite();
      await userEvent.click(await screen.findByRole('button', { name: 'Bearbeiten' }));
      const feld = await screen.findByLabelText('Plangröße (Personen)');
      // Während der Sitzung schreibt jemand anders eine Notiz.
      act(() => {
        client.setQueryData<EvakuierungUebersicht>(einsatzKeys.evakuierung(1), {
          bezirke: [{ ...UFER, notiz: 'fremd' }, HAFEN],
        });
      });
      await userEvent.clear(feld);
      await userEvent.type(feld, '820');
      await userEvent.click(screen.getByRole('button', { name: 'Speichern' }));
      await waitFor(() =>
        expect(api.aendereBezirk).toHaveBeenCalledWith(1, 5, { plan_personen: 820 }),
      );
      expect(api.aendereBezirk).toHaveBeenCalledTimes(1);
      expect(await screen.findByText('Bezirk Uferstraße 12–40 gespeichert')).toBeInTheDocument();
      // Zurück im Lesemodus mit dem Kopf.
      expect(await screen.findByRole('button', { name: 'Bearbeiten' })).toBeInTheDocument();
    });

    /** Sammelstelle über das Ortsfeld (LLH-1121, design.md D7). */
    it('eine verortete Sammelstelle zeigt Text, Koordinate und Ort-Zeile', async () => {
      server.use(
        http.get('/api/einsaetze/1/ort-vorschau', () =>
          HttpResponse.json({ ortsname: 'Schulstraße 1, Musterstadt', peilung: null }),
        ),
      );
      api.ladeEvakuierung.mockResolvedValue({
        bezirke: [{ ...UFER, sammelstelle_lat: 52.1, sammelstelle_lon: 8.6 }, HAFEN],
      } satisfies EvakuierungUebersicht);
      renderSeite();
      await titel();
      const raster = document.querySelector(
        'dl[aria-label="Stammdaten Bezirk Uferstraße 12–40"]',
      ) as HTMLElement;
      expect(raster).toHaveTextContent('Turnhalle Süd');
      expect(await within(raster).findByText(/Schulstraße 1, Musterstadt/)).toBeInTheDocument();
    });

    it('Bearbeiten: ein gewählter Treffer setzt Sammelstelle und Koordinate', async () => {
      server.use(
        http.get('/api/einsaetze/1/ort-suche', () =>
          HttpResponse.json({
            zustand: 'ok',
            treffer: [
              {
                name: 'Turnhalle Süd, Schulweg 2, 12345 Musterstadt',
                kurz: 'Schulweg 2, 12345 Musterstadt',
                lat: 52.3,
                lon: 9.7,
              },
            ],
          }),
        ),
        http.get('/api/einsaetze/1/ort-vorschau', () =>
          HttpResponse.json({ ortsname: null, peilung: null }),
        ),
      );
      api.aendereBezirk.mockResolvedValue(UFER);
      renderSeite();
      await userEvent.click(await screen.findByRole('button', { name: 'Bearbeiten' }));
      const feld = await screen.findByLabelText('Sammelstelle');
      await userEvent.clear(feld);
      await userEvent.type(feld, 'Schulweg 2{Enter}');
      await userEvent.click(await screen.findByRole('button', { name: /Schulweg 2, 12345/ }));
      expect(screen.getByRole('group', { name: 'Karte: Sammelstelle' })).toHaveTextContent(
        '52.3,9.7',
      );
      await userEvent.click(screen.getByRole('button', { name: 'Speichern' }));
      await waitFor(() =>
        expect(api.aendereBezirk).toHaveBeenCalledWith(1, 5, {
          sammelstelle: 'Schulweg 2, 12345 Musterstadt',
          sammelstelle_lat: 52.3,
          sammelstelle_lon: 9.7,
        }),
      );
    });

    it('ohne Änderung schließt Speichern die Sitzung, ohne zu senden', async () => {
      renderSeite();
      await userEvent.click(await screen.findByRole('button', { name: 'Bearbeiten' }));
      await userEvent.click(await screen.findByRole('button', { name: 'Speichern' }));
      expect(await screen.findByRole('button', { name: 'Bearbeiten' })).toBeInTheDocument();
      expect(api.aendereBezirk).not.toHaveBeenCalled();
    });

    it('Prüffehler stehen am Feld und verhindern das Senden', async () => {
      renderSeite();
      await userEvent.click(await screen.findByRole('button', { name: 'Bearbeiten' }));
      const feld = await screen.findByLabelText('Plangröße (Personen)');
      await userEvent.clear(feld);
      await userEvent.click(screen.getByRole('button', { name: 'Speichern' }));
      expect(await screen.findByText('Bitte eine Plangröße angeben')).toBeInTheDocument();
      await userEvent.type(feld, '0');
      await userEvent.click(screen.getByRole('button', { name: 'Speichern' }));
      expect(await screen.findByText('Mindestens 1 Person')).toBeInTheDocument();
      expect(api.aendereBezirk).not.toHaveBeenCalled();
    });

    it('eine Ablehnung steht am Formular, die Sitzung bleibt offen', async () => {
      api.aendereBezirk.mockRejectedValue(new Error('Bezeichnung schon vergeben'));
      renderSeite();
      await userEvent.click(await screen.findByRole('button', { name: 'Bearbeiten' }));
      const feld = await screen.findByLabelText('Bezeichnung');
      await userEvent.type(feld, 'x');
      await userEvent.click(screen.getByRole('button', { name: 'Speichern' }));
      expect(await screen.findByText('Bezirk konnte nicht gespeichert werden')).toBeInTheDocument();
      expect(screen.getByLabelText('Bezeichnung')).toHaveValue('Uferstraße 12–40x');
    });

    it('Verlassen-Schutz: mit offener Änderung fragt der Wechsel nach', async () => {
      renderSeite();
      await userEvent.click(await screen.findByRole('button', { name: 'Bearbeiten' }));
      await userEvent.type(await screen.findByLabelText('Sammelstelle'), ' Ost');
      await userEvent.click(screen.getByRole('link', { name: 'Evakuierung' }));
      const dialog = await screen.findByRole('dialog', { name: 'Ungespeicherte Änderungen' });
      await userEvent.click(within(dialog).getByRole('button', { name: 'Bleiben' }));
      expect(screen.getByLabelText('Sammelstelle')).toHaveValue('Turnhalle Süd Ost');
      expect(screen.queryByText('UEBERSICHT')).toBeNull();

      await userEvent.click(screen.getByRole('link', { name: 'Evakuierung' }));
      const wieder = await screen.findByRole('dialog', { name: 'Ungespeicherte Änderungen' });
      await userEvent.click(within(wieder).getByRole('button', { name: 'Verwerfen' }));
      expect(await screen.findByText('UEBERSICHT')).toBeInTheDocument();
    });

    it('nach Abbrechen fragt der Wechsel nicht mehr', async () => {
      renderSeite();
      await userEvent.click(await screen.findByRole('button', { name: 'Bearbeiten' }));
      await userEvent.type(await screen.findByLabelText('Sammelstelle'), ' Ost');
      await userEvent.click(screen.getByRole('button', { name: 'Abbrechen' }));
      await screen.findByRole('button', { name: 'Bearbeiten' });
      await userEvent.click(screen.getByRole('link', { name: 'Evakuierung' }));
      expect(await screen.findByText('UEBERSICHT')).toBeInTheDocument();
    });
  });

  describe('Standverlauf', () => {
    it('ab zwei Meldungen eine Stufenlinie als EIN Bild mit Aussage, darunter die Liste', async () => {
      api.ladeStandVerlauf.mockResolvedValue([
        verlaufEintrag(55, 480, '2026-09-23 10:15:00', true),
        verlaufEintrag(54, 200, '2026-09-23 09:00:00'),
      ]);
      renderSeite();
      const linie = await screen.findByRole('img', { name: /Stand evakuiert/ });
      expect(linie.closest('[data-lfh="bezirk-standlinie"]')).not.toBeNull();
      expect(await screen.findByText('480 evakuiert (gezählt)')).toBeInTheDocument();
      expect(api.ladeStandVerlauf).toHaveBeenCalledTimes(1);
    });

    it('mit einer Meldung keine Linie', async () => {
      api.ladeStandVerlauf.mockResolvedValue([
        verlaufEintrag(55, 480, '2026-09-23 10:15:00', true),
      ]);
      renderSeite();
      expect(await screen.findByText('480 evakuiert (gezählt)')).toBeInTheDocument();
      expect(document.querySelector('[data-lfh="bezirk-standlinie"]')).toBeNull();
    });
  });

  describe('Rechte und Kennung', () => {
    it('Beobachter: alles lesbar, kein Kopf-Plan, Grund im Hinweis, der Sprung bleibt', async () => {
      einsatz.wert = { ...einsatz.wert, meine_rolle: 'beobachter' };
      api.ladeEvakuierung.mockResolvedValue({ bezirke: [{ ...UFER, flaechen: 1 }] });
      renderSeite();
      await titel();
      expect(screen.getByText('nur Einsatzleitung und Führungspersonal')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Stand melden' })).toBeNull();
      expect(screen.queryByRole('button', { name: 'Bearbeiten' })).toBeNull();
      expect(screen.queryByRole('button', { name: /Weitere Aktionen/ })).toBeNull();
      expect(await screen.findByRole('link', { name: /Auf Lagekarte öffnen/ })).toBeInTheDocument();
      // Zeichnen schreibt: ohne Schreibrecht kein Knopf (der Hinweis über der Seite nennt den Grund).
      expect(
        screen.queryByRole('link', { name: /Teilfläche zeichnen|Gebiet zeichnen/ }),
      ).toBeNull();
    });

    it.each([
      ['ungültige', '/einsaetze/1/evakuierung/abc'],
      ['unbekannte', '/einsaetze/1/evakuierung/99'],
    ])('eine %s Kennung führt zurück zur Übersicht', async (_, pfad) => {
      renderSeite(pfad);
      expect(await screen.findByText('UEBERSICHT')).toBeInTheDocument();
    });
  });
});
