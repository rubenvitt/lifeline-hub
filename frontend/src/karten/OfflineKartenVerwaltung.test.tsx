import { http, HttpResponse } from 'msw';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import { AuthProvider } from '../auth/AuthContext';
import type { BauJob, OfflineKarte, OfflineKatalogEintrag } from '../api/offlineKarten';
import OfflineKartenVerwaltung from './OfflineKartenVerwaltung';

const admin = {
  id: 1, anzeigename: 'Admin', benutzername: 'admin', system_rolle: 'admin',
  org_rolle: 'keine', aktiv: true, erstellt_at: '2026-06-26 10:00:00',
};
const fuehrungskraft = {
  ...admin, id: 2, anzeigename: 'Eva', system_rolle: 'keiner', org_rolle: 'fuehrungskraft',
};

const karte: OfflineKarte = {
  id: 1, name: 'Deutschland – Bremen', pfad: 'karte-1.mbtiles',
  quell_url: 'https://example.test/de_bremen.mbtiles', lizenz: '© OpenStreetMap contributors (ODbL)',
  kachel_schema: 'shortbread', format: 'pbf', groesse: 44040192, sha256: 'abc', download_at: '2026-06-26 11:00:00',
  // LFH-265: `update_verfuegbar` ist Pflichtfeld — das Backend berechnet es für jede Zeile.
  status: 'bereit', aktiv_basemap: false, sortier: 0, update_verfuegbar: false,
};

const karteLaedt: OfflineKarte = {
  ...karte, id: 2, name: 'Deutschland – Bayern', status: 'laedt',
  groesse: null, sha256: null, download_at: null, aktiv_basemap: false, pfad: '',
};

const katalogEintrag = {
  name: 'Deutschland – Bremen', url: 'https://example.test/de_bremen.mbtiles', region: 'DE/Bremen',
  groesse: 44040192, lizenz: '© OpenStreetMap contributors (ODbL)', kachel_schema: 'shortbread',
  quelle: 'Project N.O.M.A.D.', sha256: 'cafef00d',
};

function mockBasis(
  benutzer: typeof admin,
  karten: OfflineKarte[] = [karte],
  katalog: OfflineKatalogEintrag[] = [katalogEintrag],
  optionen: { bauVerfuegbar?: boolean; bauJobs?: BauJob[] } = {},
) {
  const { bauVerfuegbar = false, bauJobs = [] } = optionen;
  server.use(
    http.get('/api/auth/me', () => HttpResponse.json(benutzer)),
    http.get('/api/karte/offline-karten', () => HttpResponse.json(karten)),
    http.get('/api/karte/offline-karten/katalog', () => HttpResponse.json(katalog)),
    // Feature-Gate + Bau-UI-Endpunkte (LFH-203, B5) — standardmäßig aus, damit alle
    // Bestandstests unverändert grün bleiben (die Config-Query feuert jetzt bei jedem Mount).
    http.get('/api/karte/config', () =>
      HttpResponse.json({
        online_styles: [],
        offline_verfuegbar: false,
        offline_tiles_url: null,
        offline_attribution: null,
        karten_bau_verfuegbar: bauVerfuegbar,
      }),
    ),
    http.get('/api/karte/offline-karten/baubare-regionen', () => HttpResponse.json([])),
    http.get('/api/karte/offline-karten/bau-status', () => HttpResponse.json(bauJobs)),
  );
}

function render() {
  return renderMitProviders(
    <AuthProvider>
      <OfflineKartenVerwaltung />
    </AuthProvider>,
  );
}

