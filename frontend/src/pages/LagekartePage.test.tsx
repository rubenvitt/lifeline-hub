import { http, HttpResponse } from 'msw';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Route, Routes, useLocation } from 'react-router-dom';
import { server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import type { KarteServerConfig } from '../api/karte';
import type { KartenflaecheProps } from './lagekarte/Kartenflaeche';
import LagekartePage from './LagekartePage';

// URL.createObjectURL / revokeObjectURL fehlen in jsdom → Stubs definieren bevor Tests laufen.
// Direkt auf URL setzen (nicht via spyOn, da die Methoden in jsdom gar nicht existieren).
(URL as unknown as Record<string, unknown>).createObjectURL = vi.fn(() => 'blob:mock-bild');
(URL as unknown as Record<string, unknown>).revokeObjectURL = vi.fn();

// Kartenflaeche mocken: kein WebGL. Der Stub exponiert Buttons, die die
// Callbacks (Karten-Klick, Marker-Klick) mit festen Werten feuern.
// Prop-Typ wird vom echten Komponenten-Interface abgeleitet → ein künftiges
// Umbenennen (z. B. onKarteKlick) bricht den Mock zur Compile-Zeit.
vi.mock('./lagekarte/Kartenflaeche', () => ({
  default: (props: Partial<KartenflaecheProps>) => (
    <div data-testid="kartenflaeche-stub">
      <div data-testid="attribution">{props.attribution ?? ''}</div>
      <div data-testid="bilder-count">{(props.bilder ?? []).length}</div>
      <button onClick={() => props.onKarteKlick?.({ lng: 8.6, lat: 50.1 })}>karte-klick</button>
      {(props.markers ?? []).map((m) => (
        <button key={m.schluessel} onClick={() => props.onMarkerKlick?.(m.schluessel)}>
          marker-{m.schluessel}
        </button>
      ))}
      {/* Polygon-Zeichnen: nur im aktiven Zeichenmodus feuerbar (spiegelt den echten Flow). */}
      {props.zeichnen && (
        <button
          onClick={() =>
            props.onFlaecheGezeichnet?.({
              type: 'Polygon',
              coordinates: [[[8.6, 50.1], [8.7, 50.1], [8.7, 50.2], [8.6, 50.1]]],
            })
          }
        >
          flaeche-fertig
        </button>
      )}
      {/* Klick auf eine gerenderte Abschnittsfläche → onFlaecheKlick. */}
      {(props.flaechen ?? []).map((f) => (
        <button key={f.id} onClick={() => props.onFlaecheKlick?.(f.id)}>
          flaeche-{f.id}
        </button>
      ))}
      {/* Zone zeichnen: feuert je nach Modus eine Linien- oder Polygon-Geometrie. */}
      {props.zoneZeichnen && (
        <button
          onClick={() =>
            props.onZoneGezeichnet?.(
              props.zoneZeichnen === 'linie'
                ? { type: 'LineString', coordinates: [[8.6, 50.1], [8.7, 50.2]] }
                : { type: 'Polygon', coordinates: [[[8.6, 50.1], [8.7, 50.1], [8.7, 50.2], [8.6, 50.1]]] },
            )
          }
        >
          zone-fertig
        </button>
      )}
      {/* Klick auf eine gerenderte Zone → onZoneKlick. */}
      {(props.zonen ?? []).map((z) => (
        <button key={z.id} onClick={() => props.onZoneKlick?.(z.id)}>
          zone-{z.id}
        </button>
      ))}
    </div>
  ),
}));

const eventSourceUrls: string[] = [];
class FakeEventSource {
  url: string;
  closed = false;
  constructor(url: string) {
    this.url = url;
    eventSourceUrls.push(url);
  }
  addEventListener() {}
  removeEventListener() {}
  close() {
    this.closed = true;
  }
}
beforeEach(() => {
  eventSourceUrls.length = 0;
  vi.stubGlobal('EventSource', FakeEventSource);
});
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

const LAGEMELDUNG_VERORTET = {
  id: 4,
  einsatz_id: 1,
  meldung_id: 12,
  text: 'Brücke gesperrt',
  lat: 50.3,
  lon: 8.7,
  erstellt_von_id: 1,
  erstellt_at: '2026-06-12 09:00:00',
  meldung_lfd_nr: 5,
  meldung_absender: 'Florian Nord 1',
};

// --- L‑2 taktische Mock-Objekte ---------------------------------------------
// Nur die Felder, die der Code (baueTaktischeMarker/baueTzProps/flaechen) liest.
// Bewusst NICHT als voller Typ annotiert: HttpResponse.json prüft nicht gegen den
// Interface-Typ, und voll auszufüllen wäre nur Rauschen.

const EINHEIT_NICHT_VERORTET = {
  id: 2,
  name: 'Zug 1',
  typ_label: 'Zug',
  lat: null as number | null,
  lon: null as number | null,
  tz_fachaufgabe: null,
  tz_organisation: null,
};

const EINHEIT_VERORTET = {
  id: 1,
  name: 'Gruppe A',
  typ_label: 'Gruppe',
  lat: 50.1,
  lon: 8.6,
  tz_fachaufgabe: null,
  tz_organisation: null,
};

const ABSCHNITT_OHNE_FLAECHE = {
  id: 3,
  name: 'EA Nord',
  flaeche_geojson: null as string | null,
  tz_fachaufgabe: null,
  tz_organisation: null,
};

const FUEHRUNGSKRAFT_VERORTET = {
  id: 7,
  einsatz_id: 1,
  name: 'Zugführer',
  lat: 50.2,
  lon: 8.5,
  tz_fachaufgabe: null,
  tz_organisation: null,
  ist_einheitsfuehrer: true,
  ist_abschnittsleiter: false,
};

const ORG_DRK = { id: 1, name: 'DRK', tz_organisation: 'hilfsorganisation' };

function basisHandler(
  extra: ReturnType<typeof http.get>[] = [],
  config: KarteServerConfig = {
    online_styles: [],
    offline_verfuegbar: false,
    offline_tiles_url: null,
    offline_attribution: null,
    // LFH-265: Pflichtfeld im generierten Schema — leere Liste = keine Region bereit.
    offline_regionen: [],
    karten_bau_verfuegbar: false,
  },
) {
  // extra ZUERST: MSW nimmt den ersten Treffer → Tests können einzelne GET-Defaults
  // (z. B. /einheiten) gezielt überschreiben, ohne die übrigen Defaults anzufassen.
  server.use(
    ...extra,
    http.get('/api/einsaetze/1', () => HttpResponse.json(EINSATZ)),
    http.get('/api/einsaetze/1/uhs', () => HttpResponse.json([UHS_NICHT_VERORTET])),
    http.get('/api/einsaetze/1/schaeden', () => HttpResponse.json([SCHADEN_VERORTET])),
    http.get('/api/einsaetze/1/einheiten', () => HttpResponse.json([])),
    http.get('/api/einsaetze/1/fahrzeuge', () => HttpResponse.json([])),
    http.get('/api/einsaetze/1/abschnitte', () => HttpResponse.json([])),
    http.get('/api/einsaetze/1/zonen', () => HttpResponse.json([])),
    http.get('/api/einsaetze/1/freie-zeichen', () => HttpResponse.json([])),
    http.get('/api/einsaetze/1/karte/fuehrungskraefte', () => HttpResponse.json([])),
    http.get('/api/einsaetze/1/lage/meldungen', () => HttpResponse.json([])),
    http.get('/api/organisation', () => HttpResponse.json({ id: 1, name: 'Org', tz_organisation: null })),
    http.get('/api/karte/config', () => HttpResponse.json(config)),
    http.get('/api/einsaetze/1/karte/hintergrundbilder', () => HttpResponse.json([])),
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

// URL-Sonde (LFH-155): spiegelt den aktuellen Query-String in ein data-testid, damit Tests
// die apply-then-clean-Bereinigung des Reverse-Deeplinks direkt an der URL beobachten können.
function LocationSonde() {
  const location = useLocation();
  return <div data-testid="location-search">{location.search}</div>;
}

function renderSeiteMitSonde(route: string) {
  return renderMitProviders(
    <>
      <Routes>
        <Route path="/einsaetze/:id/lagekarte" element={<LagekartePage />} />
      </Routes>
      <LocationSonde />
    </>,
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

  it('öffnet selbst KEINE SSE-Verbindung (der Live-Stream ist ins EinsatzLayout gehoben)', async () => {
    // Regression: zuvor öffnete die Seite 6 EventSources, dann eine eigene; seit LFH-97
    // besitzt das EinsatzLayout die EINE Verbindung pro Einsatz (HTTP/1.1-6-Limit). Die Seite
    // darf deshalb keine eigene mehr öffnen — sonst wieder zwei Verbindungen je sichtbarer Seite.
    basisHandler();
    renderSeite();
    expect(await screen.findByText('⚠ Nicht verortet')).toBeInTheDocument();
    expect(eventSourceUrls).toHaveLength(0);
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
    expect(link).toHaveAttribute('href', '/einsaetze/1/schaeden/9');
  });

  it('rendert freie taktische Zeichen als Marker (Datenpfad: Query → alleVerortet → sichtbar) (LFH-170)', async () => {
    basisHandler([
      http.get('/api/einsaetze/1/freie-zeichen', () =>
        HttpResponse.json([{
          id: 42, einsatz_id: 1, lat: 50.1, lon: 8.6, grundzeichen: 'stelle',
          organisation: null, fachaufgabe: null, symbol: null, einheit: null, funktion: null,
          farbe: null, label: 'Sammelplatz', erstellt_von: 1, erstellt_at: '', geaendert_at: '',
        }]),
      ),
    ]);
    renderSeite();
    expect(await screen.findByText('marker-freies_zeichen-42')).toBeInTheDocument();
  });

  it('Marker-Klick auf ein freies Zeichen öffnet den FreiesZeichenInspector (kein Fach-Modul-Link) (LFH-170)', async () => {
    basisHandler([
      http.get('/api/einsaetze/1/freie-zeichen', () =>
        HttpResponse.json([{
          id: 42, einsatz_id: 1, lat: 50.1, lon: 8.6, grundzeichen: 'stelle',
          organisation: null, fachaufgabe: null, symbol: null, einheit: null, funktion: null,
          farbe: null, label: 'Sammelplatz', erstellt_von: 1, erstellt_at: '', geaendert_at: '',
        }]),
      ),
    ]);
    const user = userEvent.setup();
    renderSeite();
    await user.click(await screen.findByText('marker-freies_zeichen-42'));
    // FreiesZeichenInspector: Picker mit vorbelegtem Grundzeichen; KEIN „Im Fach-Modul öffnen".
    expect(await screen.findByText('Stelle, Einrichtung')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Im Fach-Modul öffnen/ })).not.toBeInTheDocument();
  });

  it('Marker-Klick während Platzieren öffnet keinen Inspector und lässt den Platzier-Modus intakt (LFH-208)', async () => {
    // Doppel-Panel vermeiden: ein Map-Marker-Klick während aktiver Platzierung darf kein
    // Auswahl-Panel öffnen. Der Platzier-Modus bleibt intakt (nächster Karten-Klick verortet).
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
    await user.click(await screen.findByText('marker-schaden-9'));
    expect(screen.queryByRole('link', { name: /Im Fach-Modul öffnen/ })).not.toBeInTheDocument();
    // Platzier-Modus intakt: der nächste Karten-Klick verortet weiterhin.
    await user.click(screen.getByText('karte-klick'));
    await waitFor(() => expect(patchBody).toEqual({ lat: 50.1, lon: 8.6 }));
  });

  it('rendert verortete Lagemeldungen als Marker; Klick öffnet Inspector mit Backlink zur Quell-Meldung', async () => {
    basisHandler([
      http.get('/api/einsaetze/1/lage/meldungen', () => HttpResponse.json([LAGEMELDUNG_VERORTET])),
    ]);
    const user = userEvent.setup();
    renderSeite();
    await user.click(await screen.findByText('marker-lagemeldung-4'));
    // Kurzinfo der Meldung im Inspector + Rückverweis auf die Meldungen-Ansicht.
    expect(await screen.findByText('Florian Nord 1')).toBeInTheDocument();
    expect(screen.getByText('Brücke gesperrt')).toBeInTheDocument();
    const link = await screen.findByRole('link', { name: /Zur Quell-Meldung/ });
    // Deeplink auf die konkrete Quell-Meldung (LFH-25): meldung_id, nicht LageMeldung-id.
    expect(link).toHaveAttribute('href', '/einsaetze/1/meldungen?meldung=12');
    // Lagemeldungs-Marker sind kartenseitig read-only (Verorten nur beim Übergeben).
    expect(screen.queryByRole('button', { name: /Verortung löschen/ })).not.toBeInTheDocument();
  });

  it('Basemap-Umschalter: von Online auf Blind wechseln, Marker bleiben sichtbar', async () => {
    basisHandler([], {
      online_styles: [{ name: 'Online', url: 'https://x/style.json', typ: 'vektor', attribution: '© X' }],
      offline_verfuegbar: true,
      offline_tiles_url: '/api/karte/offline/tiles/{z}/{x}/{y}?v=abc',
      offline_attribution: null,
      offline_regionen: [],
      karten_bau_verfuegbar: false,
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
      online_styles: [{ name: 'Online', url: 'https://x/style.json', typ: 'vektor', attribution: '© X' }],
      offline_verfuegbar: true,
      offline_tiles_url: '/api/karte/offline/tiles/{z}/{x}/{y}?v=abc',
      offline_attribution: null,
      offline_regionen: [],
      karten_bau_verfuegbar: false,
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
      online_styles: [],
      offline_verfuegbar: true,
      offline_tiles_url: '/api/karte/offline/tiles/{z}/{x}/{y}?v=abc',
      offline_attribution: null,
      offline_regionen: [],
      karten_bau_verfuegbar: false,
    });
    renderSeite();
    await screen.findByText('marker-schaden-9');
    expect((screen.getByRole('radio', { name: 'Online' }) as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByRole('radio', { name: 'Offline' }) as HTMLInputElement).disabled).toBe(false);
    // defaultModus springt auf 'offline'
    expect((screen.getByRole('radio', { name: 'Offline' }) as HTMLInputElement).checked).toBe(true);
  });

  // --- L‑2: taktische Gliederung --------------------------------------------

  it('zeigt die taktischen Layer-Toggles und ein nicht-verortetes taktisches Objekt in der Liste', async () => {
    basisHandler([
      http.get('/api/einsaetze/1/einheiten', () => HttpResponse.json([EINHEIT_NICHT_VERORTET])),
      http.get('/api/organisation', () => HttpResponse.json(ORG_DRK)),
    ]);
    renderSeite();
    // Layer-Switch-Labels vorhanden (taktische Ebenen).
    expect(await screen.findByText('Einheiten')).toBeInTheDocument();
    expect(screen.getByText('Fahrzeuge')).toBeInTheDocument();
    expect(screen.getByText('Personal')).toBeInTheDocument(); // LFH-276: vormals „Personal-Führung"
    expect(screen.getByText('Abschnitte')).toBeInTheDocument();
    // Nicht-verortete Einheit erscheint mit korrektem Label in der Nicht-verortet-Liste.
    expect(await screen.findByText('Einheit: Zug 1')).toBeInTheDocument();
  });

  it('platziert eine Einheit: wählen → Karten-Klick → PATCH /position mit lat/lon', async () => {
    let body: unknown = null;
    basisHandler([
      http.get('/api/einsaetze/1/einheiten', () => HttpResponse.json([EINHEIT_NICHT_VERORTET])),
      http.patch('/api/einsaetze/1/einheiten/2/position', async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ ...EINHEIT_NICHT_VERORTET, lat: 50.1, lon: 8.6 });
      }),
    ]);
    const user = userEvent.setup();
    renderSeite();
    // Mehrere "Platzieren"-Buttons (UHS BHP 50 + Einheit Zug 1) → über das List-Item
    // der Einheit eindeutig treffen.
    const item = (await screen.findByText('Einheit: Zug 1')).closest('.listen-eintrag') as HTMLElement;
    await user.click(within(item).getByRole('button', { name: 'Platzieren' }));
    await user.click(await screen.findByText('karte-klick'));
    await waitFor(() => expect(body).toMatchObject({ lat: 50.1, lon: 8.6 }));
  });

  it('zeichnet eine Abschnittsfläche: Fläche zeichnen → fertig → PATCH /flaeche mit Polygon-GeoJSON', async () => {
    let body: { flaeche_geojson?: string } | null = null;
    basisHandler([
      http.get('/api/einsaetze/1/abschnitte', () => HttpResponse.json([ABSCHNITT_OHNE_FLAECHE])),
      http.patch('/api/einsaetze/1/abschnitte/3/flaeche', async ({ request }) => {
        body = (await request.json()) as { flaeche_geojson?: string };
        return HttpResponse.json({ ...ABSCHNITT_OHNE_FLAECHE, flaeche_geojson: body.flaeche_geojson });
      }),
    ]);
    const user = userEvent.setup();
    renderSeite();
    await user.click(await screen.findByRole('button', { name: 'Fläche zeichnen' }));
    // Der Stub blendet "flaeche-fertig" nur im aktiven Zeichenmodus ein.
    await user.click(await screen.findByText('flaeche-fertig'));
    await waitFor(() => expect(body).not.toBeNull());
    expect(typeof body!.flaeche_geojson).toBe('string');
    const poly = JSON.parse(body!.flaeche_geojson as string);
    expect(poly.type).toBe('Polygon');
    expect(Array.isArray(poly.coordinates)).toBe(true);
  });

  it('rendert verortetes Personal als taktische Zeichen (alle über karte/fuehrungskraefte, LFH-276)', async () => {
    basisHandler([
      http.get('/api/einsaetze/1/karte/fuehrungskraefte', () => HttpResponse.json([FUEHRUNGSKRAFT_VERORTET])),
    ]);
    renderSeite();
    // Verortetes Personal erzeugt marker-fuehrung-<id> (Marker-Typ bleibt 'fuehrung').
    expect(await screen.findByText('marker-fuehrung-7')).toBeInTheDocument();
    // Personal (inkl. Nicht-Führung, LFH-276) kommt ausschließlich über karte/fuehrungskraefte —
    // es gibt keinen separaten 'personal'-Markertyp. Stichprobe: kein marker-personal-*.
    expect(screen.queryByText(/^marker-personal-/)).not.toBeInTheDocument();
  });

  it('Marker-Klick auf eine verortete Einheit öffnet den Inspector mit Fach-Modul-Link', async () => {
    basisHandler([
      http.get('/api/einsaetze/1/einheiten', () => HttpResponse.json([EINHEIT_VERORTET])),
    ]);
    const user = userEvent.setup();
    renderSeite();
    await user.click(await screen.findByText('marker-einheit-1'));
    const link = await screen.findByRole('link', { name: /Im Fach-Modul öffnen/ });
    // Deeplink mit Listen-Selektion der Einheit (LFH-25).
    expect(link).toHaveAttribute('href', '/einsaetze/1/einheiten?einheit=1');
  });

  it('Online-Sub-Switcher: zwischen zwei Views wechseln aktualisiert die Attribution', async () => {
    basisHandler([], {
      online_styles: [
        { name: 'Liberty', url: 'https://x/liberty', typ: 'vektor', attribution: '© Liberty' },
        { name: 'TopPlus', url: 'https://x/{z}/{y}/{x}.png', typ: 'raster', attribution: '© BKG' },
      ],
      offline_verfuegbar: false,
      offline_tiles_url: null,
      offline_attribution: null,
      offline_regionen: [],
      karten_bau_verfuegbar: false,
    });
    const user = userEvent.setup();
    renderSeite();
    await screen.findByText('marker-schaden-9');
    // Default-View ist der erste (Liberty) → dessen Attribution liegt an.
    expect(screen.getByTestId('attribution')).toHaveTextContent('© Liberty');
    // Sub-Switcher (Select) öffnen und TopPlus wählen. Es gibt nur EINE Combobox auf der
    // Seite (Koordinatenformat-Select im Platzierungsmodus nicht aktiv) → Query ohne name eindeutig.
    // Option über `.ant-select-item-option` abgrenzen (etabliertes Muster, da der Text
    // auch im ausgewählten Selektor stehen kann).
    await user.click(screen.getByRole('combobox'));
    const option = (await screen.findAllByText('TopPlus')).find((el) =>
      el.closest('.ant-select-item-option'),
    );
    await user.click(option!);
    await waitFor(() => expect(screen.getByTestId('attribution')).toHaveTextContent('© BKG'));
  });

  // --- L‑3: Gefahren- & Absperrzonen ----------------------------------------

  it('zeichnet eine Polygon-Zone: Typ Gefahrengebiet → zeichnen → bestätigen → POST mit geometrie_typ Polygon', async () => {
    // LFH-145: onZoneGezeichnet persistiert nicht mehr direkt — erst „Speichern" in der
    // Bestätigungs-Phase löst den POST aus.
    let body: { typ?: string; geometrie_typ?: string; geometrie?: string } | null = null;
    basisHandler([
      http.post('/api/einsaetze/1/zonen', async ({ request }) => {
        body = (await request.json()) as typeof body;
        return HttpResponse.json({ id: 5, einsatz_id: 1, typ: body!.typ, geometrie_typ: body!.geometrie_typ, geometrie: body!.geometrie, label: null, farbe: null, notiz: null, erstellt_von: 1, erstellt_at: '', geaendert_at: '' });
      }),
    ]);
    const user = userEvent.setup();
    renderSeite();
    await user.click(await screen.findByRole('button', { name: 'Gefahrengebiet zeichnen' }));
    await user.click(await screen.findByText('zone-fertig'));
    await user.click(await screen.findByRole('button', { name: 'Speichern' }));
    await waitFor(() => expect(body).not.toBeNull());
    expect(body!.typ).toBe('gefahrengebiet');
    expect(body!.geometrie_typ).toBe('Polygon');
    expect(JSON.parse(body!.geometrie as string).type).toBe('Polygon');
  });

  it('zeichnet eine Linien-Zone: Absperrgrenze → zeichnen → bestätigen → POST mit geometrie_typ LineString', async () => {
    let body: { typ?: string; geometrie_typ?: string } | null = null;
    basisHandler([
      http.post('/api/einsaetze/1/zonen', async ({ request }) => {
        body = (await request.json()) as typeof body;
        return HttpResponse.json({ id: 6, einsatz_id: 1, typ: 'absperrgrenze', geometrie_typ: 'LineString', geometrie: '{}', label: null, farbe: null, notiz: null, erstellt_von: 1, erstellt_at: '', geaendert_at: '' });
      }),
    ]);
    const user = userEvent.setup();
    renderSeite();
    await user.click(await screen.findByRole('button', { name: 'Absperrgrenze zeichnen' }));
    await user.click(await screen.findByText('zone-fertig'));
    await user.click(await screen.findByRole('button', { name: 'Speichern' }));
    await waitFor(() => expect(body).not.toBeNull());
    expect(body!.typ).toBe('absperrgrenze');
    expect(body!.geometrie_typ).toBe('LineString');
  });

  it('öffnet den Inspector per Klick und ändert das Label (PATCH)', async () => {
    let patch: { label?: string } | null = null;
    const ZONE_FREI = { id: 7, einsatz_id: 1, typ: 'freie_skizze', geometrie_typ: 'Polygon',
      geometrie: '{"type":"Polygon","coordinates":[[[8.6,50.1],[8.7,50.1],[8.7,50.2],[8.6,50.1]]]}',
      label: 'Skizze', farbe: '#00ff00', notiz: null, erstellt_von: 1, erstellt_at: '', geaendert_at: '' };
    basisHandler([
      http.get('/api/einsaetze/1/zonen', () => HttpResponse.json([ZONE_FREI])),
      http.patch('/api/einsaetze/1/zonen/7', async ({ request }) => {
        patch = (await request.json()) as typeof patch;
        return HttpResponse.json({ ...ZONE_FREI, label: patch!.label });
      }),
    ]);
    const user = userEvent.setup();
    renderSeite();
    await user.click(await screen.findByText('zone-7'));
    const labelInput = await screen.findByLabelText('Label');
    await user.clear(labelInput);
    await user.type(labelInput, 'Neu');
    await user.tab(); // onBlur löst PATCH aus
    await waitFor(() => expect(patch).not.toBeNull());
    expect(patch!.label).toBe('Neu');
  });

  it('Reverse-Deeplink ?gefahrengebiet= selektiert die zugehörige Zone (LFH-155)', async () => {
    const ZONE_GG = {
      id: 7, einsatz_id: 1, typ: 'gefahrengebiet', geometrie_typ: 'Polygon',
      geometrie: '{"type":"Polygon","coordinates":[[[8.6,50.1],[8.7,50.1],[8.7,50.2],[8.6,50.1]]]}',
      label: 'GG-Zone', farbe: null, notiz: null, gefahrengebiet_id: 10,
      erstellt_von: 1, erstellt_at: '', geaendert_at: '',
    };
    const GEBIET = { id: 10, einsatz_id: 1, label: 'Nord', zonen_ids: [7], hoechste_warnstufe: 'keine' };
    basisHandler([
      http.get('/api/einsaetze/1/zonen', () => HttpResponse.json([ZONE_GG])),
      http.get('/api/einsaetze/1/gefahrengebiete', () => HttpResponse.json([GEBIET])),
    ]);
    renderSeite('/einsaetze/1/lagekarte?gefahrengebiet=10');
    // Der ZonenInspector der zugehörigen Zone öffnet sich (Gefahrengebiet-Gruppen-Select).
    expect(await screen.findByLabelText('Gehört zu Gefahrengebiet')).toBeInTheDocument();
  });

  it('Reverse-Deeplink ?gefahrengebiet=: räumt den Param aus der URL (apply-then-clean) und die Selektion bleibt bestehen (LFH-155)', async () => {
    const ZONE_GG = {
      id: 7, einsatz_id: 1, typ: 'gefahrengebiet', geometrie_typ: 'Polygon',
      geometrie: '{"type":"Polygon","coordinates":[[[8.6,50.1],[8.7,50.1],[8.7,50.2],[8.6,50.1]]]}',
      label: 'GG-Zone', farbe: null, notiz: null, gefahrengebiet_id: 10,
      erstellt_von: 1, erstellt_at: '', geaendert_at: '',
    };
    const GEBIET = { id: 10, einsatz_id: 1, label: 'Nord', zonen_ids: [7], hoechste_warnstufe: 'keine' };
    basisHandler([
      http.get('/api/einsaetze/1/zonen', () => HttpResponse.json([ZONE_GG])),
      http.get('/api/einsaetze/1/gefahrengebiete', () => HttpResponse.json([GEBIET])),
    ]);
    renderSeiteMitSonde('/einsaetze/1/lagekarte?gefahrengebiet=10');
    // Zone selektiert → Inspector offen (Sonde startet mit ?gefahrengebiet=10, siehe unten).
    expect(await screen.findByLabelText('Gehört zu Gefahrengebiet')).toBeInTheDocument();
    // apply-then-clean: der Param ist nach dem Anwenden aus der URL geräumt (delete + replace).
    await waitFor(() =>
      expect(screen.getByTestId('location-search')).not.toHaveTextContent('gefahrengebiet'),
    );
    // Idempotenz (StrictMode-fest via new URLSearchParams): der erneute Effekt-Lauf mit
    // geräumtem Param selektiert NICHT erneut / überschreibt nichts — die Selektion bleibt.
    expect(screen.getByLabelText('Gehört zu Gefahrengebiet')).toBeInTheDocument();
  });

  it('hebt eine Zone auf (DELETE)', async () => {
    let geloescht = false;
    const ZONE_FREI = { id: 7, einsatz_id: 1, typ: 'freie_skizze', geometrie_typ: 'Polygon',
      geometrie: '{"type":"Polygon","coordinates":[[[8.6,50.1],[8.7,50.1],[8.7,50.2],[8.6,50.1]]]}',
      label: 'Skizze', farbe: '#00ff00', notiz: null, erstellt_von: 1, erstellt_at: '', geaendert_at: '' };
    basisHandler([
      http.get('/api/einsaetze/1/zonen', () => HttpResponse.json([ZONE_FREI])),
      http.delete('/api/einsaetze/1/zonen/7', () => { geloescht = true; return new HttpResponse(null, { status: 204 }); }),
    ]);
    const user = userEvent.setup();
    renderSeite();
    await user.click(await screen.findByText('zone-7'));
    await user.click(await screen.findByRole('button', { name: 'Zone aufheben' }));
    await waitFor(() => expect(geloescht).toBe(true));
  });

  // --- Bild-Hintergründe -------------------------------------------------------

  it('Smoke: Bild in der Liste → Blob-URL wird geladen → BildOverlay landet an Kartenflaeche', async () => {
    const BILD = {
      id: 3,
      einsatz_id: 1,
      name: 'lageplan.png',
      mime: 'image/png',
      groesse: 12345,
      ecken_json: JSON.stringify([[9.0, 50.0], [9.1, 50.0], [9.1, 49.9], [9.0, 49.9]]),
      opazitaet: 80,
      sichtbar: true,
      reihenfolge: 1,
      hochgeladen_von: 1,
      erstellt_at: '',
      geaendert_at: '',
    };
    basisHandler([
      http.get('/api/einsaetze/1/karte/hintergrundbilder', () => HttpResponse.json([BILD])),
      http.get('/api/einsaetze/1/karte/hintergrundbilder/3/download', () =>
        new HttpResponse(new Blob(['pixeldata'], { type: 'image/png' }), {
          status: 200,
          headers: { 'Content-Type': 'image/png' },
        }),
      ),
    ]);
    renderSeite();
    // Wenn Blob-URL geladen → bilder-count an Kartenflaeche steigt auf 1.
    await waitFor(() => {
      expect(screen.getByTestId('bilder-count')).toHaveTextContent('1');
    });
  });

  it('Refetch mit weiterhin vorhandenem Bild: bestehende Blob-URL wird NICHT revoked, nur neue geladen; entferntes Bild wird revoked', async () => {
    // Regression LFH-35 (C1): Der Cleanup des Blob-URL-Effekts läuft vor JEDEM Re-Run
    // (jedes Refetch der Bilderliste). Ein pauschales revoke aller URLs würde bestehende,
    // weiterhin aktive Bilder unbrauchbar machen (und der Guard verhinderte ein Neuladen).
    // Dieser Test BEWEIST, dass ein Refetch, in dem Bild A erhalten bleibt, A's URL NICHT
    // revoked — und dass ein Refetch, in dem A entfernt ist, A's URL doch revoked.
    const erstelle = vi.mocked(URL.createObjectURL as (b: Blob) => string);
    const revoke = vi.mocked(URL.revokeObjectURL as (u: string) => void);
    erstelle.mockReset();
    revoke.mockReset();
    // Distinkte URLs je Aufruf (Reihenfolge: A=erster, B=zweiter), damit wir A's URL
    // gezielt prüfen können. Der globale Stub liefert sonst für alle denselben String.
    let n = 0;
    erstelle.mockImplementation(() => `blob:url-${++n}`);

    const bild = (id: number, name: string) => ({
      id,
      einsatz_id: 1,
      name,
      mime: 'image/png',
      groesse: 12345,
      ecken_json: JSON.stringify([[9.0, 50.0], [9.1, 50.0], [9.1, 49.9], [9.0, 49.9]]),
      opazitaet: 80,
      sichtbar: true,
      reihenfolge: 1,
      hochgeladen_von: 1,
      erstellt_at: '',
      geaendert_at: '',
    });
    const A = bild(3, 'a.png');
    const B = bild(4, 'b.png');

    let bilderListe = [A];
    basisHandler([
      http.get('/api/einsaetze/1/karte/hintergrundbilder', () => HttpResponse.json(bilderListe)),
      // Beide Downloads liefern Pixeldaten — die konkrete id steckt im Pfad.
      http.get('/api/einsaetze/1/karte/hintergrundbilder/:bildId/download', () =>
        new HttpResponse(new Blob(['pixeldata'], { type: 'image/png' }), {
          status: 200,
          headers: { 'Content-Type': 'image/png' },
        }),
      ),
    ]);
    const { client, unmount } = renderSeite();

    // revoke wird via Array.forEach(URL.revokeObjectURL) aufgerufen → Mock zeichnet auch
    // (index, array) als weitere Argumente auf. Daher gegen das ERSTE Argument prüfen.
    const wurdeRevoked = (url: string) => revoke.mock.calls.some((c) => c[0] === url);

    // 1) A geladen → genau ein createObjectURL-Aufruf (A's URL).
    await waitFor(() => expect(screen.getByTestId('bilder-count')).toHaveTextContent('1'));
    expect(erstelle).toHaveBeenCalledTimes(1);
    const urlVonA = 'blob:url-1';

    // 2) Refetch mit erweiterter Liste [A, B] (Längenänderung → garantiert neue Array-Ref →
    //    Effekt läuft erneut, inkl. Cleanup des vorherigen Laufs).
    bilderListe = [A, B];
    await client.invalidateQueries({ queryKey: ['einsatz-kartenbilder', 1] });

    // B wird geladen → zwei Overlays.
    await waitFor(() => expect(screen.getByTestId('bilder-count')).toHaveTextContent('2'));
    // Diskriminierende Assertion (schlägt gegen den kaputten Pauschal-Revoke fehl):
    // A's weiterhin aktive URL darf beim Refetch NICHT freigegeben worden sein.
    expect(revoke).not.toHaveBeenCalled();
    // A wurde NICHT erneut geladen (Guard greift korrekt): genau A + B, kein Doppel-Load von A.
    expect(erstelle).toHaveBeenCalledTimes(2);

    // 3) Refetch mit entferntem A (nur noch B) → A's URL wird inkrementell revoked.
    bilderListe = [B];
    await client.invalidateQueries({ queryKey: ['einsatz-kartenbilder', 1] });
    await waitFor(() => expect(screen.getByTestId('bilder-count')).toHaveTextContent('1'));
    await waitFor(() => expect(wurdeRevoked(urlVonA)).toBe(true));
    // Kein weiterer Load durch das Entfernen.
    expect(erstelle).toHaveBeenCalledTimes(2);

    // 4) Unmount (Navigation weg von der Karte) → der separate Unmount-Effekt gibt die
    //    dann noch aktive URL (B = 'blob:url-2') frei (Leak-Schutz bleibt erhalten).
    expect(wurdeRevoked('blob:url-2')).toBe(false);
    unmount();
    expect(wurdeRevoked('blob:url-2')).toBe(true);
  });
});

