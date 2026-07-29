import { http, HttpResponse } from 'msw';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import { AuthProvider } from '../auth/AuthContext';
import FahrzeugeTab from './FahrzeugeTab';

const admin = {
  id: 1, anzeigename: 'Admin', benutzername: 'admin', system_rolle: 'admin',
  org_rolle: 'keine', aktiv: true, erstellt_at: '2026-05-26 10:00:00',
};
const nichtAdmin = { ...admin, system_rolle: 'keiner' };

const fahrzeug = {
  id: 1, funkrufname: 'Florian 1', fahrzeugtyp: 'LF 20', traegerorganisation: null,
  kennzeichen: 'XX-AB 1', opta: null, standort: null, fms_issi: null, sondersignal: false,
  tragenkapazitaet: null, staerke: { fuehrer: 0, unterfuehrer: 1, mannschaft: 8 },
  bemerkung: null, dienststatus: 'in_dienst', angelegt_at: '2026-05-26 10:00:00',
};

// Voreinstellung bleibt EIN Fahrzeug: die Bestandsprüfungen unten greifen „Bearbeiten"
// per `getByRole` (Einzahl), eine zweite Zeile brächte zwei gleichnamige Schaltflächen
// und ließe sie an der Mehrdeutigkeit scheitern statt an der Sache.
function render(benutzer: typeof admin, fahrzeuge = [fahrzeug]) {
  server.use(
    http.get('/api/auth/me', () => HttpResponse.json(benutzer)),
    http.get('/api/fahrzeuge', () => HttpResponse.json(fahrzeuge)),
    http.get('/api/fahrzeug-vorschlaege', () =>
      HttpResponse.json({ fahrzeugtyp: ['LF 20'], traegerorganisation: [], standort: [] }),
    ),
  );
  return renderMitProviders(
    <AuthProvider>
      <FahrzeugeTab />
    </AuthProvider>,
  );
}

