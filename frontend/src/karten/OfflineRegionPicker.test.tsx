import { http, HttpResponse } from 'msw';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { meHandler, server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import type { BauJob, OfflineKarte, OfflineKatalogEintrag } from '../api/offlineKarten';
import OfflineRegionPicker from './OfflineRegionPicker';
import { adminFixture } from '../test/fixtures';

const admin = adminFixture();

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
    meHandler(admin),
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
  return renderMitProviders(<OfflineRegionPicker offen onClose={() => {}} />);
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
      // `update_verfuegbar` ist Pflichtfeld im generierten Schema.
      download_at: 'd',
      status: 'bereit',
      aktiv_basemap: false,
      sortier: 0,
      update_verfuegbar: false,
      aktualisierbar: true,
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

  /** LFH-1078: Titel und Knöpfe je Region reichen — kein Absatz über Bau, Download und Quelle. */
  it('erklärt nichts: kein Absatz über Ablauf und Quelle', async () => {
    mockPicker({ karten: [], katalog: [bremenEintrag] });
    render();
    await screen.findByRole('button', { name: /^Laden/ });
    expect(screen.queryByText(/Planetiler|Shortbread|ohne Netz nutzbar/)).not.toBeInTheDocument();
  });
});

/**
 * Zeilenfehler im Picker (LFH-1077, `frontend/AGENTS.md`, „Rückwege und Fehler“): eine abgelehnte
 * Aktion nennt ihren Grund an GENAU der Region, an der sie ausgelöst wurde; kein Fehler-Toast. Das
 * gilt auch für den Download, den die Verkettung nach einem fertigen Bau selbst anstößt. Einziger
 * Fehler-Toast bleibt der im Hintergrund gescheiterte Bau.
 */
