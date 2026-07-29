import { http, HttpResponse } from 'msw';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import { AuthProvider } from '../auth/AuthContext';
import MaterialTab from './MaterialTab';

const admin = {
  id: 1, anzeigename: 'Admin', benutzername: 'admin', system_rolle: 'admin',
  org_rolle: 'keine', aktiv: true, erstellt_at: '2026-05-27 10:00:00',
};
const nichtAdmin = { ...admin, system_rolle: 'keiner' };

const material = {
  id: 1, bezeichnung: 'Wolldecke', kategorie: 'Betreuung', bestandsnummer: null,
  traegerorganisation: null, standort: null, bemerkung: null,
  dienststatus: 'in_dienst', angelegt_at: '2026-05-27 10:00:00',
};

// Voreinstellung bleibt EIN Posten: die Bestandsprüfungen unten greifen „Bearbeiten" per
// `getByRole` (Einzahl), eine zweite Zeile brächte zwei gleichnamige Schaltflächen und
// ließe sie an der Mehrdeutigkeit scheitern statt an der Sache.
function render(benutzer: typeof admin, posten = [material]) {
  server.use(
    http.get('/api/auth/me', () => HttpResponse.json(benutzer)),
    http.get('/api/material', () => HttpResponse.json(posten)),
    http.get('/api/material-kategorien', () => HttpResponse.json(['Betreuung'])),
  );
  return renderMitProviders(
    <AuthProvider>
      <MaterialTab />
    </AuthProvider>,
  );
}

describe('MaterialTab', () => {
  it('zeigt Material', async () => {
    render(admin);
    expect(await screen.findByText('Wolldecke')).toBeInTheDocument();
    expect(screen.getByText('Betreuung')).toBeInTheDocument();
  });

  it('Admin sieht „Material anlegen" und Aktionen', async () => {
    render(admin);
    await screen.findByText('Wolldecke');
    expect(screen.getByRole('button', { name: 'Material anlegen' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Bearbeiten' })).toBeInTheDocument();
  });

  it('Nicht-Admin sieht keine Schreib-Aktionen', async () => {
    render(nichtAdmin);
    await screen.findByText('Wolldecke');
    expect(screen.queryByRole('button', { name: 'Material anlegen' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Bearbeiten' })).not.toBeInTheDocument();
  });

  it('die Freitextsuche verkleinert die Zeilenmenge', async () => {
    /**
     * Gemessen wird die WIRKUNG, nicht die Anwesenheit des `suche`-Props. Ohne das Prop
     * rendert `KatalogTabelle` gar kein Suchfeld — der Griff darauf scheitert dann schon
     * am `null`, bevor eine Zeile gezählt wird.
     *
     * Gesucht wird über die Kategorie, nicht über die Bezeichnung: das belegt zugleich,
     * dass die Suche mehr als die Leitspalte liest, und damit den Platzhalter
     * „Bezeichnung oder Kategorie".
     */
    const { container } = render(admin, [
      material,
      { ...material, id: 2, bezeichnung: 'Zeltbahn', kategorie: 'Technik' },
    ]);
    await screen.findByText('Wolldecke');
    const zeilen = () => container.querySelectorAll('tr.ant-table-row');
    expect(zeilen()).toHaveLength(2);

    const feld = container.querySelector<HTMLInputElement>('input[type="search"]')!;
    expect(feld.placeholder).toBe('Bezeichnung oder Kategorie');

    await userEvent.type(feld, 'Technik');
    expect(zeilen()).toHaveLength(1);
    expect(zeilen()[0].textContent).toContain('Zeltbahn');
  });
});
