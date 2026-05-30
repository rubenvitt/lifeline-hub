import { http, HttpResponse } from 'msw';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Route, Routes } from 'react-router-dom';
import { server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import type { KarteServerConfig } from '../api/karte';
import type { KartenflaecheProps } from './lagekarte/Kartenflaeche';
import LagekartePage from './LagekartePage';

// Kartenflaeche mocken: kein WebGL. Der Stub exponiert Buttons, die die
// Callbacks (Karten-Klick, Marker-Klick) mit festen Werten feuern.
// Prop-Typ wird vom echten Komponenten-Interface abgeleitet → ein künftiges
// Umbenennen (z. B. onKarteKlick) bricht den Mock zur Compile-Zeit.
vi.mock('./lagekarte/Kartenflaeche', () => ({
  default: (props: Partial<KartenflaecheProps>) => (
    <div data-testid="kartenflaeche-stub">
      <button onClick={() => props.onKarteKlick?.({ lng: 8.6, lat: 50.1 })}>karte-klick</button>
      {(props.markers ?? []).map((m) => (
        <button key={m.schluessel} onClick={() => props.onMarkerKlick?.(m.schluessel)}>
          marker-{m.schluessel}
        </button>
      ))}
    </div>
  ),
}));

class FakeEventSource {
  url: string;
  closed = false;
  constructor(url: string) {
    this.url = url;
  }
  addEventListener() {}
  removeEventListener() {}
  close() {
    this.closed = true;
  }
}
beforeEach(() => vi.stubGlobal('EventSource', FakeEventSource));
afterEach(() => vi.unstubAllGlobals());

const EINSATZ = {
  id: 1,
  bezeichnung: 'Test',
  stichwort: null,
  status: 'aktiv',
  begonnen_at: '2026-05-30 10:00:00',
  abgeschlossen_at: null,
  abgeschlossen_von: null,
  einsatzart: 'realeinsatz',
  einsatznummer_intern: null,
  angelegt_at: '2026-05-30 10:00:00',
  leitstellen_nr: null,
  einsatzort: 'ELW',
  einsatzort_lat: 50.0,
  einsatzort_lon: 8.5,
  meldende_stelle: null,
  sachverhalt: null,
  anzahl_betroffene_initial: null,
  meine_rolle: 'einsatzleitung',
  org_id: 1,
  org_name: 'Org',
};

const UHS_NICHT_VERORTET = {
  id: 5,
  einsatz_id: 1,
  abschnitt_id: null,
  typ: 'behandlungsplatz',
  bezeichnung: 'BHP 50',
  standort: null,
  notiz: null,
  status: 'aktiv',
  lat: null,
  lon: null,
  erfasst_at: '',
  erfasst_von: 1,
  geaendert_at: '',
  geaendert_von: 1,
  storniert_at: null,
};

const SCHADEN_VERORTET = {
  id: 9,
  einsatz_id: 1,
  registrier_nr: 3,
  status: 'offen',
  typ: 'sachschaden',
  ausmass: 'gross',
  ort: 'Hauptstr.',
  lat: 51.0,
  lon: 7.0,
  beschreibung: '',
  geschaedigt_person_id: null,
  geschaedigt_personal_id: null,
  geschaedigt_organisation_id: null,
  geschaedigt_kontakt: null,
  uebergeben_an: null,
  uebergeben_at: null,
  abschluss_grund: null,
  abschluss_at: null,
  erfasst_at: '',
  erfasst_von: 1,
  geaendert_at: '',
  geaendert_von: 1,
  storniert_at: null,
  storniert_von: null,
  geschaedigt_registrier_nr: null,
  geschaedigt_storniert_at: null,
  geschaedigt_personal_name: null,
  geschaedigt_organisation_name: null,
};

function basisHandler(
  extra: ReturnType<typeof http.get>[] = [],
  config: KarteServerConfig = { online_style_url: null, pmtiles_verfuegbar: false, pmtiles_url: null },
) {
  server.use(
    http.get('/api/einsaetze/1', () => HttpResponse.json(EINSATZ)),
    http.get('/api/einsaetze/1/uhs', () => HttpResponse.json([UHS_NICHT_VERORTET])),
    http.get('/api/einsaetze/1/schaeden', () => HttpResponse.json([SCHADEN_VERORTET])),
    http.get('/api/karte/config', () => HttpResponse.json(config)),
    ...extra,
  );
}

function renderSeite(route = '/einsaetze/1/lagekarte') {
  return renderMitProviders(
    <Routes>
      <Route path="/einsaetze/:id/lagekarte" element={<LagekartePage />} />
    </Routes>,
    { route },
  );
}

describe('LagekartePage', () => {
  it('zeigt die Nicht-verortet-Liste mit Anzahl-Badge', async () => {
    basisHandler();
    const { container } = renderSeite();
    expect(await screen.findByText('⚠ Nicht verortet')).toBeInTheDocument();
    expect(await screen.findByText(/BHP 50/)).toBeInTheDocument();
    // Badge zeigt die Anzahl der nicht verorteten Objekte (1) — gezielt den
    // Badge-Knoten treffen, nicht eine zufällige "(1)"-Zähltext-Stelle.
    const badge = container.querySelector('.ant-badge-count');
    expect(badge).toHaveTextContent('1');
  });

  it('platziert ein Objekt: Objekt wählen → Karten-Klick → PATCH mit lat/lon', async () => {
    let patchBody: unknown = null;
    basisHandler([
      http.patch('/api/einsaetze/1/uhs/5', async ({ request }) => {
        patchBody = await request.json();
        return HttpResponse.json({ ...UHS_NICHT_VERORTET, lat: 50.1, lon: 8.6 });
      }),
    ]);
    const user = userEvent.setup();
    renderSeite();
    await user.click(await screen.findByRole('button', { name: 'Platzieren' }));
    await user.click(await screen.findByText('karte-klick'));
    await waitFor(() => expect(patchBody).toEqual({ lat: 50.1, lon: 8.6 }));
  });

  it('verschiebt den Einsatzort: Verschieben → Karten-Klick → Kopf-PATCH mit neuer Koordinate', async () => {
    let patchBody: Record<string, unknown> | null = null;
    basisHandler([
      http.patch('/api/einsaetze/1', async ({ request }) => {
        patchBody = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ ...EINSATZ, einsatzort_lat: 50.1, einsatzort_lon: 8.6 });
      }),
    ]);
    const user = userEvent.setup();
    renderSeite();
    // Einsatzort ist verortet (einsatzort_lat gesetzt) → Button "Verschieben"
    await user.click(await screen.findByRole('button', { name: 'Verschieben' }));
    await user.click(await screen.findByText('karte-klick'));
    await waitFor(() => {
      expect(patchBody).not.toBeNull();
      expect(patchBody!.einsatzort_lat).toBe(50.1);
      expect(patchBody!.einsatzort_lon).toBe(8.6);
      expect(patchBody!.bezeichnung).toBe('Test'); // andere Kopffelder bleiben erhalten (Vollersatz)
    });
  });

  it('Marker-Klick öffnet den Inspector mit Modul-Link', async () => {
    basisHandler();
    const user = userEvent.setup();
    renderSeite();
    await user.click(await screen.findByText('marker-schaden-9'));
    const link = await screen.findByRole('link', { name: /Im Fach-Modul öffnen/ });
    expect(link).toHaveAttribute('href', '/einsaetze/1/schaeden?schaden=9');
  });

  it('Basemap-Umschalter: von Online auf Blind wechseln, Marker bleiben sichtbar', async () => {
    basisHandler([], {
      online_style_url: 'https://x/style.json',
      pmtiles_verfuegbar: true,
      pmtiles_url: '/api/karte/tiles.pmtiles',
    });
    const user = userEvent.setup();
    renderSeite();
    // Default ist 'online' (online_style_url gesetzt) → Online gewählt, Blind NICHT.
    expect(await screen.findByText('marker-schaden-9')).toBeInTheDocument();
    expect((screen.getByRole('radio', { name: 'Online' }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole('radio', { name: 'Blind' }) as HTMLInputElement).checked).toBe(false);
    // Auf Blind wechseln. antd Radio.Button rendert pointer-events:none auf dem
    // <input> selbst → das umschließende <label>-Element klicken.
    const blindLabel = screen.getByText('Blind').closest('label') ?? screen.getByText('Blind');
    await user.click(blindLabel);
    expect((screen.getByRole('radio', { name: 'Blind' }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole('radio', { name: 'Online' }) as HTMLInputElement).checked).toBe(false);
    // Marker bleiben im Blind-Modus sichtbar (Spec-Garantie):
    expect(screen.getByText('marker-schaden-9')).toBeInTheDocument();
  });

  it('Basemap-Umschalter: ohne Config sind Online/Offline disabled, Blind aktiv', async () => {
    // Default-Config: leer → defaultModus = blind, kein Modus außer Blind verfügbar.
    basisHandler();
    renderSeite();
    await screen.findByText('marker-schaden-9');
    expect((screen.getByRole('radio', { name: 'Online' }) as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByRole('radio', { name: 'Offline' }) as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByRole('radio', { name: 'Blind' }) as HTMLInputElement).disabled).toBe(false);
    expect((screen.getByRole('radio', { name: 'Blind' }) as HTMLInputElement).checked).toBe(true);
  });

  it('Basemap-Umschalter: Blind-Modus zeigt erklärenden Hinweistext', async () => {
    basisHandler();
    renderSeite();
    expect(await screen.findByText(/Keine Basemap konfiguriert/i)).toBeInTheDocument();
  });

  it('Basemap-Umschalter: bei verfügbarer Config sind passende Buttons aktiv und kein Blind-Hinweis', async () => {
    basisHandler([], {
      online_style_url: 'https://x/style.json',
      pmtiles_verfuegbar: true,
      pmtiles_url: '/api/karte/tiles.pmtiles',
    });
    renderSeite();
    await screen.findByText('marker-schaden-9');
    expect((screen.getByRole('radio', { name: 'Online' }) as HTMLInputElement).disabled).toBe(false);
    expect((screen.getByRole('radio', { name: 'Offline' }) as HTMLInputElement).disabled).toBe(false);
    // Default-Modus ist 'online' → kein Blind-Hinweis sichtbar.
    expect(screen.queryByText(/Keine Basemap konfiguriert/i)).not.toBeInTheDocument();
  });

  it('Basemap-Umschalter: nur Offline konfiguriert → Online disabled, Offline aktiv', async () => {
    basisHandler([], {
      online_style_url: null,
      pmtiles_verfuegbar: true,
      pmtiles_url: '/api/karte/tiles.pmtiles',
    });
    renderSeite();
    await screen.findByText('marker-schaden-9');
    expect((screen.getByRole('radio', { name: 'Online' }) as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByRole('radio', { name: 'Offline' }) as HTMLInputElement).disabled).toBe(false);
    // defaultModus springt auf 'offline'
    expect((screen.getByRole('radio', { name: 'Offline' }) as HTMLInputElement).checked).toBe(true);
  });
});
