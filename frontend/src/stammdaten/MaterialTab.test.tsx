import { http, HttpResponse } from 'msw';
import { screen, waitFor, within } from '@testing-library/react';
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

  it('der Statusfilter verkleinert die Zeilenmenge auf die gewählte Kategorie', async () => {
    /**
     * Gemessen wird die WIRKUNG (Zeilenmenge schrumpft, und zwar auf die richtige Zeile),
     * nicht die Anwesenheit von `filters`/`onFilter` — genau die Lücke, die eine
     * Mutationsjagd hier gefunden hat: beide Eigenschaften entfernt, 32/32 grün. Zwei
     * Posten mit verschiedenem Dienststatus sind das Mindeste, an dem ein Filter
     * überhaupt etwas ändern kann.
     *
     * Die Statusspalte trägt bewusst KEINEN `dataIndex` (Begründung am Produktivcode) —
     * `onFilter` liest den Datensatz selbst. Dass das trägt, belegt diese Prüfung mit.
     *
     * `renderMitProviders` montiert `ConfigProvider` OHNE Locale — die Bestätigung im
     * Filtermenü heißt daher „OK", in en_US wie in de_DE derselbe Text.
     */
    const { container } = render(admin, [
      material,
      { ...material, id: 2, bezeichnung: 'Zeltbahn', dienststatus: 'ausser_dienst' },
    ]);
    await screen.findByText('Wolldecke');
    const zeilen = () => container.querySelectorAll('tr.ant-table-row');
    expect(zeilen()).toHaveLength(2);

    // Erst der Griff, dann der Klick: ohne diese Zwischenprüfung meldete die Probe
    // (Filter entfernt) erst zwölf Zeilen später ein leeres Filtermenü statt hier den
    // fehlenden Auslöser — im Schwestertest `FahrzeugeTab` gemessen.
    const ausloeser = container.querySelector<HTMLElement>('.ant-table-filter-trigger');
    expect(ausloeser, 'die Statusspalte muss einen Filter tragen').not.toBeNull();
    await userEvent.click(ausloeser!);
    // Das Filtermenü hängt in einem Portal an `document.body`, nicht im Container. Die
    // Auswahl wird DARIN gegriffen, und zwar zwingend: „außer Dienst" steht zu diesem
    // Zeitpunkt auch als Etikett in der Statusspalte der zweiten Zeile — ein Griff über
    // `screen` träfe zwei Knoten (`span.ant-tag` der Zeile gegen `span` des Eintrags).
    const menue = await waitFor(() => {
      const m = document.querySelector<HTMLElement>('.ant-table-filter-dropdown');
      expect(m).not.toBeNull();
      return m!;
    });
    await userEvent.click(within(menue).getByText('außer Dienst'));
    await userEvent.click(within(menue).getByRole('button', { name: 'OK' }));

    await waitFor(() => expect(zeilen()).toHaveLength(1));
    expect(zeilen()[0].textContent).toContain('Zeltbahn');
  });

  it('die Leitspalte sortiert numerisch, ohne die Serverreihenfolge zu verdrängen', async () => {
    /**
     * Der Vorrat ist nach EINER Regel gewählt, und nur sie macht alle drei Aussagen
     * tötbar:
     *
     *   lexikografisch aufsteigend == Serverreihenfolge,
     *   numerisch aufsteigend      != Serverreihenfolge.
     *
     * „B-Schlauch 20 m" vor „B-Schlauch 5 m" erfüllt beides: das Backend liefert
     * `ORDER BY bezeichnung` (`src/material/repo.rs:54`) über SQLites BINARY-Vergleich,
     * dort steht „2" vor „5". Daraus folgt:
     *
     * 1. Die erste Erwartung pinnt, dass KEIN `defaultSortOrder` gesetzt ist — ein
     *    aufsteigender Default zöge „5 m" nach oben.
     * 2. Die zweite pinnt den `sorter` überhaupt; fehlt er, fällt schon der benannte
     *    Griff auf den Sortierkopf.
     * 3. Sie pinnt zugleich `{ numeric: true }` — rein lexikografisch bliebe „20 m"
     *    vorn und die Reihenfolge unverändert. Genau der Fall, für den der
     *    Produktivkommentar die Größenangabe als Begründung nennt.
     */
    const { container } = render(admin, [
      { ...material, id: 1, bezeichnung: 'B-Schlauch 20 m' },
      { ...material, id: 2, bezeichnung: 'B-Schlauch 5 m' },
    ]);
    await screen.findByText('B-Schlauch 20 m');
    const ersteZeile = () => container.querySelector('tr.ant-table-row')!.textContent;

    expect(ersteZeile()).toContain('B-Schlauch 20 m');

    // Erst der Griff, dann der Klick: sonst meldet die Probe (`sorter` entfernt) einen
    // null-Zugriff statt den fehlenden Sortierkopf.
    const kopf = container.querySelector<HTMLElement>('th.ant-table-column-has-sorters');
    expect(kopf, 'die Leitspalte muss sortierbar sein').not.toBeNull();
    await userEvent.click(kopf!);
    expect(ersteZeile()).toContain('B-Schlauch 5 m');
  });
});