describe('OfflineKartenVerwaltung', () => {
  it('zeigt die Offline-Karten (Name/Status/Größe/Attribution)', async () => {
    mockBasis(admin);
    render();
    expect(await screen.findByText('Deutschland – Bremen')).toBeInTheDocument();
    expect(screen.getByText('bereit')).toBeInTheDocument();
    expect(screen.getByText('42.0 MB')).toBeInTheDocument();
    expect(screen.getByText('© OpenStreetMap contributors (ODbL)')).toBeInTheDocument();
  });

  // ── Ordnung der Katalogtabelle (LFH-330 · AP5) ──────────────────────────────────
  // Geprüft wird durchweg die WIRKUNG auf die Zeilenmenge, nicht die Anwesenheit eines
  // Props. Die stehende Kopfzeile schiebt eine verborgene Messzeile als erste Körperzeile
  // ein — deshalb überall die Verengung auf `tr.ant-table-row`.

  /** Kleiner als die Vorgabe (42,0 MB) und alphabetisch davor — beide Achsen sind messbar. */
  const kleineKarte: OfflineKarte = {
    ...karte, id: 3, name: 'Deutschland – Bayern', groesse: 9_500_000, pfad: 'karte-3.mbtiles',
  };
  /** Registriert, aber noch nicht geladen: `groesse: null` heißt UNBEKANNT, nicht null Bytes. */
  const ohneGroesse: OfflineKarte = {
    ...karte, id: 4, name: 'Deutschland – Saarland', groesse: null, status: 'registriert',
    pfad: '', sha256: null, download_at: null,
  };

  it('sortiert nach Größe und engt per Suche ein', async () => {
    mockBasis(admin, [karte, kleineKarte, ohneGroesse]);
    const { container } = render();
    await screen.findByText('Deutschland – Bremen');
    const namen = () =>
      Array.from(container.querySelectorAll('tr.ant-table-row td:first-child')).map(
        (z) => z.textContent,
      );

    // Voreinstellung ist die gelieferte Reihenfolge (Backend: ORDER BY sortier, id) — die
    // Vorgabe steht bewusst weder nach Größe noch alphabetisch, sonst wäre die Zusicherung
    // stumpf und ein versehentliches `defaultSortOrder` bliebe unbemerkt.
    expect(namen()).toEqual([
      'Deutschland – Bremen', 'Deutschland – Bayern', 'Deutschland – Saarland',
    ]);

    // Aufsteigend nach Bytes: 9,5 MB vor 42,0 MB. Über die formatierte Zeichenkette
    // sortiert stünde „9.1 MB" hinter „42.0 MB" — genau das fängt dieser Klick.
    //
    // Die unbekannte Größe steht VORNE, nicht hinten: sie ist das Gegenteil einer großen
    // Datei. Diese Zusicherung ist der einzige Ort, an dem die Ersatzzahl des Sorters
    // überhaupt gemessen wird — sie unterscheidet `?? -1` allerdings NICHT von `?? 0`
    // (beide liegen unter jeder echten Größe); sie fängt die Umkehrung (`?? Infinity` und
    // Geschwister) und den Absturz auf `null`.
    await userEvent.click(screen.getByRole('columnheader', { name: /Größe/ }));
    await waitFor(() =>
      expect(namen()).toEqual([
        'Deutschland – Saarland', 'Deutschland – Bayern', 'Deutschland – Bremen',
      ]),
    );

    await userEvent.type(screen.getByPlaceholderText('Name oder Attribution'), 'Bremen');
    await waitFor(() => expect(namen()).toEqual(['Deutschland – Bremen']));
  });

  it('der Statusfilter verkleinert die Zeilenmenge auf die gewählte Kategorie', async () => {
    mockBasis(admin, [karte, karteLaedt]);
    const { container } = render();
    await screen.findByText('Deutschland – Bremen');
    const zeilen = () => container.querySelectorAll('tr.ant-table-row');
    expect(zeilen()).toHaveLength(2);

    // Erst den Griff belegen, dann klicken: sonst meldete die Probe (Filter entfernt) ein
    // leeres Filtermenü statt den fehlenden Auslöser. „Status" ist die einzige Spalte mit
    // Filter, der Auslöser ist damit eindeutig.
    const ausloeser = container.querySelector<HTMLElement>('.ant-table-filter-trigger');
    expect(ausloeser, 'die Statusspalte muss einen Filter tragen').not.toBeNull();
    await userEvent.click(ausloeser!);

    // Das Filtermenü hängt in einem Portal an `document.body`, nicht im Container — und
    // „bereit" steht zu diesem Zeitpunkt auch als Etikett in der ersten Zeile. Der Griff
    // muss deshalb IM Menü erfolgen, sonst ist er mehrdeutig.
    const menue = await waitFor(() => {
      const m = document.querySelector<HTMLElement>('.ant-table-filter-dropdown');
      expect(m).not.toBeNull();
      return m!;
    });
    await userEvent.click(within(menue).getByText('lädt'));
    await userEvent.click(within(menue).getByRole('button', { name: 'OK' }));

    await waitFor(() => expect(zeilen()).toHaveLength(1));
    expect(zeilen()[0].textContent).toContain('Deutschland – Bayern');
  });

  it('der Drahtwert der Statusspalte bleibt außerhalb der Freitextsuche', async () => {
    /**
     * Die Kehrseite des fehlenden `dataIndex` an der Statusspalte, und der Grund, warum sie
     * einen Filter trägt. Zwei Ausfälle hängen an dieser Zusicherung:
     *
     * - `dataIndex: 'status'` wieder gesetzt → der Drahtwert „laedt" landet im Suchkorpus.
     *   Ein Wort, das niemand tippt, weil die Zelle „lädt" zeigt.
     * - `dataIndex` weg, `render` aber nicht nachgezogen → das erste Render-Argument ist der
     *   DATENSATZ statt des Status, `STATUS_TAG[…]` wird `undefined` und die Zeile stürzt ab.
     *   Der laut scheiternde der beiden Fälle; die Kontrollsuche unten deckt ihn mit ab.
     */
    mockBasis(admin, [karte, karteLaedt]);
    const { container } = render();
    await screen.findByText('Deutschland – Bremen');
    const zeilen = () => container.querySelectorAll('tr.ant-table-row');
    expect(zeilen()).toHaveLength(2);
    // Menschenlesbares Etikett statt Drahtwert — über den Text, nie über die Farbklasse.
    expect(zeilen()[1].textContent).toContain('lädt');

    const feld = screen.getByPlaceholderText('Name oder Attribution');
    await userEvent.type(feld, 'laedt');
    await waitFor(() => expect(zeilen()).toHaveLength(0));

    // Kontrolle: die Suche greift überhaupt — ohne sie wäre die Null oben auch mit einer
    // kaputten Suche zu haben.
    await userEvent.clear(feld);
    await userEvent.type(feld, 'Bayern');
    await waitFor(() => expect(zeilen()).toHaveLength(1));
  });

  it('Admin sieht Download- und Zeilen-Aktionen', async () => {
    mockBasis(admin);
    render();
    await screen.findByText('Deutschland – Bremen');
    expect(screen.getByRole('button', { name: 'Region aufs Gerät bringen' })).toBeInTheDocument();
    // Spezialfälle (Per-URL / lokale Datei) sind unter „Erweitert" demoted (LFH-206).
    expect(screen.getByRole('button', { name: /Erweitert/ })).toBeInTheDocument();
    // bereit → wird gemeinsam angezeigt (LFH-188, kein manuelles Aktivieren mehr).
    expect(screen.getByText('wird angezeigt')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Löschen' })).toBeInTheDocument();
  });

  it('Gebaute Region übernehmen (unter „Erweitert"): listet vorhandene Datei und registriert sie lokal', async () => {
    let regBody: { name: string; pfad: string } | undefined;
    mockBasis(admin, []);
    server.use(
      http.get('/api/karte/offline-karten/vorhandene', () =>
        HttpResponse.json([{ dateiname: 'osm.bremen.2026-07-02.mbtiles', groesse: 11_600_000 }]),
      ),
      http.post('/api/karte/offline-karten', async ({ request }) => {
        regBody = (await request.json()) as { name: string; pfad: string };
        return HttpResponse.json({ ...karte, id: 5, name: regBody.name }, { status: 201 });
      }),
    );
    render();
    await userEvent.click(await screen.findByRole('button', { name: /Erweitert/ }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Gebaute Region übernehmen' }));
    // Default-Name aus dem Dateinamen abgeleitet (osm.-Präfix + Datum entfernt).
    expect(await screen.findByDisplayValue('bremen')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Übernehmen' }));
    await waitFor(() => {
      expect(regBody?.pfad).toBe('osm.bremen.2026-07-02.mbtiles');
      expect(regBody?.name).toBe('bremen');
    });
  });

  it('Führungskraft sieht keine Schreibaktionen (read-only)', async () => {
    mockBasis(fuehrungskraft);
    render();
    await screen.findByText('Deutschland – Bremen');
    expect(screen.queryByRole('button', { name: 'Region aufs Gerät bringen' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Aktivieren' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Löschen' })).not.toBeInTheDocument();
  });

  it('lädt-Zustand: zeigt Abbrechen, kein Aktivieren/Löschen', async () => {
    mockBasis(admin, [karteLaedt]);
    render();
    await screen.findByText('Deutschland – Bayern');
    expect(screen.getByText('lädt')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Abbrechen' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Aktivieren' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Löschen' })).not.toBeInTheDocument();
  });

  it('lädt-Zustand mit Fortschritt: zeigt Prozent-Balken aus geladen/gesamt', async () => {
    mockBasis(admin, [{ ...karteLaedt, geladen: 22020096, gesamt: 44040192 }]);
    render();
    await screen.findByText('Deutschland – Bayern');
    // antd Progress rendert den Prozentwert (50 %) als Text.
    expect(await screen.findByText('50%')).toBeInTheDocument();
  });

  it('Update verfügbar: zeigt Hinweis + Datenstand + Aktualisieren-Button', async () => {
    mockBasis(admin, [{
      ...karte,
      quell_url: 'https://example.test/de_bremen_20250101.mbtiles',
      update_verfuegbar: true,
      katalog_url: 'https://example.test/de_bremen_20260320.mbtiles',
    }]);
    render();
    await screen.findByText('Deutschland – Bremen');
    expect(screen.getByText('Update verfügbar')).toBeInTheDocument();
    expect(screen.getByText('Stand 2025-01-01')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Aktualisieren' })).toBeInTheDocument();
  });

  it('Aktualisieren lädt die neuere Katalog-URL (One-Click: Pin + ersetzt_karte_id)', async () => {
    let postBody: unknown = null;
    mockBasis(admin, [{
      ...karte,
      quell_url: 'https://example.test/de_bremen_20250101.mbtiles',
      update_verfuegbar: true,
      katalog_url: 'https://example.test/de_bremen_20260320.mbtiles',
      katalog_sha256: 'cafef00d',
    }]);
    server.use(
      http.post('/api/karte/offline-karten/download', async ({ request }) => {
        postBody = await request.json();
        return HttpResponse.json({ ...karte, status: 'laedt' }, { status: 202 });
      }),
    );
    render();
    await userEvent.click(await screen.findByRole('button', { name: 'Aktualisieren' }));
    await waitFor(() => expect(postBody).not.toBeNull());
    expect(postBody).toMatchObject({
      name: 'Deutschland – Bremen',
      url: 'https://example.test/de_bremen_20260320.mbtiles',
      sha256_erwartet: 'cafef00d',
      ersetzt_karte_id: 1,
      groesse_erwartet: 44040192,
    });
  });

  it('aktive Karte mit Update: In-Place „Neu laden" statt „Aktualisieren" (POST /{id}/neu-laden)', async () => {
    let postBody: unknown = null;
    mockBasis(admin, [{
      ...karte,
      aktiv_basemap: true,
      quell_url: 'https://example.test/de_bremen_20250101.mbtiles',
      update_verfuegbar: true,
      katalog_url: 'https://example.test/de_bremen_20260320.mbtiles',
      katalog_sha256: 'cafef00d',
    }]);
    server.use(
      http.post('/api/karte/offline-karten/1/neu-laden', async ({ request }) => {
        postBody = await request.json();
        return HttpResponse.json({ ...karte, aktiv_basemap: true }, { status: 202 });
      }),
    );
    render();
    // Aktive Karte → In-Place-„Neu laden", NICHT „Aktualisieren" (neue Zeile).
    await userEvent.click(await screen.findByRole('button', { name: 'Neu laden' }));
    expect(screen.queryByRole('button', { name: 'Aktualisieren' })).not.toBeInTheDocument();
    await waitFor(() => expect(postBody).not.toBeNull());
    expect(postBody).toEqual({
      url: 'https://example.test/de_bremen_20260320.mbtiles',
      sha256_erwartet: 'cafef00d',
      groesse_erwartet: 44040192,
    });
  });

  it('In-Place-Reload: aktive „bereit"-Zeile zeigt Balken + „aktualisiert", nur Abbrechen (laeuft-Guard)', async () => {
    mockBasis(admin, [{
      ...karte, aktiv_basemap: true, status: 'bereit', geladen: 22020096, gesamt: 44040192,
      // update_verfuegbar+katalog_url gesetzt, damit die Abwesenheit von „Neu laden" den laeuft-Guard
      // der Aktionen-Spalte prüft (nicht bloß fehlende Update-Felder → sonst wäre die Assertion vakuum).
      update_verfuegbar: true, katalog_url: 'https://example.test/de_bremen_20260320.mbtiles',
    }]);
    render();
    await screen.findByText('Deutschland – Bremen');
    // Zeile bleibt „bereit"+aktiv, zeigt aber Reload-Fortschritt (50 %) + Label „aktualisiert".
    expect(await screen.findByText('50%')).toBeInTheDocument();
    expect(screen.getByText('aktualisiert')).toBeInTheDocument();
    // Während des Reloads: nur Abbrechen — kein Neu laden/Löschen/Aktivieren (laeuft-Guard).
    expect(screen.getByRole('button', { name: 'Abbrechen' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Neu laden' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Löschen' })).not.toBeInTheDocument();
  });

  it('Abbrechen ruft den Abbrechen-Endpunkt', async () => {
    let abgebrochen = false;
    mockBasis(admin, [karteLaedt]);
    server.use(
      http.post('/api/karte/offline-karten/2/abbrechen', () => {
        abgebrochen = true;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    render();
    await userEvent.click(await screen.findByRole('button', { name: 'Abbrechen' }));
    await waitFor(() => expect(abgebrochen).toBe(true));
  });

  it('URL-Download: Modal-Submit → POST /download mit kachel_schema shortbread', async () => {
    let postBody: unknown = null;
    mockBasis(admin, []);
    server.use(
      http.post('/api/karte/offline-karten/download', async ({ request }) => {
        postBody = await request.json();
        return HttpResponse.json({ ...karte, status: 'laedt' }, { status: 202 });
      }),
    );
    render();
    await userEvent.click(await screen.findByRole('button', { name: /Erweitert/ }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Per URL herunterladen' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText('Name'), 'Eigener Extrakt');
    await userEvent.type(within(dialog).getByLabelText('URL'), 'https://example.test/de.mbtiles');
    await userEvent.type(within(dialog).getByLabelText('Attribution / Lizenz'), '© OSM');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Download starten' }));

    await waitFor(() => expect(postBody).not.toBeNull());
    expect(postBody).toEqual({
      name: 'Eigener Extrakt',
      url: 'https://example.test/de.mbtiles',
      lizenz: '© OSM',
      kachel_schema: 'shortbread',
    });
  });

  /**
   * Das Partnerpaar zu AK4 (LFH-331 · B3). Die negative Hälfte allein belegte nichts:
   * formulierte jemand den Leertext um, wäre sie auch im Leerfall trivial grün. Erst die
   * positive Hälfte darunter — gleiches Literal, gleiche Datei — macht daraus eine Aussage
   * über die Zustandsweiche statt über die Schreibweise eines Strings.
   *
   * Meldung UND Detailzeile werden als exakte Literale gegriffen: hier wurde eine
   * handgerollte Geschwister-Meldung auf das Primitiv umgestellt, und der Umbau ist nur dann
   * kein Rückschritt, wenn beide Zeilen byte-gleich stehen bleiben.
   */
  it('zeigt eine Fehlermeldung statt stiller Leere, wenn die Liste nicht lädt', async () => {
    mockBasis(admin);
    server.use(
      http.get('/api/karte/offline-karten', () =>
        HttpResponse.json({ error: 'Kartenregistry nicht erreichbar' }, { status: 500 }),
      ),
    );
    render();
    expect(await screen.findByText('Offline-Karten konnten nicht geladen werden')).toBeInTheDocument();
    // Die Detailzeile stammt aus dem `{error}`-Body des Backends und ist genau die, die die
    // abgelöste Handrolle zeigte. Ohne sie belegte der Test nur die Überschrift.
    expect(screen.getByText('Kartenregistry nicht erreichbar')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Erneut abrufen' })).toBeInTheDocument();
    expect(screen.queryByText('Noch keine Offline-Karten')).not.toBeInTheDocument();
  });

  it('zeigt bei leerem Katalog den Leertext und KEINEN Fehler', async () => {
    mockBasis(admin, []);
    render();
    expect(await screen.findByText('Noch keine Offline-Karten')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Erneut abrufen' })).not.toBeInTheDocument();
  });

  it('„Erneut abrufen" holt die Liste wirklich neu', async () => {
    /**
     * Gemessen wird die WIRKUNG, nicht die Anwesenheit des Knopfes: der zweite Abruf
     * gelingt, die Tabelle steht. Ohne diese Hälfte wäre ein `onWiederholen={() => {}}`
     * genauso grün wie die Verdrahtung auf `refetch`.
     */
    let abrufe = 0;
    mockBasis(admin);
    server.use(
      http.get('/api/karte/offline-karten', () => {
        abrufe += 1;
        return abrufe === 1
          ? HttpResponse.json({ error: 'Kartenregistry nicht erreichbar' }, { status: 500 })
          : HttpResponse.json([karte]);
      }),
    );
    render();
    await userEvent.click(await screen.findByRole('button', { name: 'Erneut abrufen' }));

    expect(await screen.findByText('Deutschland – Bremen')).toBeInTheDocument();
    expect(screen.queryByText('Offline-Karten konnten nicht geladen werden')).not.toBeInTheDocument();
  });

  it('Bau-Status-Zeile: zeigt aktive Bau-Jobs (verschachtelter status.status) über der Tabelle', async () => {
    const bauJob: BauJob = {
      id: 7,
      slug: 'bayern',
      status: { status: 'building' },
      gestartet: '2026-07-05 10:00:00',
    };
    mockBasis(admin, [karte], [katalogEintrag], { bauVerfuegbar: true, bauJobs: [bauJob] });
    render();
    await screen.findByText('Deutschland – Bremen');
    expect(await screen.findByText('bayern: baut')).toBeInTheDocument();
  });
});