describe('FahrzeugeTab', () => {
  it('zeigt Fahrzeuge inkl. Stärke', async () => {
    render(admin);
    expect(await screen.findByText('Florian 1')).toBeInTheDocument();
    expect(screen.getByText('0/1/8//9')).toBeInTheDocument();
  });

  it('Admin sieht „Fahrzeug anlegen" und Aktionen', async () => {
    render(admin);
    await screen.findByText('Florian 1');
    expect(screen.getByRole('button', { name: 'Fahrzeug anlegen' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Bearbeiten' })).toBeInTheDocument();
  });

  it('Nicht-Admin sieht keine Schreib-Aktionen', async () => {
    render(nichtAdmin);
    await screen.findByText('Florian 1');
    expect(screen.queryByRole('button', { name: 'Fahrzeug anlegen' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Bearbeiten' })).not.toBeInTheDocument();
  });

  it('der Statusfilter verkleinert die Zeilenmenge auf die gewählte Kategorie', async () => {
    /**
     * Gemessen wird die WIRKUNG (Zeilenmenge schrumpft, und zwar auf die richtige Zeile),
     * nicht die Anwesenheit des `filters`-Props. Zwei Fahrzeuge mit verschiedenem
     * Dienststatus sind das Mindeste, an dem ein Filter überhaupt etwas ändern kann.
     *
     * `renderMitProviders` montiert `ConfigProvider` OHNE Locale — die Bestätigung im
     * Filtermenü heißt daher „OK", in en_US wie in de_DE derselbe Text.
     */
    const { container } = render(admin, [
      fahrzeug,
      { ...fahrzeug, id: 2, funkrufname: 'Rotkreuz 2', dienststatus: 'ausser_dienst' },
    ]);
    await screen.findByText('Florian 1');
    const zeilen = () => container.querySelectorAll('tr.ant-table-row');
    expect(zeilen()).toHaveLength(2);

    // Erst der Griff, dann der Klick: ohne diese Zwischenprüfung meldete die Probe
    // (Filter entfernt) erst zwölf Zeilen später ein leeres Filtermenü statt hier den
    // fehlenden Auslöser — gemessen.
    const ausloeser = container.querySelector<HTMLElement>('.ant-table-filter-trigger');
    expect(ausloeser, 'die Statusspalte muss einen Filter tragen').not.toBeNull();
    await userEvent.click(ausloeser!);
    // Das Filtermenü hängt in einem Portal an `document.body`, nicht im Container. Die
    // Auswahl wird DARIN gegriffen, und zwar zwingend: „außer Dienst" steht zu diesem
    // Zeitpunkt auch als Etikett in der Statusspalte der zweiten Zeile. Gemessen — ein
    // Griff über `screen` bricht mit „Found multiple elements with the text: außer
    // Dienst" (`span.ant-tag` der Zeile gegen `span` des Menüeintrags).
    const menue = await waitFor(() => {
      const m = document.querySelector<HTMLElement>('.ant-table-filter-dropdown');
      expect(m).not.toBeNull();
      return m!;
    });
    await userEvent.click(within(menue).getByText('außer Dienst'));
    await userEvent.click(within(menue).getByRole('button', { name: 'OK' }));

    await waitFor(() => expect(zeilen()).toHaveLength(1));
    expect(zeilen()[0].textContent).toContain('Rotkreuz 2');
  });

  it('die Freitextsuche verkleinert die Zeilenmenge', async () => {
    /**
     * Gemessen wird die WIRKUNG, nicht die Anwesenheit des `suche`-Props — genau die
     * Lücke, die eine Mutationsjagd hier gefunden hat: das Prop entfernt, 32/32 grün.
     * Ohne das Prop rendert `KatalogTabelle` keine Werkzeugzeile, der Griff aufs Feld
     * fällt dann schon am `null`, bevor eine Zeile gezählt wird.
     *
     * Gesucht wird über den Typ, nicht über den Funkrufnamen: das belegt zugleich, dass
     * die Suche mehr als die Leitspalte liest, und damit den Platzhalter „Funkrufname,
     * Typ oder Kennzeichen". „RTW" kommt in keiner datenbezogenen Spalte des ersten
     * Fahrzeugs vor (`Florian 1` / `LF 20` / — / `XX-AB 1`).
     *
     * Kein `waitFor` um die Zählung: `userEvent.type` wickelt den Zustandslauf in `act`
     * ein, die gefilterte Menge steht danach. Die Filterprüfung oben braucht es, weil das
     * Menü im Portal erst erscheinen muss.
     */
    const { container } = render(admin, [
      fahrzeug,
      { ...fahrzeug, id: 2, funkrufname: 'Rotkreuz 2', fahrzeugtyp: 'RTW', kennzeichen: 'XX-CD 2' },
    ]);
    await screen.findByText('Florian 1');
    const zeilen = () => container.querySelectorAll('tr.ant-table-row');
    expect(zeilen()).toHaveLength(2);

    const feld = container.querySelector<HTMLInputElement>('input[type="search"]');
    expect(feld, 'die Fahrzeugtabelle muss ein Suchfeld tragen').not.toBeNull();
    expect(feld!.placeholder).toBe('Funkrufname, Typ oder Kennzeichen');

    await userEvent.type(feld!, 'RTW');
    expect(zeilen()).toHaveLength(1);
    expect(zeilen()[0].textContent).toContain('Rotkreuz 2');
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
      http.get('/api/fahrzeuge', () => new HttpResponse(null, { status: 500 })),
      http.get('/api/fahrzeug-vorschlaege', () =>
        HttpResponse.json({ fahrzeugtyp: [], traegerorganisation: [], standort: [] }),
      ),
    );
    renderMitProviders(
      <AuthProvider>
        <FahrzeugeTab />
      </AuthProvider>,
    );

    expect(await screen.findByRole('button', { name: 'Erneut abrufen' })).toBeInTheDocument();
    expect(screen.queryByText('Noch keine Fahrzeuge')).not.toBeInTheDocument();
  });

  it('zeigt bei leerem Katalog den Leertext und KEINEN Fehler', async () => {
    render(admin, []);

    expect(await screen.findByText('Noch keine Fahrzeuge')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Erneut abrufen' })).not.toBeInTheDocument();
  });
});
