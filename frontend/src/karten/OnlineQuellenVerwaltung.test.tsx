import { http, HttpResponse } from 'msw';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import { AuthProvider } from '../auth/AuthContext';
import type { OnlineQuelle } from '../api/onlineQuellen';
import OnlineQuellenVerwaltung from './OnlineQuellenVerwaltung';

const admin = {
  id: 1, anzeigename: 'Admin', benutzername: 'admin', system_rolle: 'admin',
  org_rolle: 'keine', aktiv: true, erstellt_at: '2026-06-26 10:00:00',
};
// AdminLayout lässt admin ODER fuehrungskraft auf die Seite; nur admin darf schreiben.
const fuehrungskraft = {
  ...admin, id: 2, anzeigename: 'Eva', system_rolle: 'keiner', org_rolle: 'fuehrungskraft',
};

const quelle: OnlineQuelle = {
  id: 1, name: 'OpenStreetMap', url: 'https://tile.osm.org/{z}/{x}/{y}.png',
  typ: 'raster', attribution: '© OSM-Mitwirkende', sortier: 0, aktiv: true, proxy: false,
};

const katalogEintrag = {
  name: 'OpenFreeMap Liberty', url: 'https://tiles.openfreemap.org/styles/liberty',
  typ: 'vektor' as const, attribution: '© OpenFreeMap',
};

function mockBasis(benutzer: typeof admin, quellen: OnlineQuelle[] = [quelle]) {
  server.use(
    http.get('/api/auth/me', () => HttpResponse.json(benutzer)),
    http.get('/api/karte/online-quellen', () => HttpResponse.json(quellen)),
    http.get('/api/karte/online-quellen/katalog', () => HttpResponse.json([katalogEintrag])),
  );
}

function render() {
  return renderMitProviders(
    <AuthProvider>
      <OnlineQuellenVerwaltung />
    </AuthProvider>,
  );
}

