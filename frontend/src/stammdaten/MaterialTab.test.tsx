import { http, HttpResponse } from 'msw';
import { act, screen, waitFor, within } from '@testing-library/react';
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

  /**
   * LFH-346 · A1: eine laufende Mutation gehört GENAU EINER Zeile. Vorher sperrte
   * `dienststatusMutation.isPending` jede Zeile der Tabelle — bei 150 Zeilen eine
   * Vollsperre wegen eines Klicks.
   *
   * Die zweite Hälfte („Zeile B feuert wirklich") ist die eigentliche Aussage: ein
   * `toBeEnabled()` allein bliebe grün, wenn der Riegel im `onConfirm`
   * (`if (!…isPending)`) stehen bliebe — der Knopf sähe bedienbar aus und schluckte
   * den Klick. Muster aus `pages/BenutzerPage.test.tsx` („patchIds").
   *
   * Reihenfolge ist Absicht: EIN `useMutation`-Observer meldet nur den JÜNGSTEN Aufruf.
   * Nach dem Klick auf Zeile B wandert `variables` dorthin, Zeile A verliert ihre
   * Ladeanzeige, obwohl ihre Anfrage noch läuft. Alle A-Zusicherungen stehen deshalb
   * VOR dem zweiten Klick; „A und B laden gleichzeitig" wäre schlicht falsch.
   *
   * Zeile 2 steht bewusst auf `ausser_dienst`: ihre Aktion ist dann der schlichte
   * Knopf „Wieder in Dienst" ohne Rückfrage — sonst stünde ein zweites „OK" neben dem
   * noch offenen Portal der ersten.
   */
  it('sperrt beim Dienststatuswechsel NUR die betroffene Zeile', async () => {
    const gerufen: string[] = [];
    let freigeben: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => { freigeben = resolve; });
    server.use(
      http.post('/api/material/:id/ausser-dienst', async ({ params }) => {
        gerufen.push(`ausser-dienst/${params.id}`);
        await gate;
        return HttpResponse.json({ ...material, dienststatus: 'ausser_dienst' });
      }),
      http.post('/api/material/:id/in-dienst', async ({ params }) => {
        gerufen.push(`in-dienst/${params.id}`);
        await gate;
        return HttpResponse.json({ ...material, id: 2, dienststatus: 'in_dienst' });
      }),
    );
    const { container } = render(admin, [
      material,
      { ...material, id: 2, bezeichnung: 'Zeltbahn', dienststatus: 'ausser_dienst' },
    ]);
    await screen.findByText('Wolldecke');
    const erste = container.querySelector('[data-row-key="1"]') as HTMLElement;
    const zweite = container.querySelector('[data-row-key="2"]') as HTMLElement;

    await userEvent.click(within(erste).getByRole('button', { name: 'Außer Dienst' }));
    await userEvent.click(await screen.findByRole('button', { name: 'OK' }));

    // Die eigene Zeile ist gesperrt und zeigt den Lauf …
    expect(within(erste).getByRole('button', { name: /Außer Dienst/ })).toBeDisabled();
    expect(within(erste).getByRole('button', { name: /Außer Dienst/ })).toHaveClass('ant-btn-loading');
    expect(within(erste).getByRole('button', { name: 'Bearbeiten' })).toBeDisabled();
    // … die FREMDE Zeile bleibt bedienbar.
    expect(within(zweite).getByRole('button', { name: 'Bearbeiten' })).toBeEnabled();
    expect(within(zweite).getByRole('button', { name: 'Wieder in Dienst' })).toBeEnabled();
    expect(within(zweite).getByRole('button', { name: 'Wieder in Dienst' })).not.toHaveClass('ant-btn-loading');

    await userEvent.click(within(zweite).getByRole('button', { name: 'Wieder in Dienst' }));
    await waitFor(() => expect(gerufen).toEqual(['ausser-dienst/1', 'in-dienst/2']));
    await act(async () => { freigeben?.(); });
  });

  /**
   * Die Primäraktion ist seit LFH-346 · A3 SICHTBAR UND GESPERRT, die Zeilenaktionsspalte
   * bleibt weg. Zwei Zuschnitte, bewusst: der eine Knopf im Kopf soll den Grund nennen
   * können (M16 — ein fehlender Knopf ist von „diese Seite kann das gar nicht" nicht zu
   * unterscheiden), n Zeilen × 2 Knöpfe wären dagegen eine Spalte toter Knöpfe, die
   * waagerechten Platz für null Handlungsmöglichkeit kostet.
   */
  it('Nicht-Admin sieht die Primäraktion gesperrt und keine Zeilenaktionen', async () => {
    render(nichtAdmin);
    await screen.findByText('Wolldecke');
    expect(screen.getByRole('button', { name: 'Material anlegen' })).toBeDisabled();
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

  /**
   * Das Partnerpaar zu AK4 (LFH-331 · B3). Die negative Hälfte allein belegte nichts:
   * änderte man den Leertext beim Umbau, wäre sie auch im Leerfall trivial grün. Erst
   * die positive Hälfte darunter — gleiches Literal, gleiche Datei — macht sie zu einer
   * Aussage über die Zustandsweiche statt über die Schreibweise eines Strings.
   */
  it('zeigt bei gescheitertem Abruf den Fehler und NICHT den Leertext', async () => {
    server.use(
      http.get('/api/auth/me', () => HttpResponse.json(admin)),
      http.get('/api/material', () => new HttpResponse(null, { status: 500 })),
      http.get('/api/material-kategorien', () => HttpResponse.json([])),
    );
    renderMitProviders(
      <AuthProvider>
        <MaterialTab />
      </AuthProvider>,
    );

    expect(await screen.findByRole('button', { name: 'Erneut abrufen' })).toBeInTheDocument();
    expect(screen.queryByText('Noch kein Material')).not.toBeInTheDocument();
  });

  it('zeigt bei leerem Katalog den Leertext und KEINEN Fehler', async () => {
    render(admin, []);

    expect(await screen.findByText('Noch kein Material')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Erneut abrufen' })).not.toBeInTheDocument();
  });
});
