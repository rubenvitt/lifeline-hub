import { http, HttpResponse } from 'msw';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import { AuthProvider } from '../auth/AuthContext';
import type { BauJob, OfflineKarte, OfflineKatalogEintrag } from '../api/offlineKarten';
import OfflineRegionPicker from './OfflineRegionPicker';

const admin = {
  id: 1,
  anzeigename: 'Admin',
  benutzername: 'admin',
  system_rolle: 'admin',
  org_rolle: 'keine',
  aktiv: true,
  erstellt_at: '2026-06-26 10:00:00',
};

const bremenEintrag: OfflineKatalogEintrag = {
  name: 'Bremen',
  url: 'https://m/bremen.mbtiles',
  region: 'DE-HB',
  groesse: 100_000_000,
  lizenz: '© OpenStreetMap contributors (ODbL)',
  kachel_schema: 'shortbread',
  quelle: 'q',
  sha256: 'a'.repeat(64),
  gruppe: 'Bundesländer',
};
const bayernEintrag: OfflineKatalogEintrag = {
  ...bremenEintrag,
  name: 'Bayern',
  url: 'https://m/bayern.mbtiles',
  region: 'DE-BY',
  sha256: 'b'.repeat(64),
};

const baubar = [
  { slug: 'bayern', name: 'Bayern', region: 'DE-BY', gruppe: 'Bundesländer' },
  { slug: 'bremen', name: 'Bremen', region: 'DE-HB', gruppe: 'Bundesländer' },
];

/** Mockt die Picker-Endpunkte. Default: karten-service da, Bremen gebaut (lieferbar), Bayern nicht. */
function mockPicker(
  opts: {
    karten?: OfflineKarte[];
    katalog?: OfflineKatalogEintrag[];
    katalogFrisch?: OfflineKatalogEintrag[];
    bauJobs?: BauJob[];
    bauVerfuegbar?: boolean;
  } = {},
) {
  const {
    karten = [],
    katalog = [bremenEintrag],
    katalogFrisch,
    bauJobs = [],
    bauVerfuegbar = true,
  } = opts;
  server.use(
    http.get('/api/auth/me', () => HttpResponse.json(admin)),
    http.get('/api/karte/config', () =>
      HttpResponse.json({
        online_styles: [],
        offline_verfuegbar: false,
        offline_tiles_url: null,
        offline_attribution: null,
        karten_bau_verfuegbar: bauVerfuegbar,
      }),
    ),
    http.get('/api/karte/offline-karten/baubare-regionen', () => HttpResponse.json(baubar)),
    http.get('/api/karte/offline-karten', () => HttpResponse.json(karten)),
    http.get('/api/karte/offline-karten/katalog', ({ request }) => {
      const frisch = new URL(request.url).searchParams.get('frisch') === '1';
      return HttpResponse.json(frisch && katalogFrisch ? katalogFrisch : katalog);
    }),
    http.get('/api/karte/offline-karten/bau-status', () => HttpResponse.json(bauJobs)),
  );
}

function render() {
  return renderMitProviders(
    <AuthProvider>
      <OfflineRegionPicker offen onClose={() => {}} />
    </AuthProvider>,
  );
}

