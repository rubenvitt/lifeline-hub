import { http, HttpResponse } from 'msw';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import { AuthProvider } from '../auth/AuthContext';
import StichworteTab from './StichworteTab';

// Deckt das Admin-Gating der Stichwort-Sektion ab (früher via StammdatenPage.test, das mit
// der Sidebar-Umstellung entfällt — StichworteTab hatte keinen eigenen Test).

const admin = {
  id: 1, anzeigename: 'Admin', benutzername: 'admin', system_rolle: 'admin',
  org_rolle: 'keine', aktiv: true, erstellt_at: '2026-05-23 10:00:00',
};
const nichtAdmin = { ...admin, system_rolle: 'keiner' };

// Voreinstellung bleibt EINE Zeile: die Bestandsprüfungen unten greifen „Löschen" per
// `getByRole` (Einzahl), eine zweite Zeile brächte zwei gleichnamige Schaltflächen und
// ließe sie an der Mehrdeutigkeit scheitern statt an der Sache.
function renderTab(benutzer: typeof admin, vorschlaege = [{ id: 1, text: 'H1' }]) {
  server.use(
    http.get('/api/auth/me', () => HttpResponse.json(benutzer)),
    http.get('/api/stichwort-vorschlaege', () => HttpResponse.json(vorschlaege)),
  );
  return renderMitProviders(
    <AuthProvider>
      <StichworteTab />
    </AuthProvider>,
  );
}

describe('StichworteTab', () => {
  it('zeigt geladene Stichworte', async () => {
    renderTab(admin);
    expect(await screen.findByText('H1')).toBeInTheDocument();
  });

  it('Admin sieht Hinzufügen und Löschen', async () => {
    renderTab(admin);
    await screen.findByText('H1');
    expect(screen.getByRole('button', { name: 'Hinzufügen' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Löschen' })).toBeInTheDocument();
  });

  it('Nicht-Admin sieht weder Hinzufügen noch Löschen', async () => {
    renderTab(nichtAdmin);
    await screen.findByText('H1');
    expect(screen.queryByRole('button', { name: 'Hinzufügen' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Löschen' })).not.toBeInTheDocument();
  });

  it('die Leitspalte ist sortierbar, ohne die Serverreihenfolge zu verdrängen', async () => {
    /**
     * Der Vorrat kommt ABSTEIGEND aus dem Server-Stub. Das ist die Bedingung dafür, dass
     * die Zusicherung überhaupt fallen kann: antds erster Kopfklick sortiert aufsteigend,
     * bei einem bereits aufsteigenden Vorrat bliebe die Reihenfolge unverändert und der
     * Test wäre auch ohne `sorter` grün.
     *
     * Zwei Aussagen in einer Prüfung, beide nötig: die erste pinnt, dass KEIN
     * `defaultSortOrder` gesetzt ist (das Backend liefert `ORDER BY sortier, text`, und
     * `sortier` steht der Antwort nicht bei), die zweite den `sorter` selbst.
     */
    const { container } = renderTab(admin, [
      { id: 1, text: 'H2' },
      { id: 2, text: 'H1' },
    ]);
    await screen.findByText('H2');
    // `tr.ant-table-row` verengt auf Datenzeilen: `sticky` schiebt eine verborgene
    // Messzeile als erste Körperzeile ein (Kopfkommentar von `KatalogTabelle`).
    const ersteZeile = () => container.querySelector('tr.ant-table-row')!.textContent;

    expect(ersteZeile()).toContain('H2');

    await userEvent.click(container.querySelector('th.ant-table-column-has-sorters')!);
    expect(ersteZeile()).toContain('H1');
  });
});