describe('OnlineQuellenVerwaltung', () => {
  it('zeigt die Online-Quellen (Name/URL/Attribution/Typ)', async () => {
    mockBasis(admin);
    render();
    expect(await screen.findByText('OpenStreetMap')).toBeInTheDocument();
    expect(screen.getByText('https://tile.osm.org/{z}/{x}/{y}.png')).toBeInTheDocument();
    expect(screen.getByText('© OSM-Mitwirkende')).toBeInTheDocument();
    // Typ als Tag — über Inhalt, nicht über Farbklasse.
    expect(screen.getByText('raster')).toBeInTheDocument();
  });

  it('Admin sieht Schreibaktionen', async () => {
    mockBasis(admin);
    render();
    await screen.findByText('OpenStreetMap');
    expect(screen.getByRole('button', { name: 'Quelle hinzufügen' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Aus Katalog hinzufügen' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Bearbeiten' })).toBeInTheDocument();
  });

  it('Führungskraft sieht keine Schreibaktionen (read-only)', async () => {
    mockBasis(fuehrungskraft);
    render();
    await screen.findByText('OpenStreetMap');
    expect(screen.queryByRole('button', { name: 'Quelle hinzufügen' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Aus Katalog hinzufügen' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Bearbeiten' })).not.toBeInTheDocument();
  });

  it('zeigt eine Fehlermeldung statt stiller Leere, wenn die Liste nicht lädt', async () => {
    server.use(
      http.get('/api/auth/me', () => HttpResponse.json(admin)),
      http.get('/api/karte/online-quellen', () => new HttpResponse(null, { status: 500 })),
    );
    render();
    expect(await screen.findByText(/nicht geladen/i)).toBeInTheDocument();
    expect(screen.queryByText('Noch keine Online-Quellen')).not.toBeInTheDocument();
  });

  it('Katalog-Flow: „Aus Katalog hinzufügen" → Eintrag → POST mit korrektem Body', async () => {
    let postBody: unknown = null;
    mockBasis(admin, []);
    server.use(
      http.post('/api/karte/online-quellen', async ({ request }) => {
        postBody = await request.json();
        return HttpResponse.json({ id: 9, ...(postBody as object) }, { status: 201 });
      }),
    );
    render();
    await screen.findByRole('button', { name: 'Aus Katalog hinzufügen' });
    await userEvent.click(screen.getByRole('button', { name: 'Aus Katalog hinzufügen' }));

    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByText('OpenFreeMap Liberty')).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Hinzufügen' }));

    await waitFor(() => expect(postBody).not.toBeNull());
    expect(postBody).toEqual({
      name: 'OpenFreeMap Liberty',
      url: 'https://tiles.openfreemap.org/styles/liberty',
      typ: 'vektor',
      attribution: '© OpenFreeMap',
      sortier: 1,
      aktiv: true,
      proxy: false,
    });
  });

  it('Katalog: bereits per URL vorhandene Einträge sind ausgegraut', async () => {
    // Bestandsquelle mit identischer URL wie der Katalog-Eintrag.
    mockBasis(admin, [{ ...quelle, url: katalogEintrag.url, typ: 'vektor' }]);
    render();
    await userEvent.click(await screen.findByRole('button', { name: 'Aus Katalog hinzufügen' }));
    const dialog = await screen.findByRole('dialog');
    const button = within(dialog).getByRole('button', { name: 'Vorhanden' });
    expect(button).toBeDisabled();
  });

  it('Pflicht-Attribution: leeres Feld → Validierungsmeldung, KEIN POST', async () => {
    let postAufgerufen = false;
    mockBasis(admin, []);
    server.use(
      http.post('/api/karte/online-quellen', () => {
        postAufgerufen = true;
        return HttpResponse.json({ id: 9 }, { status: 201 });
      }),
    );
    render();
    await userEvent.click(await screen.findByRole('button', { name: 'Quelle hinzufügen' }));

    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText('Name'), 'Test-Quelle');
    await userEvent.type(within(dialog).getByLabelText('URL'), 'https://example.org/style.json');
    // Attribution bewusst leer lassen.
    await userEvent.click(within(dialog).getByRole('button', { name: 'Speichern' }));

    expect(await screen.findByText('Attribution ist Pflicht')).toBeInTheDocument();
    // antd überspringt onFinish bei Validierungsfehler → Mutation feuert nie.
    expect(postAufgerufen).toBe(false);
  });

  it('Typ-Select: Options-Knoten klickbar; Auswahl landet im POST-Body', async () => {
    let postBody: unknown = null;
    mockBasis(admin, []);
    server.use(
      http.post('/api/karte/online-quellen', async ({ request }) => {
        postBody = await request.json();
        return HttpResponse.json({ id: 9, ...(postBody as object) }, { status: 201 });
      }),
    );
    render();
    await userEvent.click(await screen.findByRole('button', { name: 'Quelle hinzufügen' }));

    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText('Name'), 'Raster-Quelle');
    // Keine geschweiften Klammern in userEvent.type (Sondertasten-Syntax) — Platzhalter-URL.
    await userEvent.type(within(dialog).getByLabelText('URL'), 'https://example.org/raster');
    await userEvent.type(within(dialog).getByLabelText('Attribution'), '© Beispiel');

    // typ-Select öffnen und echten Options-Knoten wählen (Portal liegt außerhalb des Dialogs).
    await userEvent.click(within(dialog).getByRole('combobox'));
    const option = await screen.findByText(
      (_, el) => typeof el?.className === 'string'
        && el.className.includes('ant-select-item-option-content')
        && el.textContent === 'Raster (XYZ-Kacheln)',
    );
    await userEvent.click(option);

    await userEvent.click(within(dialog).getByRole('button', { name: 'Speichern' }));

    await waitFor(() => expect(postBody).not.toBeNull());
    expect(postBody).toMatchObject({
      name: 'Raster-Quelle',
      url: 'https://example.org/raster',
      typ: 'raster',
      attribution: '© Beispiel',
      aktiv: true,
      proxy: false, // ohne Umschalten Default false
    });
  });

  it('Protomaps: erzwingt proxy:true im POST-Body ohne Switch-Interaktion (LFH-192)', async () => {
    let postBody: unknown = null;
    mockBasis(admin, []);
    server.use(
      http.post('/api/karte/online-quellen', async ({ request }) => {
        postBody = await request.json();
        return HttpResponse.json({ id: 9, ...(postBody as object) }, { status: 201 });
      }),
    );
    render();
    await userEvent.click(await screen.findByRole('button', { name: 'Quelle hinzufügen' }));

    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText('Name'), 'Protomaps-Quelle');
    await userEvent.type(within(dialog).getByLabelText('URL'), 'https://api.protomaps.com/tiles/v4.json?key=testkey');
    await userEvent.type(within(dialog).getByLabelText('Attribution'), '© Protomaps');

    // Typ auf Protomaps setzen (Option liegt im Portal außerhalb des Dialogs).
    await userEvent.click(within(dialog).getByRole('combobox'));
    const option = await screen.findByText(
      (_, el) => typeof el?.className === 'string'
        && el.className.includes('ant-select-item-option-content')
        && el.textContent === 'Protomaps (API-Key, beschriftet)',
    );
    await userEvent.click(option);

    // Proxy-Switch ist für protomaps deaktiviert (kein Umschalten nötig/möglich).
    const proxyItem = within(dialog).getByText('Über Server proxen').closest('.ant-form-item');
    expect(within(proxyItem as HTMLElement).getByRole('switch')).toBeDisabled();

    await userEvent.click(within(dialog).getByRole('button', { name: 'Speichern' }));

    await waitFor(() => expect(postBody).not.toBeNull());
    expect(postBody).toMatchObject({ typ: 'protomaps', proxy: true });
  });

  it('Proxy-Schalter: aktiviert → POST-Body proxy:true (LFH-182)', async () => {
    let postBody: unknown = null;
    mockBasis(admin, []);
    server.use(
      http.post('/api/karte/online-quellen', async ({ request }) => {
        postBody = await request.json();
        return HttpResponse.json({ id: 9, ...(postBody as object) }, { status: 201 });
      }),
    );
    render();
    await userEvent.click(await screen.findByRole('button', { name: 'Quelle hinzufügen' }));

    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText('Name'), 'MapTiler');
    await userEvent.type(within(dialog).getByLabelText('URL'), 'https://api.maptiler.com/maps/streets/style.json');
    await userEvent.type(within(dialog).getByLabelText('Attribution'), '© MapTiler');

    // Den „Über Server proxen"-Switch in seinem Form-Item gezielt umschalten (zwei Switches im Form).
    const proxyItem = within(dialog).getByText('Über Server proxen').closest('.ant-form-item');
    await userEvent.click(within(proxyItem as HTMLElement).getByRole('switch'));

    await userEvent.click(within(dialog).getByRole('button', { name: 'Speichern' }));

    await waitFor(() => expect(postBody).not.toBeNull());
    expect(postBody).toMatchObject({ name: 'MapTiler', proxy: true });
  });
});