// --- LFH-145: Zwei-Phasen-Zeichnen (Overlay + Speicher-Bestätigung) ----------

/** msw-POST-Handler für /zonen, der Aufrufe zählt und den letzten Body aufzeichnet
 * (Ersatz für den Platzhalter `spyLegeZoneAn` aus dem Task-Brief). */
function erstelleZonenPostSpy() {
  let anzahl = 0;
  let letzterBody: { typ?: string; geometrie_typ?: string; geometrie?: string } | null = null;
  const handler = http.post('/api/einsaetze/1/zonen', async ({ request }) => {
    anzahl += 1;
    letzterBody = (await request.json()) as typeof letzterBody;
    return HttpResponse.json({
      id: 5, einsatz_id: 1, typ: letzterBody!.typ, geometrie_typ: letzterBody!.geometrie_typ,
      geometrie: letzterBody!.geometrie, label: null, farbe: null, notiz: null,
      erstellt_von: 1, erstellt_at: '', geaendert_at: '',
    });
  });
  return { handler, count: () => anzahl, lastBody: () => letzterBody! };
}

describe('LFH-145: Zeichnen-Abschluss + Bestätigung', () => {
  it('Zone zeichnen → Overlay „zeichnen" sichtbar', async () => {
    basisHandler();
    const user = userEvent.setup();
    renderSeite();
    await user.click(await screen.findByRole('button', { name: 'Gefahrengebiet zeichnen' }));
    expect(await screen.findByText('Gefahrengebiet · Fläche')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Abschließen' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Abbrechen' })).toBeInTheDocument();
  });

  it('nach Abschluss (Stub) → Phase „bestaetigen", noch NICHT persistiert', async () => {
    const spy = erstelleZonenPostSpy();
    basisHandler([spy.handler]);
    const user = userEvent.setup();
    renderSeite();
    await user.click(await screen.findByRole('button', { name: 'Gefahrengebiet zeichnen' }));
    await user.click(await screen.findByText('zone-fertig'));
    expect(await screen.findByRole('button', { name: 'Speichern' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Verwerfen' })).toBeInTheDocument();
    expect(spy.count()).toBe(0);
  });

  it('Speichern → POST /zonen mit der Geometrie', async () => {
    const spy = erstelleZonenPostSpy();
    basisHandler([spy.handler]);
    const user = userEvent.setup();
    renderSeite();
    await user.click(await screen.findByRole('button', { name: 'Gefahrengebiet zeichnen' }));
    await user.click(await screen.findByText('zone-fertig'));
    await user.click(await screen.findByRole('button', { name: 'Speichern' }));
    await waitFor(() => expect(spy.count()).toBe(1));
    expect(spy.lastBody().typ).toBe('gefahrengebiet');
  });

  it('Verwerfen → kein POST, Overlay weg', async () => {
    const spy = erstelleZonenPostSpy();
    basisHandler([spy.handler]);
    const user = userEvent.setup();
    renderSeite();
    await user.click(await screen.findByRole('button', { name: 'Gefahrengebiet zeichnen' }));
    await user.click(await screen.findByText('zone-fertig'));
    await user.click(await screen.findByRole('button', { name: 'Verwerfen' }));
    expect(spy.count()).toBe(0);
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Speichern' })).not.toBeInTheDocument());
  });

  it('Abbrechen in Phase zeichnen → kein POST, Overlay weg', async () => {
    const spy = erstelleZonenPostSpy();
    basisHandler([spy.handler]);
    const user = userEvent.setup();
    renderSeite();
    await user.click(await screen.findByRole('button', { name: 'Gefahrengebiet zeichnen' }));
    await user.click(await screen.findByRole('button', { name: 'Abbrechen' }));
    expect(spy.count()).toBe(0);
    await waitFor(() => expect(screen.queryByText('Gefahrengebiet · Fläche')).not.toBeInTheDocument());
  });

  it('neuer Zeichenstart während offener Bestätigung räumt die alte Bestätigung weg (kein hängendes Overlay)', async () => {
    // Regression Step 3f: Gefahrengebiet fertigzeichnen (→ Bestätigung), dann OHNE zu
    // speichern/verwerfen einen anderen Zone-Typ starten. Die alte Bestätigung (Speichern/
    // Verwerfen für die Gefahrengebiet-Geometrie) darf nicht hängen bleiben.
    const spy = erstelleZonenPostSpy();
    basisHandler([spy.handler]);
    const user = userEvent.setup();
    renderSeite();
    await user.click(await screen.findByRole('button', { name: 'Gefahrengebiet zeichnen' }));
    await user.click(await screen.findByText('zone-fertig'));
    expect(await screen.findByRole('button', { name: 'Speichern' })).toBeInTheDocument();

    await user.click(await screen.findByRole('button', { name: 'Absperrgrenze zeichnen' }));
    // Zurück in Phase „zeichnen" für den NEUEN Entwurf, keine hängende Bestätigung mehr.
    expect(screen.queryByRole('button', { name: 'Speichern' })).not.toBeInTheDocument();
    expect(await screen.findByText('Absperrgrenze · Linie')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Abschließen' })).toBeInTheDocument();
    expect(spy.count()).toBe(0);
  });
});
