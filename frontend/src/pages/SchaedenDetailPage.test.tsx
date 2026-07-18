import { http, HttpResponse } from 'msw';
import { fireEvent, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Route, Routes } from 'react-router-dom';
import { server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import { AuthProvider } from '../auth/AuthContext';
import SchaedenDetailPage from './SchaedenDetailPage';

class FakeEventSource {
  url: string; closed = false;
  constructor(url: string) { this.url = url; }
  addEventListener() {} removeEventListener() {} close() { this.closed = true; }
}
beforeEach(() => vi.stubGlobal('EventSource', FakeEventSource));
afterEach(() => vi.unstubAllGlobals());

// Normaler Benutzer (kein System-Admin): so prüft der Beobachter-Test die EINSATZ-Rolle,
// nicht den admin-globalen Zweig (LFH-234). Admin-global ist in schreibrecht.test.ts abgedeckt.
const nutzer = { id: 1, anzeigename: 'Nutzer', system_rolle: 'keiner', org_rolle: 'fuehrungskraft' };
const einsatzAktiv = {
  id: 1, bezeichnung: 'Lage', status: 'aktiv', meine_rolle: 'einsatzleitung',
  org_id: 5, org_name: 'DRK Musterstadt',
};
const einsatzBeobachter = { ...einsatzAktiv, meine_rolle: 'beobachter' };

// Quellen der Geschädigt-Combobox (laden beim Öffnen des Edit-Formulars).
const einePerson = {
  id: 42, einsatz_id: 1, registrier_nr: 7, status: 'betroffen', name: 'Meier', vorname: 'Anna',
};

function basisSchaden(overrides: Record<string, unknown> = {}) {
  return {
    id: 10, einsatz_id: 1, registrier_nr: 1, status: 'offen', typ: 'sachschaden',
    ausmass: 'gering', ort: 'Hauptstr. 17', beschreibung: 'Umgestürzter Baum',
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

function render(
  einsatzObj: object,
  schaden: Record<string, unknown>,
  extra: Parameters<typeof server.use> = [],
  route = '/einsaetze/1/schaeden/10',
) {
  server.use(
    http.get('/api/auth/me', () => HttpResponse.json(nutzer)),
    http.get('/api/einsaetze/1', () => HttpResponse.json(einsatzObj)),
    http.get('/api/einsaetze/1/schaeden/10', () => HttpResponse.json(schaden)),
    http.get('/api/einsaetze/1/personen', () => HttpResponse.json([einePerson])),
    http.get('/api/einsaetze/1/personal', () => HttpResponse.json([])),
  );
  if (extra.length > 0) server.use(...extra);
  return renderMitProviders(
    <AuthProvider>
      <Routes>
        <Route path="/einsaetze/:id/schaeden" element={<div>LISTE</div>} />
        <Route path="/einsaetze/:id/schaeden/:schadenId" element={<SchaedenDetailPage />} />
        <Route path="/einsaetze/:id/personen/:personId" element={<div>PERSON-DETAIL</div>} />
      </Routes>
    </AuthProvider>,
    { route },
  );
}

describe('SchaedenDetailPage — Stammdaten', () => {
  it('zeigt Read-Modus mit Stammdaten', async () => {
    render(einsatzAktiv, basisSchaden());
    expect(await screen.findByRole('heading', { name: /Schaden S-001/ })).toBeInTheDocument();
    expect(screen.getByText('Hauptstr. 17')).toBeInTheDocument();
    expect(screen.getByText('Umgestürzter Baum')).toBeInTheDocument();
    expect(screen.getByText('Sachschaden')).toBeInTheDocument();
  });

  it('Einsatzleitung kann bearbeiten und speichern (ohne Geschädigt → alle vier null)', async () => {
    let body: Record<string, unknown> | null = null;
    render(einsatzAktiv, basisSchaden(), [
      http.patch('/api/einsaetze/1/schaeden/10', async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(basisSchaden());
      }),
    ]);
    await userEvent.click(await screen.findByRole('button', { name: 'Bearbeiten' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Speichern' }));
    await vi.waitFor(() => expect(body).not.toBeNull());
    expect(body!.ort).toBe('Hauptstr. 17');
    expect(body!.geschaedigt_person_id).toBeNull();
    expect(body!.geschaedigt_personal_id).toBeNull();
    expect(body!.geschaedigt_organisation_id).toBeNull();
    expect(body!.geschaedigt_kontakt).toBeNull();
  });

  it('Beobachter sieht keinen Bearbeiten-Button', async () => {
    render(einsatzBeobachter, basisSchaden());
    await screen.findByRole('heading', { name: /Schaden S-001/ });
    expect(screen.queryByRole('button', { name: 'Bearbeiten' })).not.toBeInTheDocument();
  });

  it('Edit: Geschädigt-Combobox auf betroffene Person → geschaedigt_person_id', async () => {
    let body: Record<string, unknown> = {};
    render(einsatzAktiv, basisSchaden(), [
      http.patch('/api/einsaetze/1/schaeden/10', async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(basisSchaden());
      }),
    ]);
    await userEvent.click(await screen.findByRole('button', { name: 'Bearbeiten' }));
    // Comboboxen im Edit-Formular: [0] Typ, [1] Ausmaß, [2] Geschädigt.
    await userEvent.click(screen.getAllByRole('combobox')[2]);
    const option = (await screen.findAllByText('R-007 · Anna Meier')).find((el) =>
      el.closest('.ant-select-item-option'),
    );
    expect(option).toBeTruthy();
    await userEvent.click(option!);
    await userEvent.click(screen.getByRole('button', { name: 'Speichern' }));
    await vi.waitFor(() => expect(body.geschaedigt_person_id).toBe(42));
    expect(body.geschaedigt_kontakt).toBeNull();
  });

  it('Edit: Geschädigt leeren sendet alle vier Felder als null', async () => {
    const mitGeschaedigt = basisSchaden({ geschaedigt_person_id: 42, geschaedigt_registrier_nr: 7 });
    let body: Record<string, unknown> = {};
    const { container } = render(einsatzAktiv, mitGeschaedigt, [
      http.patch('/api/einsaetze/1/schaeden/10', async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(mitGeschaedigt);
      }),
    ]);
    await userEvent.click(await screen.findByRole('button', { name: 'Bearbeiten' }));
    // Geschädigt ist der letzte allowClear-Select im Formular → letztes Clear-Icon.
    const clears = container.querySelectorAll('.ant-select-clear');
    const clear = clears[clears.length - 1];
    expect(clear, 'Geschädigt-Combobox muss allowClear haben').toBeTruthy();
    fireEvent.mouseDown(clear);
    fireEvent.click(clear);
    await userEvent.click(screen.getByRole('button', { name: 'Speichern' }));
    await vi.waitFor(() => expect(body.geschaedigt_person_id).toBeNull());
    expect(body.geschaedigt_personal_id).toBeNull();
    expect(body.geschaedigt_organisation_id).toBeNull();
    expect(body.geschaedigt_kontakt).toBeNull();
  });

  it('Geschädigt-Link deeplinkt bei bekannter Person auf die Personen-Detailseite', async () => {
    render(einsatzAktiv, basisSchaden({ geschaedigt_person_id: 42, geschaedigt_registrier_nr: 7 }));
    const link = await screen.findByRole('link', { name: /R-007/ });
    expect(link).toHaveAttribute('href', '/einsaetze/1/personen/42');
  });

  it('Stornieren bestätigt per Popconfirm, ruft DELETE und navigiert zur Liste', async () => {
    let geloescht = false;
    render(einsatzAktiv, basisSchaden(), [
      http.delete('/api/einsaetze/1/schaeden/10', () => { geloescht = true; return new HttpResponse(null, { status: 204 }); }),
    ]);
    await userEvent.click(await screen.findByRole('button', { name: 'Stornieren' }));
    // Popconfirm-Bestätigung trägt denselben okText → der zweite „Stornieren"-Button.
    const stornoButtons = screen.getAllByRole('button', { name: 'Stornieren' });
    await userEvent.click(stornoButtons[stornoButtons.length - 1]);
    await vi.waitFor(() => expect(geloescht).toBe(true));
    expect(await screen.findByText('LISTE')).toBeInTheDocument();
  });
});

describe('SchaedenDetailPage — Status-Aktionen', () => {
  it('Übergeben-Modal erzwingt einen Adressaten und schickt ihn', async () => {
    let body: { uebergeben_an?: string } = {};
    render(einsatzAktiv, basisSchaden(), [
      http.post('/api/einsaetze/1/schaeden/10/uebergeben', async ({ request }) => {
        body = (await request.json()) as { uebergeben_an?: string };
        return HttpResponse.json(basisSchaden({ status: 'uebergeben', uebergeben_an: body.uebergeben_an }));
      }),
    ]);
    await userEvent.click(await screen.findByRole('button', { name: 'Übergeben' }));
    const dialog = (await screen.findAllByRole('dialog'))[0];
    await userEvent.click(within(dialog).getByRole('button', { name: 'Übergeben' }));
    expect(await screen.findByText('Adressat ist Pflicht')).toBeInTheDocument();
    expect(body.uebergeben_an).toBeUndefined();
    await userEvent.type(within(dialog).getByLabelText('Übergeben an'), 'Stadtwerke');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Übergeben' }));
    await vi.waitFor(() => expect(body.uebergeben_an).toBe('Stadtwerke'));
  });

  it('Abschließen-Modal erzwingt einen Grund und schickt ihn', async () => {
    let body: { abschluss_grund?: string } = {};
    render(einsatzAktiv, basisSchaden(), [
      http.post('/api/einsaetze/1/schaeden/10/abschliessen', async ({ request }) => {
        body = (await request.json()) as { abschluss_grund?: string };
        return HttpResponse.json(basisSchaden({ status: 'abgeschlossen', abschluss_grund: body.abschluss_grund }));
      }),
    ]);
    await userEvent.click(await screen.findByRole('button', { name: 'Abschließen' }));
    const dialog = (await screen.findAllByRole('dialog'))[0];
    await userEvent.click(within(dialog).getByRole('button', { name: 'Abschließen' }));
    expect(await screen.findByText('Grund ist Pflicht')).toBeInTheDocument();
    expect(body.abschluss_grund).toBeUndefined();
    await userEvent.click(within(dialog).getByRole('combobox'));
    const option = (await screen.findAllByText('behoben')).find((el) => el.closest('.ant-select-item-option'));
    await userEvent.click(option!);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Abschließen' }));
    await vi.waitFor(() => expect(body.abschluss_grund).toBe('behoben'));
  });

  it('zeigt den Übergeben-an-Wert bei übergebenem Schaden', async () => {
    render(einsatzAktiv, basisSchaden({ status: 'uebergeben', uebergeben_an: 'Stadtwerke' }));
    await screen.findByRole('heading', { name: /Schaden S-001/ });
    expect(screen.getByText('Stadtwerke')).toBeInTheDocument();
  });
});

describe('SchaedenDetailPage — Robustheit', () => {
  it('leitet bei ungültiger Schaden-ID auf die Liste um', async () => {
    render(einsatzAktiv, basisSchaden(), [], '/einsaetze/1/schaeden/abc');
    expect(await screen.findByText('LISTE')).toBeInTheDocument();
  });

  it('zeigt eine Fehleranzeige, wenn der Detail-Abruf scheitert', async () => {
    render(einsatzAktiv, basisSchaden(), [
      http.get('/api/einsaetze/1/schaeden/10', () => HttpResponse.json({ error: 'kaputt' }, { status: 500 })),
    ]);
    expect(await screen.findByText('Schaden konnte nicht geladen werden')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Erneut versuchen' })).toBeInTheDocument();
  });
});
