import { http, HttpResponse } from 'msw';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { meHandler, server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import StichworteTab from './StichworteTab';
import { adminFixture } from '../test/fixtures';

// Deckt das Admin-Gating der Stichwort-Sektion ab.

const admin = adminFixture();
const nichtAdmin = adminFixture({ system_rolle: 'keiner' });

// Voreinstellung bleibt EINE Zeile: die Prüfungen unten greifen „Löschen" per `getByRole`
// (Einzahl), eine zweite Zeile machte sie mehrdeutig.
function renderTab(benutzer: typeof admin, vorschlaege = [{ id: 1, text: 'H1' }]) {
  server.use(
    meHandler(benutzer),
    http.get('/api/stichwort-vorschlaege', () => HttpResponse.json(vorschlaege)),
  );
  return renderMitProviders(<StichworteTab />);
}

describe('StichworteTab', () => {
  it('zeigt geladene Stichworte', async () => {
    renderTab(admin);
    expect(await screen.findByText('H1')).toBeInTheDocument();
  });

  it('Admin sieht Hinzufügen und Löschen', async () => {
    renderTab(admin);
    await screen.findByText('H1');
    expect(screen.getByRole('button', { name: 'Hinzufügen' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Löschen' })).toBeInTheDocument();
  });

  /**
   * Zwei Zuschnitte (LFH-346): die PRIMÄRAKTION steht gesperrt — versteckt wäre „kein Recht"
   * von „diese Seite kann das nicht" nicht zu unterscheiden; den Grund nennt der Hinweis. Die
   * ZEILENAKTIONEN entfallen: n Zeilen × 2 gesperrte Knöpfe kosteten Platz für null
   * Handlungsmöglichkeit.
   */
  it('Nicht-Admin: Hinzufügen GESPERRT (samt Feld), Löschen weg', async () => {
    renderTab(nichtAdmin);
    await screen.findByText('H1');
    expect(screen.getByRole('button', { name: 'Hinzufügen' })).toBeDisabled();
    // Das Feld gehört mit dazu: ein gesperrter Knopf über einem beschreibbaren Feld
    // lädt zum Tippen ein, das nirgends ankommt.
    expect(screen.getByLabelText('Neues Stichwort')).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Löschen' })).not.toBeInTheDocument();
  });

  /**
   * Die EINZIGE unumkehrbare Aktion der Stammdaten (LFH-363): sonst heißt die destruktive
   * Aktion „Außer Dienst"/„Deaktivieren" mit ihrer Umkehrung daneben. Ein gelöschter Vorschlag
   * ist weg.
   *
   * Die erste Hälfte ist die eigentliche Aussage: der Klick auf „Löschen" allein darf die
   * Mutation NICHT auslösen — sonst wäre die zweite auch ohne Rückfrage grün.
   */
  it('Löschen fragt zurück, bevor es löscht', async () => {
    let geloescht: number | null = null;
    renderTab(admin);
    server.use(
      http.delete('/api/stichwort-vorschlaege/:id', ({ params }) => {
        geloescht = Number(params.id);
        return new HttpResponse(null, { status: 204 });
      }),
    );
    await screen.findByText('H1');

    await userEvent.click(screen.getByRole('button', { name: 'Löschen' }));
    expect(geloescht).toBeNull();

    await userEvent.click(await screen.findByRole('button', { name: 'Ja' }));
    await waitFor(() => expect(geloescht).toBe(1));
  });

  /**
   * Der Ladezustand gehört GENAU der gelöschten Zeile (LFH-346) — ein Spinner an jeder Zeile
   * behauptete einen Fortschritt an fremden Datensätzen.
   *
   * Die zweite Zeile ist die eigentliche Aussage. Die Rückfrage trägt hier `okText="Ja"`
   * (anders als in Fahrzeuge/Material/Personal mit antds „OK").
   */
  it('zeigt den Ladezustand NUR an der gelöschten Zeile', async () => {
    const { container } = renderTab(admin, [
      { id: 1, text: 'H1' },
      { id: 2, text: 'H2' },
    ]);
    server.use(http.delete('/api/stichwort-vorschlaege/:id', () => new Promise(() => {})));
    await screen.findByText('H1');
    const erste = container.querySelector('[data-row-key="1"]') as HTMLElement;
    const zweite = container.querySelector('[data-row-key="2"]') as HTMLElement;

    await userEvent.click(within(erste).getByRole('button', { name: 'Löschen' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Ja' }));

    await waitFor(() =>
      expect(within(erste).getByRole('button', { name: /Löschen/ })).toHaveClass('ant-btn-loading'),
    );
    expect(within(zweite).getByRole('button', { name: 'Löschen' })).not.toHaveClass(
      'ant-btn-loading',
    );
  });

  it('die Leitspalte sortiert numerisch, ohne die Serverreihenfolge zu verdrängen', async () => {
    /**
     * Der Vorrat folgt EINER Regel:
     *
     *   lexikografisch aufsteigend == Serverreihenfolge,
     *   numerisch aufsteigend      != Serverreihenfolge.
     *
     * `H10` vor `H2` erfüllt beides. Daraus folgt:
     *
     * 1. Die erste Erwartung pinnt, dass KEIN `defaultSortOrder` gesetzt ist. (Das Backend
     *    liefert `ORDER BY sortier, text`, und `sortier` steht der Antwort nicht bei; einmal
     *    weggeworfen, wäre die fachliche Reihenfolge nicht wiederherstellbar.)
     * 2. Die zweite pinnt den `sorter`: ohne ihn fiele schon der Griff auf den Sortierkopf.
     * 3. Sie pinnt zugleich `{ numeric: true }` — rein lexikografisch stünde `H10` weiter vorn.
     *    An einstelligen Nummern liefern beide Kollationen dasselbe, daher `H10`.
     *
     * Die Texte überlappen als Teilzeichenketten nicht — mit `H1` statt `H2` wäre `toContain` blind.
     */
    const { container } = renderTab(admin, [
      { id: 1, text: 'H10' },
      { id: 2, text: 'H2' },
    ]);
    await screen.findByText('H10');
    // `tr.ant-table-row` verengt auf Datenzeilen: `sticky` schiebt eine verborgene
    // Messzeile als erste Körperzeile ein (Kopfkommentar von `KatalogTabelle`).
    const ersteZeile = () => container.querySelector('tr.ant-table-row')!.textContent;

    expect(ersteZeile()).toContain('H10');

    // Erst der Griff, dann der Klick: sonst meldete ein fehlender `sorter` einen null-Zugriff
    // statt den fehlenden Sortierkopf.
    const kopf = container.querySelector<HTMLElement>('th.ant-table-column-has-sorters');
    expect(kopf, 'die Leitspalte muss sortierbar sein').not.toBeNull();
    await userEvent.click(kopf!);
    expect(ersteZeile()).toContain('H2');
  });

  it('die Freitextsuche verkleinert die Zeilenmenge', async () => {
    /**
     * Gemessen wird die WIRKUNG, nicht die Anwesenheit des `suche`-Props: ohne das Prop gibt es
     * kein Suchfeld, und der Griff fällt schon am `null`.
     *
     * `input[type="search"]` ist eindeutig: die Schnellerfassung unten ist ein `type="text"`.
     * Der Platzhalter sichert die Zuordnung zusätzlich ab.
     */
    const { container } = renderTab(admin, [
      { id: 1, text: 'H1' },
      { id: 2, text: 'B2' },
    ]);
    await screen.findByText('H1');
    const zeilen = () => container.querySelectorAll('tr.ant-table-row');
    expect(zeilen()).toHaveLength(2);

    const feld = container.querySelector<HTMLInputElement>('input[type="search"]');
    expect(feld, 'die Stichwort-Tabelle muss ein Suchfeld tragen').not.toBeNull();
    expect(feld!.placeholder).toBe('Stichwort');

    await userEvent.type(feld!, 'B2');
    expect(zeilen()).toHaveLength(1);
    expect(zeilen()[0].textContent).toContain('B2');
  });
  /**
   * Partnerpaar zu AK4 (LFH-331): die negative Hälfte allein wäre auch im Leerfall trivial
   * grün; erst die positive darunter mit demselben Literal macht sie zu einer Aussage über die
   * Zustandsweiche.
   */
  it('zeigt bei gescheitertem Abruf den Fehler und NICHT den Leertext', async () => {
    server.use(
      meHandler(admin),
      http.get('/api/stichwort-vorschlaege', () => new HttpResponse(null, { status: 500 })),
    );
    renderMitProviders(<StichworteTab />);

    expect(await screen.findByRole('button', { name: 'Erneut abrufen' })).toBeInTheDocument();
    expect(screen.queryByText('Noch keine Stichworte')).not.toBeInTheDocument();
  });

  it('zeigt bei leerem Katalog den Leertext und KEINEN Fehler', async () => {
    renderTab(admin, []);

    expect(await screen.findByText('Noch keine Stichworte')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Erneut abrufen' })).not.toBeInTheDocument();
  });
});
