import { http, HttpResponse } from 'msw';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import { AuthProvider } from '../auth/AuthContext';
import type { OfflineKarte } from '../api/offlineKarten';
import OfflineKartenVerwaltung from './OfflineKartenVerwaltung';

const admin = {
  id: 1, anzeigename: 'Admin', benutzername: 'admin', system_rolle: 'admin',
  org_rolle: 'keine', aktiv: true, erstellt_at: '2026-06-26 10:00:00',
};
const fuehrungskraft = {
  ...admin, id: 2, anzeigename: 'Eva', system_rolle: 'keiner', org_rolle: 'fuehrungskraft',
};

const karte: OfflineKarte = {
  id: 1, name: 'Deutschland – Bremen', pfad: 'karte-1.pmtiles',
  quell_url: 'https://example.test/de_bremen.pmtiles', lizenz: '© OpenStreetMap contributors (ODbL)',
  kachel_schema: 'protomaps', groesse: 44040192, sha256: 'abc', download_at: '2026-06-26 11:00:00',
  status: 'bereit', aktiv_basemap: false, sortier: 0,
};

const karteLaedt: OfflineKarte = {
  ...karte, id: 2, name: 'Deutschland – Bayern', status: 'laedt',
  groesse: null, sha256: null, download_at: null, aktiv_basemap: false, pfad: '',
};

const katalogEintrag = {
  name: 'Deutschland – Bremen', url: 'https://example.test/de_bremen.pmtiles', region: 'DE/Bremen',
  groesse: 44040192, lizenz: '© OpenStreetMap contributors (ODbL)', kachel_schema: 'protomaps',
  quelle: 'Project N.O.M.A.D.',
};

function mockBasis(benutzer: typeof admin, karten: OfflineKarte[] = [karte], katalog = [katalogEintrag]) {
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
    expect(screen.getByRole('button', { name: 'Aus Katalog herunterladen' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Per URL herunterladen' })).toBeInTheDocument();
    // bereit + nicht aktiv → Aktivieren angeboten.
    expect(screen.getByRole('button', { name: 'Aktivieren' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Löschen' })).toBeInTheDocument();
  });

  it('Führungskraft sieht keine Schreibaktionen (read-only)', async () => {
    mockBasis(fuehrungskraft);
    render();
    await screen.findByText('Deutschland – Bremen');
    expect(screen.queryByRole('button', { name: 'Aus Katalog herunterladen' })).not.toBeInTheDocument();
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
    await userEvent.click(await screen.findByRole('button', { name: 'Aus Katalog herunterladen' }));
    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByText('Deutschland – Bremen')).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Herunterladen' }));

    await waitFor(() => expect(postBody).not.toBeNull());
    expect(postBody).toEqual({
      name: 'Deutschland – Bremen',
      url: 'https://example.test/de_bremen.pmtiles',
      lizenz: '© OpenStreetMap contributors (ODbL)',
      kachel_schema: 'protomaps',
      groesse_erwartet: 44040192,
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

  it('URL-Download: Modal-Submit → POST /download mit kachel_schema protomaps', async () => {
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
    await userEvent.type(within(dialog).getByLabelText('URL'), 'https://example.test/de.pmtiles');
    await userEvent.type(within(dialog).getByLabelText('Attribution / Lizenz'), '© OSM');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Download starten' }));

    await waitFor(() => expect(postBody).not.toBeNull());
    expect(postBody).toEqual({
      name: 'Eigener Extrakt',
      url: 'https://example.test/de.pmtiles',
      lizenz: '© OSM',
      kachel_schema: 'protomaps',
    });
  });
});