describe('OfflineRegionPicker', () => {
  it('adaptiver Button je Zustand: gebaut → Laden, ungebaut → Bauen & laden, auf Gerät → Auf dem Gerät', async () => {
    // Bremen ist auf dem Gerät (bereit), Bayern ungebaut, ein dritter gebaut aber nicht geladen.
    const bremenAufGeraet: OfflineKarte = {
      id: 1,
      name: 'Bremen',
      pfad: 'karte-1.mbtiles',
      quell_url: 'https://m/bremen.mbtiles',
      lizenz: 'ODbL',
      kachel_schema: 'shortbread',
      format: 'pbf',
      groesse: 1,
      sha256: 'x',
      // LFH-265: `update_verfuegbar` ist Pflichtfeld im generierten Schema.
      download_at: 'd',
      status: 'bereit',
      aktiv_basemap: false,
      sortier: 0,
      update_verfuegbar: false,
    };
    mockPicker({ karten: [bremenAufGeraet], katalog: [bremenEintrag] });
    render();
    // Bremen: auf dem Gerät.
    expect(await screen.findByText('Auf dem Gerät')).toBeInTheDocument();
    // Bayern: nicht gebaut, karten-service da → Bauen & laden.
    expect(screen.getByRole('button', { name: /Bauen & laden/ })).toBeInTheDocument();
  });

  it('Laden startet den Download eines gebauten (lieferbaren) Eintrags mit korrektem Body', async () => {
    let body: unknown = null;
    // Bremen gebaut (lieferbar), nicht auf Gerät → „Laden". Bayern-Katalog leer lassen.
    mockPicker({ karten: [], katalog: [bremenEintrag] });
    server.use(
      http.post('/api/karte/offline-karten/download', async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ status: 'laedt' }, { status: 202 });
      }),
    );
    render();
    const ladenBtns = await screen.findAllByRole('button', { name: /^Laden/ });
    await userEvent.click(ladenBtns[0]);
    await waitFor(() => expect(body).not.toBeNull());
    expect(body).toMatchObject({
      name: 'Bremen',
      url: 'https://m/bremen.mbtiles',
      sha256_erwartet: 'a'.repeat(64),
      groesse_erwartet: 100_000_000,
    });
  });

  it('Bauen & laden verkettet: Bau anstoßen → nach „fertig" frischen Katalog holen → automatisch laden', async () => {
    let bauSlug: string | null = null;
    let downloadName: string | null = null;
    let frischGeholt = false;
    // Bremen gebaut (→ „Laden"), Bayern ungebaut (→ eindeutiges „Bauen & laden"); nach dem Bau
    // taucht Bayern erst im FRISCHEN Katalog auf.
    mockPicker({ karten: [], katalog: [bremenEintrag] });
    server.use(
      http.post('/api/karte/offline-karten/bauen', async ({ request }) => {
        bauSlug = ((await request.json()) as { slug: string }).slug;
        return HttpResponse.json({ job_id: 1 });
      }),
      // Bau ist sofort „fertig" (Test-Vereinfachung) → die Verkettung triggert den Download.
      http.get('/api/karte/offline-karten/bau-status', () =>
        HttpResponse.json([{ id: 1, slug: 'bayern', status: { status: 'done' }, gestartet: 'd' }]),
      ),
      http.get('/api/karte/offline-karten/katalog', ({ request }) => {
        const frisch = new URL(request.url).searchParams.get('frisch') === '1';
        if (frisch) frischGeholt = true;
        return HttpResponse.json(frisch ? [bremenEintrag, bayernEintrag] : [bremenEintrag]);
      }),
      http.post('/api/karte/offline-karten/download', async ({ request }) => {
        downloadName = ((await request.json()) as { name: string }).name;
        return HttpResponse.json({ status: 'laedt' }, { status: 202 });
      }),
    );
    render();
    await userEvent.click(await screen.findByRole('button', { name: /Bauen & laden/ }));
    // Bau angestoßen …
    await waitFor(() => expect(bauSlug).toBe('bayern'));
    // … dann automatisch: frischen Katalog geholt (TTL umgangen) und Bayern geladen.
    await waitFor(() => expect(downloadName).toBe('Bayern'));
    expect(frischGeholt).toBe(true);
  });

  it('ohne karten-service: nur lieferbare Regionen, kein Bauen & laden', async () => {
    mockPicker({ karten: [], katalog: [bremenEintrag], bauVerfuegbar: false });
    render();
    // Bremen (lieferbar) lässt sich laden …
    expect(await screen.findByRole('button', { name: /^Laden/ })).toBeInTheDocument();
    // … aber ohne konfigurierten karten-service gibt es keinen Bau.
    expect(screen.queryByRole('button', { name: /Bauen & laden/ })).not.toBeInTheDocument();
  });
});
