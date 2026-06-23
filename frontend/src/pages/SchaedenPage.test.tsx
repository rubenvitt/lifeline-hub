import { http, HttpResponse } from 'msw';
import { screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Route, Routes, useLocation } from 'react-router-dom';
import { server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import { AuthProvider } from '../auth/AuthContext';
import SchaedenPage from './SchaedenPage';

class FakeEventSource {
  url: string; closed = false;
  constructor(url: string) { this.url = url; }
  addEventListener() {} removeEventListener() {} close() { this.closed = true; }
}
beforeEach(() => vi.stubGlobal('EventSource', FakeEventSource));
afterEach(() => vi.unstubAllGlobals());

const admin = { id: 1, anzeigename: 'Admin', system_rolle: 'admin', org_rolle: 'fuehrungskraft' };
const einsatzAktiv = {
  id: 1, bezeichnung: 'Lage', status: 'aktiv', meine_rolle: 'einsatzleitung',
  org_id: 5, org_name: 'DRK Musterstadt',
};
const einsatzBeobachter = {
  id: 1, bezeichnung: 'Lage', status: 'aktiv', meine_rolle: 'beobachter',
  org_id: 5, org_name: 'DRK Musterstadt',
};

const einePerson = {
  id: 42, einsatz_id: 1, registrier_nr: 7, status: 'betroffen', name: 'Meier', vorname: 'Anna',
};
const eineEinsatzkraft = { id: 99, einsatz_id: 1, name: 'Schulz', funktion: 'Sanitäter' };

function basisSchaden(overrides: Record<string, unknown> = {}) {
  return {
    id: 10, einsatz_id: 1, registrier_nr: 1, status: 'offen', typ: 'sachschaden',
    ausmass: 'gering', ort: 'Hauptstr. 17', beschreibung: '',
    lat: null, lon: null,
    geschaedigt_person_id: null, geschaedigt_personal_id: null, geschaedigt_organisation_id: null,
    geschaedigt_kontakt: null,
    uebergeben_an: null, uebergeben_at: null, abschluss_grund: null, abschluss_at: null,
    erfasst_at: '2026-05-29 10:00:00', erfasst_von: 1, geaendert_at: '2026-05-29 10:00:00', geaendert_von: 1,
    storniert_at: null, storniert_von: null,
    geschaedigt_registrier_nr: null, geschaedigt_storniert_at: null,
    geschaedigt_personal_name: null, geschaedigt_organisation_name: null,
    ...overrides,
  };
}

/** Macht den aktuellen Query-String im DOM sichtbar (für URL-Cleanup-Assertions). */
function LocationProbe() {
  return <span data-testid="loc-search">{useLocation().search}</span>;
}

function render(einsatzObj: object, schaeden: object[], personen: object[] = [], personal: object[] = []) {
  server.use(
    http.get('/api/auth/me', () => HttpResponse.json(admin)),
    http.get('/api/einsaetze/1', () => HttpResponse.json(einsatzObj)),
    http.get('/api/einsaetze/1/schaeden', () => HttpResponse.json(schaeden)),
    // Quellen der Geschädigt-Combobox (mounten beim Öffnen der Formulare):
    http.get('/api/einsaetze/1/personen', () => HttpResponse.json(personen)),
    http.get('/api/einsaetze/1/personal', () => HttpResponse.json(personal)),
  );
  return renderMitProviders(
    <AuthProvider>
      <Routes>
        <Route path="/einsaetze/:id/schaeden" element={<SchaedenPage />} />
        <Route path="/einsaetze/:id/personen" element={<div>Personen-Modul</div>} />
      </Routes>
    </AuthProvider>,
    { route: '/einsaetze/1/schaeden' },
  );
}

/** Rendert SchaedenPage mit konfigurierbarer Route (z.B. mit Query-Params). */
function renderSchaedenPage(route: string) {
  server.use(
    http.get('/api/auth/me', () => HttpResponse.json(admin)),
    http.get('/api/einsaetze/1', () => HttpResponse.json(einsatzAktiv)),
    http.get('/api/einsaetze/1/schaeden', () => HttpResponse.json([])),
    http.get('/api/einsaetze/1/personen', () => HttpResponse.json([])),
    http.get('/api/einsaetze/1/personal', () => HttpResponse.json([])),
  );
  return renderMitProviders(
    <AuthProvider>
      <Routes>
        <Route path="/einsaetze/:id/schaeden" element={<SchaedenPage />} />
      </Routes>
    </AuthProvider>,
    { route },
  );
}

/** Rendert SchaedenPage mit wählbarem Einsatz-Objekt und Route. */
function renderSchaedenPageMitEinsatz(einsatzObj: object, route: string) {
  server.use(
    http.get('/api/auth/me', () => HttpResponse.json(admin)),
    http.get('/api/einsaetze/1', () => HttpResponse.json(einsatzObj)),
    http.get('/api/einsaetze/1/schaeden', () => HttpResponse.json([])),
    http.get('/api/einsaetze/1/personen', () => HttpResponse.json([])),
    http.get('/api/einsaetze/1/personal', () => HttpResponse.json([])),
  );
  return renderMitProviders(
    <AuthProvider>
      <Routes>
        <Route path="/einsaetze/:id/schaeden" element={<SchaedenPage />} />
      </Routes>
    </AuthProvider>,
    { route },
  );
}

/** antd-Dropdown-Option im Portal anhand des Anzeige-Labels treffen (Tabellenzellen
 *  tragen denselben Text → über `.ant-select-item-option` abgrenzen). */
async function waehleOption(label: string) {
  const option = (await screen.findAllByText(label)).find((el) => el.closest('.ant-select-item-option'));
  expect(option).toBeTruthy();
  await userEvent.click(option!);
}

/** Modal-Dialog vom Drawer-Dialog (`ant-drawer-content`) abgrenzen. */
async function modalDialog() {
  return (await screen.findAllByRole('dialog')).find((d) => !d.classList.contains('ant-drawer-content'))!;
}

describe('SchaedenPage', () => {
  it('zeigt offene Schäden mit S-Nummer, Typ und Ausmaß', async () => {
    render(einsatzAktiv, [
      basisSchaden(),
      basisSchaden({ id: 11, registrier_nr: 2, status: 'abgeschlossen', abschluss_grund: 'behoben' }),
    ]);
    expect(await screen.findByText('S-001')).toBeInTheDocument();
    expect(screen.getByText('Hauptstr. 17')).toBeInTheDocument();
    // abgeschlossen ist in der Default-Sicht „Offen" nicht sichtbar:
    expect(screen.queryByText('S-002')).not.toBeInTheDocument();
  });

  it('filtert per Tab auf Abgeschlossen', async () => {
    render(einsatzAktiv, [
      basisSchaden(),
      basisSchaden({ id: 11, registrier_nr: 2, status: 'abgeschlossen', abschluss_grund: 'behoben' }),
    ]);
    await screen.findByText('S-001');
    await userEvent.click(screen.getByRole('tab', { name: 'Abgeschlossen' }));
    expect(await screen.findByText('S-002')).toBeInTheDocument();
  });

  it('versteckt Schreib-Buttons für Beobachter', async () => {
    render(einsatzBeobachter, [basisSchaden()]);
    await screen.findByText('S-001');
    expect(screen.queryByRole('button', { name: 'Schnellerfassung' })).not.toBeInTheDocument();
  });

  it('Schnellerfassung schickt Pflichtfelder', async () => {
    let body: Record<string, unknown> = {};
    server.use(
      http.post('/api/einsaetze/1/schaeden', async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(basisSchaden(), { status: 201 });
      }),
    );
    render(einsatzAktiv, []);
    await userEvent.click(await screen.findByRole('button', { name: 'Schnellerfassung' }));
    const dialog = await modalDialog();
    // Typ + Ausmaß sind Pflicht ohne Default → beide antd-Selects bedienen, dann Ort tippen.
    await userEvent.click(within(dialog).getAllByRole('combobox')[0]); // Typ
    await waehleOption('Umweltschaden');
    await userEvent.click(within(dialog).getAllByRole('combobox')[1]); // Ausmaß
    await waehleOption('groß');
    await userEvent.type(within(dialog).getByLabelText('Ort'), 'Hauptstr. 17');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Anlegen' }));
    await vi.waitFor(() => expect(body.typ).toBe('umweltschaden'));
    expect(body.ausmass).toBe('gross');
    expect(body.ort).toBe('Hauptstr. 17');
  });

  it('Schnellerfassung: Betroffene Person aus Combobox → geschaedigt_person_id', async () => {
    let body: Record<string, unknown> = {};
    server.use(
      http.post('/api/einsaetze/1/schaeden', async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(basisSchaden(), { status: 201 });
      }),
    );
    render(einsatzAktiv, [], [einePerson], [eineEinsatzkraft]);
    await userEvent.click(await screen.findByRole('button', { name: 'Schnellerfassung' }));
    const dialog = await modalDialog();
    await userEvent.click(within(dialog).getAllByRole('combobox')[0]); // Typ
    await waehleOption('Sachschaden');
    await userEvent.click(within(dialog).getAllByRole('combobox')[1]); // Ausmaß
    await waehleOption('gering');
    await userEvent.type(within(dialog).getByLabelText('Ort'), 'Hauptstr. 17');
    // Geschädigt-Combobox (3.) öffnen und die betroffene Person wählen.
    await userEvent.click(within(dialog).getAllByRole('combobox')[2]);
    await waehleOption('R-007 · Anna Meier');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Anlegen' }));
    await vi.waitFor(() => expect(body.geschaedigt_person_id).toBe(42));
    expect(body.geschaedigt_personal_id).toBeNull();
    expect(body.geschaedigt_organisation_id).toBeNull();
    expect(body.geschaedigt_kontakt).toBeNull();
  });

  it('Schnellerfassung: Einsatzkraft aus Combobox → geschaedigt_personal_id', async () => {
    let body: Record<string, unknown> = {};
    server.use(
      http.post('/api/einsaetze/1/schaeden', async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(basisSchaden(), { status: 201 });
      }),
    );
    render(einsatzAktiv, [], [einePerson], [eineEinsatzkraft]);
    await userEvent.click(await screen.findByRole('button', { name: 'Schnellerfassung' }));
    const dialog = await modalDialog();
    await userEvent.click(within(dialog).getAllByRole('combobox')[0]);
    await waehleOption('Sachschaden');
    await userEvent.click(within(dialog).getAllByRole('combobox')[1]);
    await waehleOption('gering');
    await userEvent.type(within(dialog).getByLabelText('Ort'), 'Hauptstr. 17');
    await userEvent.click(within(dialog).getAllByRole('combobox')[2]);
    await waehleOption('Schulz · Sanitäter');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Anlegen' }));
    await vi.waitFor(() => expect(body.geschaedigt_personal_id).toBe(99));
    expect(body.geschaedigt_person_id).toBeNull();
    expect(body.geschaedigt_organisation_id).toBeNull();
    expect(body.geschaedigt_kontakt).toBeNull();
  });

  it('Schnellerfassung: Freitext → externer Kontakt (geschaedigt_kontakt)', async () => {
    let body: Record<string, unknown> = {};
    server.use(
      http.post('/api/einsaetze/1/schaeden', async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(basisSchaden(), { status: 201 });
      }),
    );
    render(einsatzAktiv, [], [einePerson], [eineEinsatzkraft]);
    await userEvent.click(await screen.findByRole('button', { name: 'Schnellerfassung' }));
    const dialog = await modalDialog();
    await userEvent.click(within(dialog).getAllByRole('combobox')[0]);
    await waehleOption('Sachschaden');
    await userEvent.click(within(dialog).getAllByRole('combobox')[1]);
    await waehleOption('gering');
    await userEvent.type(within(dialog).getByLabelText('Ort'), 'Hauptstr. 17');
    // In die Geschädigt-Combobox tippen → synthetische „extern"-Option erscheint.
    const geschaedigt = within(dialog).getAllByRole('combobox')[2];
    await userEvent.click(geschaedigt);
    await userEvent.type(geschaedigt, 'Familie Krause');
    const externOption = (await screen.findAllByText(/Als externen Kontakt/)).find((el) =>
      el.closest('.ant-select-item-option'),
    );
    expect(externOption).toBeTruthy();
    await userEvent.click(externOption!);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Anlegen' }));
    await vi.waitFor(() => expect(body.geschaedigt_kontakt).toBe('Familie Krause'));
    expect(body.geschaedigt_person_id).toBeNull();
    expect(body.geschaedigt_personal_id).toBeNull();
    expect(body.geschaedigt_organisation_id).toBeNull();
  });

  it('Übergeben-Modal erzwingt einen Adressaten und schickt ihn', async () => {
    let body: { uebergeben_an?: string } = {};
    server.use(
      http.get('/api/einsaetze/1/schaeden/10', () => HttpResponse.json(basisSchaden())),
      http.post('/api/einsaetze/1/schaeden/10/uebergeben', async ({ request }) => {
        body = (await request.json()) as { uebergeben_an?: string };
        return HttpResponse.json(basisSchaden({ status: 'uebergeben', uebergeben_an: body.uebergeben_an }));
      }),
    );
    render(einsatzAktiv, [basisSchaden()]);
    await userEvent.click((await screen.findAllByText('Hauptstr. 17'))[0]);
    await userEvent.click(await screen.findByRole('button', { name: 'Übergeben' }));
    const dialog = await modalDialog();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Übergeben' }));
    expect(await screen.findByText('Adressat ist Pflicht')).toBeInTheDocument();
    expect(body.uebergeben_an).toBeUndefined();
    await userEvent.type(within(dialog).getByLabelText('Übergeben an'), 'Stadtwerke');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Übergeben' }));
    await vi.waitFor(() => expect(body.uebergeben_an).toBe('Stadtwerke'));
  });

  it('Abschließen-Modal erzwingt einen Grund', async () => {
    let body: { abschluss_grund?: string } = {};
    server.use(
      http.get('/api/einsaetze/1/schaeden/10', () => HttpResponse.json(basisSchaden())),
      http.post('/api/einsaetze/1/schaeden/10/abschliessen', async ({ request }) => {
        body = (await request.json()) as { abschluss_grund?: string };
        return HttpResponse.json(basisSchaden({ status: 'abgeschlossen', abschluss_grund: body.abschluss_grund }));
      }),
    );
    render(einsatzAktiv, [basisSchaden()]);
    await userEvent.click((await screen.findAllByText('Hauptstr. 17'))[0]);
    await userEvent.click(await screen.findByRole('button', { name: 'Abschließen' }));
    const dialog = await modalDialog();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Abschließen' }));
    expect(await screen.findByText('Grund ist Pflicht')).toBeInTheDocument();
    expect(body.abschluss_grund).toBeUndefined();
    await userEvent.click(within(dialog).getByRole('combobox'));
    await waehleOption('behoben');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Abschließen' }));
    await vi.waitFor(() => expect(body.abschluss_grund).toBe('behoben'));
  });

  it('öffnet via ?neu=1 die Schadens-Erfassung', async () => {
    renderSchaedenPage('/einsaetze/1/schaeden?neu=1');
    expect(await screen.findByText('Schaden erfassen')).toBeInTheDocument();
  });

  it('öffnet via ?neu=1 die Erfassungsmaske NICHT für Beobachter', async () => {
    renderSchaedenPageMitEinsatz(einsatzBeobachter, '/einsaetze/1/schaeden?neu=1');
    // Tabelle muss laden (Seite ist gerendert)
    await screen.findByText('Keine Schäden in dieser Sicht');
    expect(screen.queryByText('Schaden erfassen')).not.toBeInTheDocument();
  });

  it('öffnet per ?schaden=-Query den Detail-Drawer', async () => {
    const schaden5 = basisSchaden({
      id: 5, registrier_nr: 7, ort: 'Gartenstr. 42',
      beschreibung: 'Riss', ausmass: 'gross',
    });
    server.use(
      http.get('/api/auth/me', () => HttpResponse.json(admin)),
      http.get('/api/einsaetze/1', () => HttpResponse.json(einsatzAktiv)),
      http.get('/api/einsaetze/1/schaeden', () => HttpResponse.json([schaden5])),
      http.get('/api/einsaetze/1/schaeden/5', () => HttpResponse.json(schaden5)),
      http.get('/api/einsaetze/1/personen', () => HttpResponse.json([])),
      http.get('/api/einsaetze/1/personal', () => HttpResponse.json([])),
    );
    renderMitProviders(
      <AuthProvider>
        <Routes>
          <Route path="/einsaetze/:id/schaeden" element={<SchaedenPage />} />
        </Routes>
      </AuthProvider>,
      { route: '/einsaetze/1/schaeden?schaden=5' },
    );
    // Drawer-Titel enthält die S-Nummer und den Typ — erscheint nur im Drawer, nicht in der Tabelle.
    expect(await screen.findByText('S-007 · Sachschaden')).toBeInTheDocument();
  });

  it('räumt ?schaden= aus der URL, wenn der Detail-Drawer geschlossen wird (LFH-25)', async () => {
    const schaden5 = basisSchaden({
      id: 5, registrier_nr: 7, ort: 'Gartenstr. 42', beschreibung: 'Riss', ausmass: 'gross',
    });
    server.use(
      http.get('/api/auth/me', () => HttpResponse.json(admin)),
      http.get('/api/einsaetze/1', () => HttpResponse.json(einsatzAktiv)),
      http.get('/api/einsaetze/1/schaeden', () => HttpResponse.json([schaden5])),
      http.get('/api/einsaetze/1/schaeden/5', () => HttpResponse.json(schaden5)),
      http.get('/api/einsaetze/1/personen', () => HttpResponse.json([])),
      http.get('/api/einsaetze/1/personal', () => HttpResponse.json([])),
    );
    renderMitProviders(
      <AuthProvider>
        <LocationProbe />
        <Routes>
          <Route path="/einsaetze/:id/schaeden" element={<SchaedenPage />} />
        </Routes>
      </AuthProvider>,
      { route: '/einsaetze/1/schaeden?schaden=5' },
    );
    await screen.findByText('S-007 · Sachschaden');
    expect(screen.getByTestId('loc-search')).toHaveTextContent('schaden=5');
    // Drawer schließen → URL muss ?schaden= verlieren und der Drawer darf nicht reopen-loopen.
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.getByTestId('loc-search').textContent).toBe(''));
  });

  it('verlinkt eine geschädigte Person auf ihre Detailseite (LFH-25)', async () => {
    render(einsatzAktiv, [basisSchaden({ id: 1, geschaedigt_person_id: 50, geschaedigt_registrier_nr: 7 })]);
    const link = await screen.findByRole('link', { name: /R-007/ });
    expect(link).toHaveAttribute('href', '/einsaetze/1/personen/50');
  });

  it('verlinkt eine geschädigte Einsatzkraft auf die Personal-Liste (LFH-25)', async () => {
    render(einsatzAktiv, [basisSchaden({ id: 2, geschaedigt_personal_id: 99, geschaedigt_personal_name: 'Schulz' })]);
    const link = await screen.findByRole('link', { name: /Schulz/ });
    expect(link).toHaveAttribute('href', '/einsaetze/1/personal?personal=99');
  });

  it('verlinkt eine stornierte Geschädigt-Person NICHT (bleibt grauer Text)', async () => {
    render(einsatzAktiv, [basisSchaden({
      id: 3, geschaedigt_person_id: 50, geschaedigt_registrier_nr: 7,
      geschaedigt_storniert_at: '2026-05-30 10:00:00',
    })]);
    expect(await screen.findByText(/Geschädigt \(storniert\): R-007/)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /R-007/ })).not.toBeInTheDocument();
  });
});
