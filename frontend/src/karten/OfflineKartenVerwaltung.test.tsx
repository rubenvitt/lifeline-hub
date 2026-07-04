import { http, HttpResponse } from 'msw';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import { AuthProvider } from '../auth/AuthContext';
import type { OfflineKarte, OfflineKatalogEintrag } from '../api/offlineKarten';
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
  kachel_schema: 'shortbread', groesse: 44040192, sha256: 'abc', download_at: '2026-06-26 11:00:00',
  status: 'bereit', aktiv_basemap: false, sortier: 0,
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
) {
  server.use(
    http.get('/api/auth/me', () => HttpResponse.json(benutzer)),
    http.get('/api/karte/offline-karten', () => HttpResponse.json(karten)),
    http.get('/api/karte/offline-karten/katalog', () => HttpResponse.json(katalog)),
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

  it('Admin sieht Download- und Zeilen-Aktionen', async () => {
    mockBasis(admin);
    render();
    await screen.findByText('Deutschland – Bremen');
    expect(screen.getByRole('button', { name: 'Region aufs Gerät bringen' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Per URL herunterladen' })).toBeInTheDocument();
    // bereit + nicht aktiv → Aktivieren angeboten.
    expect(screen.getByRole('button', { name: 'Aktivieren' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Löschen' })).toBeInTheDocument();
  });

  it('Katalog-Modal gruppiert Regionen und startet den Download', async () => {
    let downloadName: string | undefined;
    const katalog = [
      { name: 'Deutschland (Shortbread)', url: 'https://m/de.mbtiles', region: 'DE', groesse: 3e9, lizenz: 'ODbL', kachel_schema: 'shortbread', quelle: 'q', sha256: null, gruppe: 'Deutschland' },
      { name: 'Bayern', url: 'https://m/by.mbtiles', region: 'DE-BY', groesse: 1e9, lizenz: 'ODbL', kachel_schema: 'shortbread', quelle: 'q', sha256: null, gruppe: 'Bundesländer' },
    ];
    mockBasis(admin, [], katalog);
    server.use(
      http.post('/api/karte/offline-karten/download', async ({ request }) => {
        downloadName = ((await request.json()) as { name: string }).name;
        return HttpResponse.json({ ...karte, id: 9, name: downloadName });
      }),
    );
    render();
    await userEvent.click(await screen.findByRole('button', { name: 'Region aufs Gerät bringen' }));
    // Geführte Auswahl: die Einträge sind nach Gruppe überschrieben.
    expect(await screen.findByRole('heading', { name: 'Bundesländer' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Deutschland' })).toBeInTheDocument();
    // Erster „Herunterladen" (Gruppe Deutschland) startet den Download mit dem richtigen Eintrag.
    await userEvent.click(screen.getAllByRole('button', { name: 'Herunterladen' })[0]);
    await waitFor(() => expect(downloadName).toBe('Deutschland (Shortbread)'));
  });

  it('Gebaute Region übernehmen: listet vorhandene Datei und registriert sie lokal', async () => {
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
    await userEvent.click(await screen.findByRole('button', { name: 'Gebaute Region übernehmen' }));
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

  it('Aktivieren ruft den Aktivieren-Endpunkt', async () => {
    let aktiviert = false;
    mockBasis(admin);
    server.use(
      http.post('/api/karte/offline-karten/1/aktivieren', () => {
        aktiviert = true;
        return HttpResponse.json({ ...karte, aktiv_basemap: true });
      }),
    );
    render();
    await userEvent.click(await screen.findByRole('button', { name: 'Aktivieren' }));
    await waitFor(() => expect(aktiviert).toBe(true));
  });

  it('Katalog-Flow: Herunterladen → POST /download mit korrektem Body', async () => {
    let postBody: unknown = null;
    mockBasis(admin, []); // leere Liste → Katalog-Eintrag nicht „vorhanden"
    server.use(
      http.post('/api/karte/offline-karten/download', async ({ request }) => {
        postBody = await request.json();
        return HttpResponse.json({ ...karte, status: 'laedt' }, { status: 202 });
      }),
    );
    render();
    await userEvent.click(await screen.findByRole('button', { name: 'Region aufs Gerät bringen' }));
    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByText('Deutschland – Bremen')).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Herunterladen' }));

    await waitFor(() => expect(postBody).not.toBeNull());
    expect(postBody).toEqual({
      name: 'Deutschland – Bremen',
      url: 'https://example.test/de_bremen.mbtiles',
      lizenz: '© OpenStreetMap contributors (ODbL)',
      kachel_schema: 'shortbread',
      groesse_erwartet: 44040192,
      sha256_erwartet: 'cafef00d',
    });
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
    await userEvent.click(await screen.findByRole('button', { name: 'Per URL herunterladen' }));
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
});
