import { http, HttpResponse } from 'msw';
import { screen, waitFor } from '@testing-library/react';
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

  /**
   * Die EINZIGE unumkehrbare Aktion der Stammdaten (LFH-363 · B5c): überall sonst heißt
   * die destruktive Aktion „Außer Dienst"/„Deaktivieren" und hat ihre Umkehrung als
   * Knopf daneben. Ein gelöschter Vorschlag ist weg.
   *
   * Die erste Hälfte ist die eigentliche Aussage — ohne sie wäre die zweite auch mit
   * einem Knopf ganz ohne Blase grün: der Klick auf „Löschen" allein darf die Mutation
   * NICHT auslösen.
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

  it('die Leitspalte sortiert numerisch, ohne die Serverreihenfolge zu verdrängen', async () => {
    /**
     * Der Vorrat ist nach EINER Regel gewählt, und nur sie macht alle drei Aussagen
     * dieser Prüfung tötbar:
     *
     *   lexikografisch aufsteigend == Serverreihenfolge,
     *   numerisch aufsteigend      != Serverreihenfolge.
     *
     * `H10` vor `H2` erfüllt beides. Daraus folgt Stück für Stück:
     *
     * 1. Die erste Erwartung pinnt, dass KEIN `defaultSortOrder` gesetzt ist — ein
     *    aufsteigender Default zöge `H2` nach oben. (Das Backend liefert
     *    `ORDER BY sortier, text`, und `sortier` steht der Antwort nicht bei; einmal
     *    weggeworfen, wäre die fachliche Reihenfolge nicht wiederherstellbar.)
     * 2. Die zweite pinnt den `sorter` überhaupt: ohne ihn trüge der Kopf keinen
     *    Auslöser, und der benannte Griff darunter fiele statt eines null-Zugriffs.
     * 3. Sie pinnt zugleich `{ numeric: true }` — rein lexikografisch stünde `H10`
     *    weiter vorn und die Reihenfolge bliebe unverändert. Gemessen: mit dem alten
     *    Vorrat `H2`/`H1` lief genau diese Mutation grün durch, weil an einstelligen
     *    Nummern beide Kollationen dasselbe Ergebnis liefern.
     *
     * Die beiden Texte überlappen als Teilzeichenketten nicht („H10Löschen" enthält kein
     * „H2", „H2Löschen" kein „H10") — mit `H1` statt `H2` wäre `toContain` blind.
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

    // Erst der Griff, dann der Klick: sonst meldet die Probe (`sorter` entfernt) einen
    // null-Zugriff statt den fehlenden Sortierkopf — dasselbe Muster wie beim Filter.
    const kopf = container.querySelector<HTMLElement>('th.ant-table-column-has-sorters');
    expect(kopf, 'die Leitspalte muss sortierbar sein').not.toBeNull();
    await userEvent.click(kopf!);
    expect(ersteZeile()).toContain('H2');
  });

  it('die Freitextsuche verkleinert die Zeilenmenge', async () => {
    /**
     * Gemessen wird die WIRKUNG, nicht die Anwesenheit des `suche`-Props: ohne das Prop
     * rendert `KatalogTabelle` gar keine Werkzeugzeile, der Griff aufs Feld fällt dann
     * schon am `null`, bevor eine Zeile gezählt wird.
     *
     * `input[type="search"]` ist hier eindeutig, obwohl die Seite ein zweites Eingabefeld
     * trägt: die Schnellerfassung unten ist ein blankes `Input` (`type="text"`). Der
     * Platzhalter sichert die Zuordnung zusätzlich ab.
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
   * Das Partnerpaar zu AK4 (LFH-331 · B3). Die negative Hälfte allein belegte nichts:
   * änderte man den Leertext beim Umbau, wäre sie auch im Leerfall trivial grün. Erst
   * die positive Hälfte darunter — gleiches Literal, gleiche Datei — macht sie zu einer
   * Aussage über die Zustandsweiche statt über die Schreibweise eines Strings.
   */
  it('zeigt bei gescheitertem Abruf den Fehler und NICHT den Leertext', async () => {
    server.use(
      http.get('/api/auth/me', () => HttpResponse.json(admin)),
      http.get('/api/stichwort-vorschlaege', () => new HttpResponse(null, { status: 500 })),
    );
    renderMitProviders(
      <AuthProvider>
        <StichworteTab />
      </AuthProvider>,
    );

    expect(await screen.findByRole('button', { name: 'Erneut abrufen' })).toBeInTheDocument();
    expect(screen.queryByText('Noch keine Stichworte')).not.toBeInTheDocument();
  });

  it('zeigt bei leerem Katalog den Leertext und KEINEN Fehler', async () => {
    renderTab(admin, []);

    expect(await screen.findByText('Noch keine Stichworte')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Erneut abrufen' })).not.toBeInTheDocument();
  });
});
