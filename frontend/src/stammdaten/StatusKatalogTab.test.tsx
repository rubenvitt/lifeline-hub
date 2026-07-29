import { http, HttpResponse } from 'msw';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import { AuthProvider } from '../auth/AuthContext';
import StatusKatalogTab from './StatusKatalogTab';

const admin = {
  id: 1, anzeigename: 'Admin', benutzername: 'admin', system_rolle: 'admin',
  org_rolle: 'keine', aktiv: true, erstellt_at: '2026-05-26 10:00:00',
};
const nichtAdmin = { ...admin, system_rolle: 'keiner' };

const status = [
  { id: 1, label: 'einsatzbereit', kategorie: 'verfuegbar', farbe: null, fms_anker: 1, sortier: 10 },
  { id: 2, label: 'disponiert', kategorie: 'gebunden', farbe: null, fms_anker: 3, sortier: 20 },
];

function render(benutzer: typeof admin, statusListe: typeof status = status) {
  server.use(
    http.get('/api/auth/me', () => HttpResponse.json(benutzer)),
    http.get('/api/fahrzeug-status', () => HttpResponse.json(statusListe)),
  );
  return renderMitProviders(
    <AuthProvider>
      <StatusKatalogTab />
    </AuthProvider>,
  );
}

describe('StatusKatalogTab', () => {
  it('zeigt Status mit Kategorie-Badge', async () => {
    render(admin);
    expect(await screen.findByText('einsatzbereit')).toBeInTheDocument();
    expect(screen.getByText('gebunden')).toBeInTheDocument();
  });

  it('Admin sieht „Status anlegen", Nicht-Admin nicht', async () => {
    render(admin);
    await screen.findByText('einsatzbereit');
    expect(screen.getByRole('button', { name: 'Status anlegen' })).toBeInTheDocument();
  });

  it('Nicht-Admin sieht keine Schreib-Aktionen', async () => {
    render(nichtAdmin);
    await screen.findByText('einsatzbereit');
    expect(screen.queryByRole('button', { name: 'Status anlegen' })).not.toBeInTheDocument();
  });

  it('Label sortierbar, Kategorie filterbar — die fachliche Reihenfolge bleibt Voreinstellung', async () => {
    /**
     * Der Vorrat oben steht in der Serverreihenfolge `ORDER BY sortier, id`
     * (`src/fahrzeug/status_repo.rs:44`): „einsatzbereit" (10) vor „disponiert" (20).
     * Alphabetisch wäre es umgekehrt — genau deshalb kann diese Prüfung fallen. Stünde
     * ein `defaultSortOrder` an der Label-Spalte, wäre die erste Erwartung rot; fehlte
     * der `sorter`, die zweite.
     *
     * Danach die zweite Achse: die Filterliste wird aus `theme/statusFarben.statusKategorie`
     * abgeleitet, ihre Einträge tragen deshalb das Anzeige-Label („verfügbar"), nicht den
     * Drahtwert (`verfuegbar`).
     *
     * `renderMitProviders` montiert `ConfigProvider` OHNE Locale — die Bestätigung im
     * Filtermenü heißt daher „OK", in en_US wie in de_DE derselbe Text.
     */
    const { container } = render(admin);
    await screen.findByText('einsatzbereit');
    // `tr.ant-table-row` verengt auf Datenzeilen: `sticky` schiebt eine verborgene
    // Messzeile als erste Körperzeile ein (Kopfkommentar von `KatalogTabelle`).
    const zeilen = () => container.querySelectorAll('tr.ant-table-row');

    expect(zeilen()[0].textContent).toContain('einsatzbereit');
    await userEvent.click(container.querySelector('th.ant-table-column-has-sorters')!);
    expect(zeilen()[0].textContent).toContain('disponiert');

    // Erst der Griff, dann der Klick: ohne diese Zwischenprüfung meldete die Probe
    // (Filter entfernt) erst zwölf Zeilen später ein leeres Filtermenü statt hier den
    // fehlenden Auslöser — gemessen.
    const ausloeser = container.querySelector<HTMLElement>('.ant-table-filter-trigger');
    expect(ausloeser, 'die Kategoriespalte muss einen Filter tragen').not.toBeNull();
    await userEvent.click(ausloeser!);
    // Das Filtermenü hängt in einem Portal an `document.body`, nicht im Container. Die
    // Auswahl wird DARIN gegriffen: „verfügbar" steht auch als Etikett in der
    // Kategoriespalte, ein Griff über `screen` träfe zwei Knoten.
    const menue = await waitFor(() => {
      const m = document.querySelector<HTMLElement>('.ant-table-filter-dropdown');
      expect(m).not.toBeNull();
      return m!;
    });
    await userEvent.click(within(menue).getByText('verfügbar'));
    await userEvent.click(within(menue).getByRole('button', { name: 'OK' }));

    await waitFor(() => expect(zeilen()).toHaveLength(1));
    expect(zeilen()[0].textContent).toContain('einsatzbereit');
  });

  it('die Freitextsuche greift den Rohwert — deshalb nennt der Platzhalter nur das Label', async () => {
    /**
     * Gemessen wird die WIRKUNG, nicht die Anwesenheit des `suche`-Props: ohne das Prop
     * rendert `KatalogTabelle` keine Werkzeugzeile, der Griff aufs Feld fällt dann schon
     * am `null`, bevor eine Zeile gezählt wird.
     *
     * Der zweite Teil pinnt die Begründung, die am Produktivcode nur als Prosa steht: die
     * Suche liest über `zellenWert` den ROHWERT der Spalte. Die Kategoriespalte zeigt
     * „verfügbar", trägt aber den Drahtwert `verfuegbar` — wer den Umlaut tippt, findet
     * nichts. Genau deshalb verspricht der Platzhalter nur „Label" und die Kategorie wird
     * vom Spaltenfilter oben bedient, nicht von der Suche.
     *
     * `userEvent.clear` zwischen den Läufen, damit die Begriffe sich nicht überlagern.
     */
    const { container } = render(admin);
    await screen.findByText('einsatzbereit');
    const zeilen = () => container.querySelectorAll('tr.ant-table-row');
    expect(zeilen()).toHaveLength(2);

    const feld = container.querySelector<HTMLInputElement>('input[type="search"]');
    expect(feld, 'der Statuskatalog muss ein Suchfeld tragen').not.toBeNull();
    expect(feld!.placeholder).toBe('Label');

    await userEvent.type(feld!, 'disponiert');
    expect(zeilen()).toHaveLength(1);
    expect(zeilen()[0].textContent).toContain('disponiert');

    await userEvent.clear(feld!);
    await userEvent.type(feld!, 'verfügbar');
    expect(zeilen()).toHaveLength(0);

    await userEvent.clear(feld!);
    await userEvent.type(feld!, 'verfuegbar');
    expect(zeilen()).toHaveLength(1);
    expect(zeilen()[0].textContent).toContain('einsatzbereit');
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
      http.get('/api/fahrzeug-status', () => new HttpResponse(null, { status: 500 })),
    );
    renderMitProviders(
      <AuthProvider>
        <StatusKatalogTab />
      </AuthProvider>,
    );

    expect(await screen.findByRole('button', { name: 'Erneut abrufen' })).toBeInTheDocument();
    expect(screen.queryByText('Kein Status')).not.toBeInTheDocument();
  });

  it('zeigt bei leerem Katalog den Leertext und KEINEN Fehler', async () => {
    render(admin, []);

    expect(await screen.findByText('Kein Status')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Erneut abrufen' })).not.toBeInTheDocument();
  });
});
