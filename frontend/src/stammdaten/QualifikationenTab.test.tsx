import { http, HttpResponse } from 'msw';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import { AuthProvider } from '../auth/AuthContext';
import QualifikationenTab from './QualifikationenTab';

const admin = {
  id: 1, anzeigename: 'Admin', benutzername: 'admin', system_rolle: 'admin',
  org_rolle: 'keine', aktiv: true, erstellt_at: '2026-05-26 10:00:00',
};
const nichtAdmin = { ...admin, system_rolle: 'keiner' };

/**
 * Die Fixture kommt in FACHLICHER Reihenfolge (`sortier` 10 vor 60), die zugleich NICHT die
 * alphabetische ist — sonst sähe die Tabelle nach dem Sortierklick genauso aus wie davor und
 * die Zusicherung unten bewiese nichts.
 */
const quals = [
  { id: 1, label: 'Sanitäter', sortier: 10 },
  { id: 2, label: 'Gruppenführer', sortier: 60 },
];

/** Die Leitspalte aller Datenzeilen — der Kopf ist ein eigenes `<table>`, siehe KatalogTabelle. */
const labels = (c: HTMLElement) =>
  [...c.querySelectorAll('tr.ant-table-row td:first-child')].map((z) => z.textContent);

// Die Fixture ist voreingestellt und bleibt es: der Ordnungs-Test unten hängt an genau
// diesen zwei Zeilen in genau dieser Reihenfolge. Der Parameter existiert allein für den
// leeren Katalog der AK4-Hälfte.
function render(benutzer: typeof admin, katalog: typeof quals = quals) {
  server.use(
    http.get('/api/auth/me', () => HttpResponse.json(benutzer)),
    http.get('/api/qualifikationen', () => HttpResponse.json(katalog)),
  );
  return renderMitProviders(
    <AuthProvider>
      <QualifikationenTab />
    </AuthProvider>,
  );
}

describe('QualifikationenTab', () => {
  it('zeigt Qualifikationen', async () => {
    render(admin);
    expect(await screen.findByText('Sanitäter')).toBeInTheDocument();
    expect(screen.getByText('Gruppenführer')).toBeInTheDocument();
  });

  it('Admin sieht „Qualifikation anlegen"', async () => {
    render(admin);
    await screen.findByText('Sanitäter');
    expect(screen.getByRole('button', { name: 'Qualifikation anlegen' })).toBeInTheDocument();
  });

  it('Nicht-Admin sieht keine Schreib-Aktionen', async () => {
    render(nichtAdmin);
    await screen.findByText('Sanitäter');
    expect(screen.queryByRole('button', { name: 'Qualifikation anlegen' })).not.toBeInTheDocument();
  });

  it('Ordnung: die Leitspalte sortiert, die Suche verengt, ein Filter fehlt mit Grund', async () => {
    const { container } = render(admin);
    await screen.findByText('Sanitäter');
    // Einstieg ist die fachliche Reihenfolge des Servers, nicht das Alphabet.
    expect(labels(container)).toEqual(['Sanitäter', 'Gruppenführer']);

    // Der Sortierauslöser sitzt in der Kopfzelle der fixierten Leitspalte. jsdom rechnet
    // dort kein Layout — dass der Klick auch am 390-px-Schirm ankommt, ist hier NICHT belegt.
    await userEvent.click(container.querySelector<HTMLElement>('th.ant-table-cell-fix-start')!);
    expect(labels(container)).toEqual(['Gruppenführer', 'Sanitäter']);

    await userEvent.type(container.querySelector<HTMLInputElement>('input[type="search"]')!, 'Sani');
    expect(labels(container)).toEqual(['Sanitäter']);

    // Kein Trichter, und das ist eine Aussage: der Katalog hat keine Status-/Kategoriespalte,
    // `aktiv` siebt schon der Server (`qualifikation_repo.rs:55`). Wer hier einen Filter
    // nachrüstet, ohne die Spalte zu haben, fällt hier auf.
    expect(container.querySelector('.ant-table-filter-trigger')).toBeNull();
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
      http.get('/api/qualifikationen', () => new HttpResponse(null, { status: 500 })),
    );
    renderMitProviders(
      <AuthProvider>
        <QualifikationenTab />
      </AuthProvider>,
    );

    expect(await screen.findByRole('button', { name: 'Erneut abrufen' })).toBeInTheDocument();
    expect(screen.queryByText('Keine Qualifikationen')).not.toBeInTheDocument();
  });

  it('zeigt bei leerem Katalog den Leertext und KEINEN Fehler', async () => {
    render(admin, []);

    expect(await screen.findByText('Keine Qualifikationen')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Erneut abrufen' })).not.toBeInTheDocument();
  });
});