describe('OfflineRegionPicker — abgelehnte Aktionen an der Region (LFH-1077)', () => {
  const zeile = (name: string) => screen.getByText(name).closest('li') as HTMLElement;

  function ohneFehlerToastNurEinFehler() {
    expect(document.querySelectorAll('[data-fehler]')).toHaveLength(1);
    expect(document.querySelectorAll('.ant-message-error')).toHaveLength(0);
  }

  function Harness() {
    const [offen, setOffen] = useState(true);
    return (
      <>
        <button type="button" onClick={() => setOffen(true)}>
          Wieder öffnen
        </button>
        <OfflineRegionPicker offen={offen} onClose={() => setOffen(false)} />
      </>
    );
  }

  function ladenAbgelehnt() {
    mockPicker({ karten: [], katalog: [bremenEintrag, bayernEintrag], bauVerfuegbar: false });
    server.use(
      http.post('/api/karte/offline-karten/download', async ({ request }) => {
        const { name } = (await request.json()) as { name: string };
        return name === 'Bremen'
          ? HttpResponse.json({ error: 'Speicher voll' }, { status: 507 })
          : HttpResponse.json({ status: 'laedt' }, { status: 202 });
      }),
    );
  }

  it('Laden: der Grund steht an der Region', async () => {
    ladenAbgelehnt();
    render();
    await screen.findByText('Bayern');
    await userEvent.click(within(zeile('Bremen')).getByRole('button', { name: /^Laden/ }));

    expect(await within(zeile('Bremen')).findByText('Speicher voll')).toHaveAttribute(
      'data-fehler',
    );
    expect(zeile('Bayern').querySelector('[data-fehler]')).toBeNull();
    ohneFehlerToastNurEinFehler();
    expect(document.querySelectorAll('.ant-message-notice')).toHaveLength(0);
  });

  it('Bauen & laden: der Grund steht an der Region', async () => {
    mockPicker({ karten: [], katalog: [bremenEintrag] });
    server.use(
      http.post('/api/karte/offline-karten/bauen', () =>
        HttpResponse.json({ error: 'Kartenbau-Dienst ausgelastet' }, { status: 503 }),
      ),
    );
    render();
    await userEvent.click(await screen.findByRole('button', { name: /Bauen & laden/ }));

    expect(
      await within(zeile('Bayern')).findByText('Kartenbau-Dienst ausgelastet'),
    ).toHaveAttribute('data-fehler');
    expect(zeile('Bremen').querySelector('[data-fehler]')).toBeNull();
    ohneFehlerToastNurEinFehler();
  });

  it('der verkettete Download nach dem Bau meldet seine Ablehnung an der Region', async () => {
    let downloads = 0;
    mockPicker({ karten: [], katalog: [bremenEintrag] });
    server.use(
      http.post('/api/karte/offline-karten/bauen', () => HttpResponse.json({ job_id: 1 })),
      http.get('/api/karte/offline-karten/bau-status', () =>
        HttpResponse.json([{ id: 1, slug: 'bayern', status: { status: 'done' }, gestartet: 'd' }]),
      ),
      http.get('/api/karte/offline-karten/katalog', ({ request }) => {
        const frisch = new URL(request.url).searchParams.get('frisch') === '1';
        return HttpResponse.json(frisch ? [bremenEintrag, bayernEintrag] : [bremenEintrag]);
      }),
      http.post('/api/karte/offline-karten/download', () => {
        downloads += 1;
        return HttpResponse.json({ error: 'Speicher voll' }, { status: 507 });
      }),
    );
    render();
    await userEvent.click(await screen.findByRole('button', { name: /Bauen & laden/ }));

    await waitFor(() => expect(downloads).toBe(1));
    expect(await within(zeile('Bayern')).findByText('Speicher voll')).toHaveAttribute(
      'data-fehler',
    );
    expect(zeile('Bremen').querySelector('[data-fehler]')).toBeNull();
    ohneFehlerToastNurEinFehler();
  });

  it('zeigt nach Schließen und erneutem Öffnen keinen alten Grund', async () => {
    ladenAbgelehnt();
    const nutzer = userEvent.setup();
    renderMitProviders(<Harness />);
    await screen.findByText('Bayern');
    await nutzer.click(within(zeile('Bremen')).getByRole('button', { name: /^Laden/ }));
    await within(zeile('Bremen')).findByText('Speicher voll');

    // Kein Warten auf das Verschwinden: rc-dialog friert den Inhalt eines schließenden Dialogs ein.
    await nutzer.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: /close|schlie/i }),
    );
    await nutzer.click(screen.getByRole('button', { name: 'Wieder öffnen' }));
    const wieder = await screen.findByRole('dialog');
    await within(wieder).findByText('Bayern');
    expect(wieder.querySelector('[data-fehler]')).toBeNull();
  });

  /**
   * `useMutation` verfolgt nur den LETZTEN Aufruf: stößt die Verkettung den Download einer zweiten
   * Region an, bevor der Download der ersten geantwortet hat, ginge deren Ablehnung über
   * `mutation.error` verloren. Der Grund steht trotzdem an der ersten Region.
   */
  it('eine Ablehnung, die nach dem Download einer zweiten Region ankommt, steht an ihrer Region', async () => {
    let gibFrei: () => void = () => {};
    const freigabe = new Promise<void>((r) => (gibFrei = r));
    const downloads: string[] = [];
    mockPicker({ karten: [], katalog: [bremenEintrag] });
    server.use(
      http.post('/api/karte/offline-karten/bauen', () => HttpResponse.json({ job_id: 1 })),
      http.get('/api/karte/offline-karten/bau-status', () =>
        HttpResponse.json([{ id: 1, slug: 'bayern', status: { status: 'done' }, gestartet: 'd' }]),
      ),
      http.get('/api/karte/offline-karten/katalog', ({ request }) => {
        const frisch = new URL(request.url).searchParams.get('frisch') === '1';
        return HttpResponse.json(frisch ? [bremenEintrag, bayernEintrag] : [bremenEintrag]);
      }),
      http.post('/api/karte/offline-karten/download', async ({ request }) => {
        const { name } = (await request.json()) as { name: string };
        downloads.push(name);
        if (name !== 'Bremen') return HttpResponse.json({ status: 'laedt' }, { status: 202 });
        await freigabe;
        return HttpResponse.json({ error: 'Speicher voll' }, { status: 507 });
      }),
    );
    render();
    await userEvent.click(await screen.findByRole('button', { name: /^Laden/ }));
    await waitFor(() => expect(downloads).toEqual(['Bremen']));
    await userEvent.click(screen.getByRole('button', { name: /Bauen & laden/ }));
    await waitFor(() => expect(downloads).toEqual(['Bremen', 'Bayern']));
    gibFrei();

    expect(await within(zeile('Bremen')).findByText('Speicher voll')).toHaveAttribute(
      'data-fehler',
    );
    expect(zeile('Bayern').querySelector('[data-fehler]')).toBeNull();
    ohneFehlerToastNurEinFehler();
  });

  /**
   * Scheitert der verkettete Download bei GESCHLOSSENEM Picker, ist kein Ort zu sehen: dann meldet
   * ein Toast die Region und den Grund, und beim nächsten Öffnen steht er an der Region.
   */
  it('ein verketteter Download, der bei geschlossenem Picker scheitert, meldet sich als Toast und an der Region', async () => {
    let gestartet = false;
    let fertig = false;
    mockPicker({ karten: [], katalog: [bremenEintrag] });
    server.use(
      http.post('/api/karte/offline-karten/bauen', () => {
        gestartet = true;
        return HttpResponse.json({ job_id: 1 });
      }),
      http.get('/api/karte/offline-karten/bau-status', () =>
        HttpResponse.json(
          gestartet
            ? [
                {
                  id: 1,
                  slug: 'bayern',
                  status: { status: fertig ? 'done' : 'building' },
                  gestartet: 'd',
                },
              ]
            : [],
        ),
      ),
      http.get('/api/karte/offline-karten/katalog', ({ request }) => {
        const frisch = new URL(request.url).searchParams.get('frisch') === '1';
        return HttpResponse.json(frisch ? [bremenEintrag, bayernEintrag] : [bremenEintrag]);
      }),
      http.post('/api/karte/offline-karten/download', () =>
        HttpResponse.json({ error: 'Speicher voll' }, { status: 507 }),
      ),
    );
    const nutzer = userEvent.setup();
    renderMitProviders(<Harness />);
    await nutzer.click(await screen.findByRole('button', { name: /Bauen & laden/ }));
    await screen.findByText(/Baut…/);
    // Kein Warten auf das Verschwinden: rc-dialog friert den Inhalt eines schließenden Dialogs ein.
    await nutzer.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: /close|schlie/i }),
    );
    fertig = true;

    expect(
      await screen.findByText('Bayern: Speicher voll', undefined, { timeout: 6000 }),
    ).toBeInTheDocument();
    expect(document.querySelectorAll('.ant-message-error')).toHaveLength(1);

    await nutzer.click(screen.getByRole('button', { name: 'Wieder öffnen' }));
    const wieder = await screen.findByRole('dialog');
    expect(await within(wieder).findByText('Speicher voll')).toHaveAttribute('data-fehler');
  }, 15000);

  it('ein verketteter Download, der bei offenem Picker scheitert, zeigt keinen Toast', async () => {
    mockPicker({ karten: [], katalog: [bremenEintrag] });
    server.use(
      http.post('/api/karte/offline-karten/bauen', () => HttpResponse.json({ job_id: 1 })),
      http.get('/api/karte/offline-karten/bau-status', () =>
        HttpResponse.json([{ id: 1, slug: 'bayern', status: { status: 'done' }, gestartet: 'd' }]),
      ),
      http.get('/api/karte/offline-karten/katalog', ({ request }) => {
        const frisch = new URL(request.url).searchParams.get('frisch') === '1';
        return HttpResponse.json(frisch ? [bremenEintrag, bayernEintrag] : [bremenEintrag]);
      }),
      http.post('/api/karte/offline-karten/download', () =>
        HttpResponse.json({ error: 'Speicher voll' }, { status: 507 }),
      ),
    );
    render();
    await userEvent.click(await screen.findByRole('button', { name: /Bauen & laden/ }));
    expect(await within(zeile('Bayern')).findByText('Speicher voll')).toHaveAttribute(
      'data-fehler',
    );
    ohneFehlerToastNurEinFehler();
  });
});
