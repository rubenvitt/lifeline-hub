import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App as AntApp } from 'antd';
import { http, HttpResponse } from 'msw';
import { MemoryRouter, Route, Routes } from 'react-router';
import { server } from '../test/server';
import { AuthProvider } from '../auth/AuthContext';
import type { PegelAnzeige, PegelVerlauf, WetterAnzeige } from '../api/types';
import WetterPegelPage from './WetterPegelPage';

vi.mock('../api/einsaetze', () => ({
  ladeEinsatz: vi.fn(() =>
    Promise.resolve({
      id: 1,
      bezeichnung: 'Hochwasser',
      status: 'aktiv',
      meine_rolle: 'einsatzleitung',
    }),
  ),
}));

const MIN = 60_000;
/** RFC 3339 relativ zu jetzt (die Seite rechnet gegen die echte Uhr). */
const vor = (ms: number) => new Date(Date.now() - ms).toISOString();
const in_ = (ms: number) => new Date(Date.now() + ms).toISOString();

const pegel = (over: Partial<PegelAnzeige> & { id: number }): PegelAnzeige => ({
  station_uuid: `uuid-${over.id}`,
  name: `STATION ${over.id}`,
  gewaesser: 'WESER',
  reihenfolge: over.id - 1,
  messung: { wasserstand_cm: 684, zeitpunkt: vor(10 * MIN), trend_cm_pro_h: 9 },
  ...over,
});

const verlauf = (pegelId: number, n = 3): PegelVerlauf => ({
  pegel_id: pegelId,
  punkte: Array.from({ length: n }, (_, i) => ({
    zeitpunkt: vor((n - 1 - i) * 60 * MIN),
    wasserstand_cm: 600 + i * 40,
  })),
});

const wetterOk = (over: Partial<WetterAnzeige> = {}): WetterAnzeige => ({
  ort: { name: 'Stadt Bremen', kreis: 'Bremen', land: 'Bremen' },
  warnungen: {
    zustand: 'ok',
    abgerufen_at: vor(2 * MIN),
    daten: [
      {
        stufe: 'maessig',
        ereignis: 'STURMBÖEN',
        ueberschrift: 'Amtliche WARNUNG vor STURMBÖEN',
        beschreibung: 'Es treten Sturmböen um 70 km/h auf.',
        handlungsempfehlung: 'Achten Sie auf herabstürzende Äste.',
        beginn: vor(60 * MIN),
        ende: in_(120 * MIN),
      },
      {
        stufe: 'schwer',
        ereignis: 'ORKANARTIGE BÖEN',
        ueberschrift: 'Amtliche UNWETTERWARNUNG vor ORKANARTIGEN BÖEN',
        beginn: in_(180 * MIN),
        ende: in_(300 * MIN),
      },
    ],
  },
  vorhersage: {
    zustand: 'ok',
    abgerufen_at: vor(5 * MIN),
    daten: {
      station: 'BREMEN',
      entfernung_m: 4200,
      stunden: Array.from({ length: 25 }, (_, i) => ({
        zeitpunkt: new Date(
          Math.floor(Date.now() / 3_600_000) * 3_600_000 + i * 3_600_000,
        ).toISOString(),
        temperatur_c: 18.6,
        niederschlag_mm: 0,
        // Die erste Stunde ohne Wahrscheinlichkeit: fehlend, nicht 0.
        ...(i === 0 ? {} : { niederschlag_wahrscheinlichkeit: 20 }),
        wind_kmh: 11.1,
        boeen_kmh: 18.5,
        windrichtung_grad: 192,
      })),
    },
  },
  ...over,
});

function antworten({
  liste = [pegel({ id: 1 }), pegel({ id: 2, messung: undefined })],
  // Station 2 HAT eine Reihe, aber keine Messung: die Linie muss am Ausfall scheitern,
  // nicht an fehlenden Punkten.
  reihen = [verlauf(1), verlauf(2)] as PegelVerlauf[] | 'fehler',
  wetter = wetterOk() as WetterAnzeige,
} = {}) {
  server.use(
    http.get('/api/einsaetze/1/pegel', () => HttpResponse.json(liste)),
    http.get('/api/einsaetze/1/pegel/verlauf', () =>
      reihen === 'fehler'
        ? HttpResponse.json({ error: 'kaputt' }, { status: 500 })
        : HttpResponse.json(reihen),
    ),
    http.get('/api/einsaetze/1/wetter', () => HttpResponse.json(wetter)),
  );
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <AntApp>
        <AuthProvider>
          <MemoryRouter initialEntries={['/einsaetze/1/wetter-pegel']}>
            <Routes>
              <Route path="/einsaetze/:id/wetter-pegel" element={<WetterPegelPage />} />
              <Route
                path="/einsaetze/:id/einstellungen/pegel"
                element={<div>Pegel-Einstellungen</div>}
              />
              <Route path="/einsaetze/:id/einsatzdaten" element={<div>Einsatzdaten</div>} />
            </Routes>
          </MemoryRouter>
        </AuthProvider>
      </AntApp>
    </QueryClientProvider>,
  );
}

