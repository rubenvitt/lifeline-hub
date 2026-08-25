import { http, HttpResponse } from 'msw';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Route, Routes } from 'react-router';
import { server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import PersonalDetailPage from './PersonalDetailPage';
import PersonalTab from './PersonalTab';

/**
 * LFH-346 · A7 — die Personal-Detailroute. Gegenstück zu `FahrzeugDetailPage.test.tsx`;
 * dieselben vier Aussagen, an der Personal-Feldmenge gemessen.
 */

const admin = {
  id: 1, anzeigename: 'Admin', benutzername: 'admin', system_rolle: 'admin',
  org_rolle: 'keine', aktiv: true, erstellt_at: '2026-05-26 10:00:00',
};
const nichtAdmin = { ...admin, system_rolle: 'keiner' };

const person = {
  id: 5, name: 'Thomas Müller', personalnummer: 'P-42', traegerorganisation: 'DRK Musterstadt',
  telefon: '0170 1234567', staerke_position: 'fuehrer', benutzer_id: null, bemerkung: 'Springer',
  dienststatus: 'in_dienst', qualifikationen: [{ id: 1, label: 'Sanitäter' }],
  angelegt_at: '2026-05-26 09:00:00',
};

function handler(benutzer = admin, personal: unknown[] = [person], onPatch: (b: unknown) => void = () => {}) {
  server.use(
    http.get('/api/auth/me', () => HttpResponse.json(benutzer)),
    http.get('/api/personal', () => HttpResponse.json(personal)),
    http.get('/api/personal-vorschlaege', () => HttpResponse.json({ traegerorganisation: ['DRK Musterstadt'] })),
    http.get('/api/qualifikationen', () => HttpResponse.json([{ id: 1, label: 'Sanitäter', aktiv: true }])),
    http.get('/api/benutzer', () => HttpResponse.json([])),
    http.patch('/api/personal/5', async ({ request }) => {
      onPatch(await request.json());
      return HttpResponse.json(person);
    }),
  );
}

function renderRoute(pfad: string) {
  return renderMitProviders(
    <Routes>
      <Route path="/admin/stammdaten/personal" element={<PersonalTab />} />
      <Route path="/admin/stammdaten/personal/:personalId" element={<PersonalDetailPage />} />
    </Routes>,
    { route: pfad },
  );
}

describe('PersonalDetailPage (LFH-346 · A7)', () => {
  /**
   * `PersonalAnzeige` trägt jedes editierbare Feld von `PersonalEingabe` — deshalb genügt
   * die Listen-Query und es gibt keinen Einzel-GET. Der Abrufzähler ist die zweite Hälfte
   * dieser Aussage.
   */
  it('zeigt die Person aus der Listen-Query — auch die vier gewanderten Felder', async () => {
    let abrufe = 0;
    handler();
    server.use(
      http.get('/api/personal', () => {
        abrufe += 1;
        return HttpResponse.json([person]);
      }),
    );
    renderRoute('/admin/stammdaten/personal/5');

    expect(await screen.findByRole('heading', { name: 'Thomas Müller' })).toBeInTheDocument();
    expect(screen.getByLabelText('Telefon')).toHaveValue('0170 1234567');
    expect(screen.getByLabelText('Bemerkung')).toHaveValue('Springer');
    expect(screen.getByText('Führer')).toBeInTheDocument();
    expect(screen.getByLabelText('Benutzer-Konto (optional)')).toBeInTheDocument();
    expect(abrufe).toBe(1);
  });

  it('meldet eine unbekannte id statt ein leeres Formular zu zeigen', async () => {
    handler(admin, []);
    renderRoute('/admin/stammdaten/personal/999');

    expect(await screen.findByText('Person nicht gefunden')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Zur Personalliste' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Name')).not.toBeInTheDocument();
  });

  it('zeigt unter dem Pfad OHNE id weiterhin die Liste, nicht die Detailseite', async () => {
    handler();
    renderRoute('/admin/stammdaten/personal');

    expect(await screen.findByRole('button', { name: 'Person anlegen' })).toBeInTheDocument();
    expect(screen.queryByText('Erreichbarkeit & Konto')).not.toBeInTheDocument();
  });

  it('speichert den vollen Feldsatz in EINEM Absenden', async () => {
    const gesendet = vi.fn();
    handler(admin, [person], gesendet);
    const nutzer = userEvent.setup();
    renderRoute('/admin/stammdaten/personal/5');

    await nutzer.clear(await screen.findByLabelText('Telefon'));
    await nutzer.type(screen.getByLabelText('Telefon'), '0171 9');
    await nutzer.click(screen.getByRole('button', { name: 'Speichern' }));

    await waitFor(() => expect(gesendet).toHaveBeenCalledTimes(1));
    expect(gesendet.mock.calls[0][0]).toMatchObject({
      name: 'Thomas Müller',
      telefon: '0171 9',
      staerke_position: 'fuehrer',
      qualifikation_ids: [1],
      bemerkung: 'Springer',
    });
  });

  it('ohne Admin-Recht: Speichern gesperrt statt weg, mit Begründung', async () => {
    handler(nichtAdmin);
    renderRoute('/admin/stammdaten/personal/5');

    expect(await screen.findByRole('button', { name: 'Speichern' })).toBeDisabled();
    expect(screen.getByRole('alert')).toHaveTextContent(/Systemrolle/);
  });

  it('mit Admin-Recht ist derselbe Knopf bedienbar', async () => {
    handler(admin);
    renderRoute('/admin/stammdaten/personal/5');
    expect(await screen.findByRole('button', { name: 'Speichern' })).toBeEnabled();
  });

  it('leitet eine kaputte Route-ID auf die Liste um', async () => {
    handler();
    renderRoute('/admin/stammdaten/personal/0');

    expect(await screen.findByRole('button', { name: 'Person anlegen' })).toBeInTheDocument();
  });
});
