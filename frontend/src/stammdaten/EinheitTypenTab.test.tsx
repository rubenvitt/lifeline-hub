import { http, HttpResponse } from 'msw';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import { AuthProvider } from '../auth/AuthContext';
import EinheitTypenTab from './EinheitTypenTab';

const admin = {
  id: 1, anzeigename: 'Admin', benutzername: 'admin', system_rolle: 'admin',
  org_rolle: 'keine', aktiv: true, erstellt_at: '2026-05-26 10:00:00',
};
const nichtAdmin = { ...admin, system_rolle: 'keiner' };

const typen = [
  { id: 1, label: 'Zug', soll: { fuehrer: 1, unterfuehrer: 3, mannschaft: 18 }, sortier: 40 },
  { id: 2, label: 'Sonstige', soll: null, sortier: 50 },
];

function render(benutzer: typeof admin, katalog = typen) {
  server.use(
    http.get('/api/auth/me', () => HttpResponse.json(benutzer)),
    http.get('/api/einheit-typen', () => HttpResponse.json(katalog)),
  );
  return renderMitProviders(
    <AuthProvider>
      <EinheitTypenTab />
    </AuthProvider>,
  );
}

describe('EinheitTypenTab', () => {
  it('zeigt Typen mit Soll-Stärke und „—" bei fehlender Soll', async () => {
    render(nichtAdmin);
    expect(await screen.findByText('Zug')).toBeInTheDocument();
    expect(screen.getByText('1/3/18//22')).toBeInTheDocument();
    expect(screen.getByText('Sonstige')).toBeInTheDocument();
  });

  it('Admin sieht „Typ anlegen"', async () => {
    render(admin);
    await screen.findByText('Zug');
    expect(screen.getByRole('button', { name: 'Typ anlegen' })).toBeInTheDocument();
  });

  // Ordnung statt bloßer Anwesenheit: geprüft wird, was Sortierung und Suche mit den Zeilen TUN.
  // Die Leitspalte liegt in der ersten Zelle; die stehende Kopfzeile schiebt eine verborgene
  // Messzeile als erste Körperzeile ein, deshalb die Verengung auf `tr.ant-table-row`.
  it('sortiert nach Label und engt per Suche ein', async () => {
    const { container } = render(nichtAdmin);
    await screen.findByText('Zug');
    const labels = () =>
      Array.from(container.querySelectorAll('tr.ant-table-row td:first-child')).map(
        (z) => z.textContent,
      );

    // Voreinstellung ist die gelieferte Reihenfolge, nicht die alphabetische — die Vorgabe
    // steht bewusst un-alphabetisch (Zug vor Sonstige), sonst wäre die Zusicherung stumpf.
    // Dass das Backend nach `sortier` ordnet, kann dieser Test nicht prüfen: hier antwortet msw.
    expect(labels()).toEqual(['Zug', 'Sonstige']);

    await userEvent.click(screen.getByRole('columnheader', { name: /Label/ }));
    await waitFor(() => expect(labels()).toEqual(['Sonstige', 'Zug']));

    await userEvent.type(screen.getByPlaceholderText('Label'), 'Zug');
    await waitFor(() => expect(labels()).toEqual(['Zug']));
  });

  it('Nicht-Admin sieht keine Schreib-Aktionen', async () => {
    render(nichtAdmin);
    await screen.findByText('Zug');
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Typ anlegen' })).not.toBeInTheDocument(),
    );
  });

  /**
   * Das Partnerpaar zu AK4 (LFH-331 · B3). Die negative Hälfte allein belegte nichts:
   * änderte man den Leertext beim Umbau, wäre sie auch im Leerfall trivial grün. Erst
   * die positive Hälfte darunter — gleiches Literal, gleiche Datei — macht sie zu einer
   * Aussage über die Zustandsweiche statt über die Schreibweise eines Strings.
   */
  it('zeigt bei gescheitertem Abruf den Fehler und NICHT den Leertext', async () => {
    server.use(
      http.get('/api/auth/me', () => HttpResponse.json(admin)),
      http.get('/api/einheit-typen', () => new HttpResponse(null, { status: 500 })),
    );
    renderMitProviders(
      <AuthProvider>
        <EinheitTypenTab />
      </AuthProvider>,
    );

    expect(await screen.findByRole('button', { name: 'Erneut abrufen' })).toBeInTheDocument();
    expect(screen.queryByText('Kein Einheitstyp')).not.toBeInTheDocument();
  });

  it('zeigt bei leerem Katalog den Leertext und KEINEN Fehler', async () => {
    render(admin, []);

    expect(await screen.findByText('Kein Einheitstyp')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Erneut abrufen' })).not.toBeInTheDocument();
  });
});