const pegelZeilen = () => document.querySelectorAll('[data-lfh="pegel-zeile"]');

describe('WetterPegelPage (LFH-633)', () => {
  beforeEach(() => vi.clearAllMocks());

  describe('Pegel', () => {
    it('zeigt die Pegel in Reihenfolge mit Wert, Trend und Verlauf; Ausfall ohne Linie', async () => {
      antworten();
      renderPage();
      expect(await screen.findByText('STATION 1 · WESER')).toBeInTheDocument();
      const [erste, zweite] = [...pegelZeilen()];
      expect(within(erste as HTMLElement).getByText('6,84')).toBeInTheDocument();
      expect(within(erste as HTMLElement).getByText(/steigend \+9 cm\/h/)).toBeInTheDocument();
      expect(
        await within(erste as HTMLElement).findByRole('img', {
          name: /^Verlauf 24 h: 6,00 m bis 6,80 m/,
        }),
      ).toBeInTheDocument();
      // Station 2 ohne Messung: „—", „Stand unbekannt", keine Linie.
      expect(zweite.getAttribute('data-fall')).toBe('ausfall');
      expect(within(zweite as HTMLElement).getByText('—')).toBeInTheDocument();
      expect(within(zweite as HTMLElement).getByText(/Stand unbekannt/)).toBeInTheDocument();
      expect(within(zweite as HTMLElement).queryByRole('img')).toBeNull();
    });

    it('ein alter Messwert bleibt mit „veraltet" und Kante stehen', async () => {
      antworten({
        liste: [
          pegel({
            id: 1,
            messung: { wasserstand_cm: 684, zeitpunkt: vor(90 * MIN), trend_cm_pro_h: 0 },
          }),
        ],
        reihen: [verlauf(1)],
      });
      renderPage();
      await screen.findByText('STATION 1 · WESER');
      const zeile = pegelZeilen()[0] as HTMLElement;
      expect(zeile.getAttribute('data-ton')).toBe('achtung');
      expect(within(zeile).getByText(/veraltet/)).toBeInTheDocument();
      expect(within(zeile).getByText('6,84')).toBeInTheDocument();
    });

    it('fällt nur der Verlauf aus, bleiben die Werte stehen', async () => {
      antworten({ liste: [pegel({ id: 1 })], reihen: 'fehler' });
      renderPage();
      expect(await screen.findByText('Verlauf nicht abrufbar')).toBeInTheDocument();
      expect(screen.getByText('6,84')).toBeInTheDocument();
    });

    it('ohne festgelegten Pegel: „kein Pegel festgelegt" und der Weg zu den Einstellungen', async () => {
      antworten({ liste: [], reihen: [] });
      renderPage();
      expect(await screen.findByText('kein Pegel festgelegt')).toBeInTheDocument();
      await userEvent.click(screen.getByRole('button', { name: 'Zu Einstellungen › Pegel' }));
      expect(await screen.findByText('Pegel-Einstellungen')).toBeInTheDocument();
    });

    it('genau eine Primäraktion im Kopf, und sie öffnet die Pegel-Einstellungen', async () => {
      antworten();
      renderPage();
      await screen.findByText('STATION 1 · WESER');
      const kopf = document.querySelector('[data-lfh="seitenkopf-aktionen"]') as HTMLElement;
      const primaer = kopf.querySelectorAll('.ant-btn-primary');
      expect(primaer).toHaveLength(1);
      await userEvent.click(within(kopf).getByRole('button', { name: 'Pegel festlegen' }));
      expect(await screen.findByText('Pegel-Einstellungen')).toBeInTheDocument();
    });
  });

  describe('Warnungen', () => {
    it('trennt „gilt jetzt" von „angekündigt", mit amtlicher Stufe und Gemeinde', async () => {
      antworten();
      renderPage();
      const jetztGruppe = await screen.findByRole('region', { name: 'Gilt jetzt' });
      expect(within(jetztGruppe).getByText('Sturmböen')).toBeInTheDocument();
      expect(within(jetztGruppe).getByText('Markantes Wetter')).toBeInTheDocument();
      expect(within(jetztGruppe).getByText(/^seit /)).toBeInTheDocument();
      const angekuendigt = screen.getByRole('region', { name: 'Angekündigt' });
      expect(within(angekuendigt).getByText('Orkanartige Böen')).toBeInTheDocument();
      expect(within(angekuendigt).getByText('Unwetterwarnung')).toBeInTheDocument();
      expect(within(angekuendigt).getByText(/^ab /)).toBeInTheDocument();
      expect(screen.getAllByText(/Stadt Bremen/).length).toBeGreaterThan(0);
    });

    it('Beschreibung und Handlungsempfehlung stehen inline hinter einem Umschalter', async () => {
      antworten();
      renderPage();
      const knopf = await screen.findByRole('button', {
        name: 'Beschreibung und Handlungsempfehlung',
      });
      expect(knopf).toHaveAttribute('aria-expanded', 'false');
      expect(screen.queryByText('Achten Sie auf herabstürzende Äste.')).toBeNull();
      await userEvent.click(knopf);
      expect(screen.getByText('Achten Sie auf herabstürzende Äste.')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Beschreibung ausblenden' })).toHaveAttribute(
        'aria-expanded',
        'true',
      );
    });

    it('keine gültige Warnung: ausdrücklich gesagt, mit Gemeinde', async () => {
      antworten({
        wetter: wetterOk({ warnungen: { zustand: 'ok', abgerufen_at: vor(MIN), daten: [] } }),
      });
      renderPage();
      expect(
        await screen.findByText('Keine gültigen Warnungen für Stadt Bremen.'),
      ).toBeInTheDocument();
    });

    it('alter Stand (45 min): Liste bleibt, mit „veraltet" und Abrufzeit', async () => {
      const w = wetterOk();
      antworten({ wetter: { ...w, warnungen: { ...w.warnungen, abgerufen_at: vor(45 * MIN) } } });
      renderPage();
      expect(
        await screen.findByText(/· veraltet — die Aktualisierung gelingt gerade nicht/),
      ).toBeInTheDocument();
      expect(screen.getByText('Sturmböen')).toBeInTheDocument();
    });
  });

  describe('Ausfall und kein Ort', () => {
    it('Wetterquelle ausgefallen: „Stand unbekannt" ohne Liste, die Pegel bleiben unberührt', async () => {
      antworten({
        wetter: { warnungen: { zustand: 'ausfall' }, vorhersage: { zustand: 'ausfall' } },
      });
      renderPage();
      const hinweise = await screen.findAllByRole('status');
      const unbekannt = hinweise.filter(
        (h) => h.getAttribute('data-lfh') === 'wetter-stand-unbekannt',
      );
      expect(unbekannt).toHaveLength(2);
      expect(document.querySelectorAll('[data-lfh="wetter-warnung"]')).toHaveLength(0);
      expect(document.querySelectorAll('[data-lfh="wetter-stunde"]')).toHaveLength(0);
      expect(screen.getByText('6,84')).toBeInTheDocument();
    });

    it('kein Einsatzort: Erklärung und EIN Weg zu den Einsatzdaten', async () => {
      antworten({
        wetter: { warnungen: { zustand: 'kein_ort' }, vorhersage: { zustand: 'kein_ort' } },
      });
      renderPage();
      expect(await screen.findAllByText(/brauchen einen verorteten Einsatzort/)).toHaveLength(2);
      const wege = screen.getAllByRole('button', {
        name: 'Einsatzort in den Einsatzdaten verorten',
      });
      expect(wege).toHaveLength(1);
      await userEvent.click(wege[0]);
      expect(await screen.findByText('Einsatzdaten')).toBeInTheDocument();
    });
  });

  describe('Vorhersage', () => {
    it('acht 3-h-Zeilen, Station mit Entfernung, Quellenvermerk; fehlender Wert ist ein Strich', async () => {
      antworten();
      renderPage();
      const liste = await screen.findByRole('list', { name: 'Vorhersage je drei Stunden' });
      const zeilen = within(liste).getAllByRole('listitem');
      expect(zeilen).toHaveLength(8);
      expect(zeilen[0]).toHaveTextContent('0,0 mm · —');
      expect(zeilen[1]).toHaveTextContent('0,0 mm · 20 %');
      expect(zeilen[1]).toHaveTextContent('18,6 °C');
      expect(zeilen[1]).toHaveTextContent('S 11 km/h · Böen 19 km/h');
      expect(screen.getByText(/Station Bremen, 4,2 km/)).toBeInTheDocument();
      expect(screen.getAllByText(/Datenbasis: Deutscher Wetterdienst/).length).toBe(2);
    });
  });
});
