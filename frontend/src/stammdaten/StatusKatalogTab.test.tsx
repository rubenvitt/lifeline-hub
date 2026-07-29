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

/**
 * Die Feldtypen stehen ausgeschrieben da, statt aus den Werten geschlossen zu werden:
 * `farbe` und `fms_anker` sind hier zufällig überall `null` bzw. gesetzt, und aus dem
 * Vorrat abgeleitet hiessen sie `null` und `number` — ein Vorrat mit gesetzter Farbe
 * (Prüfung „erbt keine Werte", ganz unten) liesse sich dann gar nicht erst übergeben.
 */
const status: {
  id: number;
  label: string;
  kategorie: string;
  farbe: string | null;
  fms_anker: number | null;
  sortier: number;
}[] = [
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

  /**
   * LFH-332 · B4. Geprüft wird der RUMPF, nicht bloß, dass gesendet wurde: der
   * Anlege-Zweig setzt seine fünf Felder jetzt von Hand zusammen. `kategorie` ist
   * darunter die Vorgabe, die zu einem SICHTBAR falschen Datensatz führt — ein
   * Fahrzeugstatus in der falschen Kategorie färbt jede Kräfteübersicht falsch ein;
   * `fms_anker: null` hält den Anker frei, statt eine Ziffer zu erfinden. Ein Test,
   * der nur zählt, bliebe bei beidem grün.
   *
   * Der Knopf trägt weiter den Namen des gestrichenen Dialog-Knopfes, deshalb sind
   * die Rechte-Prüfungen oben unverändert gültig.
   */
  it('die Schnellerfassung legt mit Label und den Vorgaben des alten Dialogs an', async () => {
    const ruempfe: unknown[] = [];
    server.use(
      http.post('/api/fahrzeug-status', async ({ request }) => {
        ruempfe.push(await request.json());
        return HttpResponse.json({
          id: 9, label: 'nicht einsatzbereit', kategorie: 'gebunden',
          farbe: null, fms_anker: null, sortier: 0,
        });
      }),
    );
    render(admin);
    await screen.findByText('einsatzbereit');

    await userEvent.type(
      screen.getByLabelText('Neuer Fahrzeug-Status'),
      'nicht einsatzbereit{Enter}',
    );

    await waitFor(() =>
      expect(ruempfe).toEqual([{
        label: 'nicht einsatzbereit',
        kategorie: 'gebunden',
        farbe: null,
        fms_anker: null,
        sortier: 0,
      }]),
    );
  });

  /**
   * Der Dialog ist seit LFH-332 · B4 reines Bearbeiten. Ohne diese Prüfung schiffe
   * eine kaputte Vorbelegung mit vollständig grüner Suite: kein anderer Test dieser
   * Datei öffnet ihn.
   */
  it('Bearbeiten öffnet den Dialog mit vorbelegten Werten', async () => {
    render(admin);
    await screen.findByText('einsatzbereit');

    await userEvent.click(screen.getAllByRole('button', { name: 'Bearbeiten' })[0]);

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Status bearbeiten')).toBeInTheDocument();
    expect(within(dialog).getByLabelText('Label')).toHaveValue('einsatzbereit');
    expect(within(dialog).getByLabelText('FMS-Anker (0–9, optional)')).toHaveValue('1');
  });

  /**
   * Der zweite Datensatz darf nicht die Werte des ersten erben.
   *
   * Seit LFH-332 · B4 ist der Dialog reines Bearbeiten, und die Vorbelegung setzt
   * KEIN `resetFields()` davor. Die Sorge dabei ist antds Wertespeicher: der
   * überlebt das Schliessen, und ein `setFieldsValue({ fms_anker: undefined })`
   * könnte einen Schlüssel mit `undefined` als „nicht gemeint" behandeln, statt zu
   * leeren — dann trüge der zweite Status Farbe und FMS-Anker des ersten.
   *
   * GEMESSEN: er tut es nicht. Diese Prüfung bleibt auch grün, wenn man
   * `destroyOnHidden` am Dialog entfernt — rc-field-form schreibt den `undefined`
   * durch. Sie pinnt deshalb bewusst das ERGEBNIS und keinen der beiden
   * Mechanismen: fällt einer von beiden bei einem antd-Sprung weg, ist das hier
   * die Stelle, an der es auffällt, statt in einem stillen Datensatz mit fremdem
   * FMS-Anker.
   *
   * Der Vorrat ist eigens dafür gewählt: der erste Eintrag hat beide optionalen
   * Felder gesetzt, der zweite keines davon.
   */
  it('ein zweiter Datensatz erbt keine Werte des ersten', async () => {
    render(admin, [
      { id: 1, label: 'einsatzbereit', kategorie: 'verfuegbar', farbe: '#112233', fms_anker: 5, sortier: 10 },
      { id: 2, label: 'disponiert', kategorie: 'gebunden', farbe: null, fms_anker: null, sortier: 20 },
    ]);
    await screen.findByText('einsatzbereit');

    await userEvent.click(screen.getAllByRole('button', { name: 'Bearbeiten' })[0]);
    const ersterDialog = await screen.findByRole('dialog');
    expect(within(ersterDialog).getByLabelText('FMS-Anker (0–9, optional)')).toHaveValue('5');
    await userEvent.click(within(ersterDialog).getByRole('button', { name: /Cancel|Abbrechen/ }));

    await userEvent.click(screen.getAllByRole('button', { name: 'Bearbeiten' })[1]);
    const zweiterDialog = await screen.findByRole('dialog');
    await waitFor(() =>
      expect(within(zweiterDialog).getByLabelText('Label')).toHaveValue('disponiert'),
    );
    expect(within(zweiterDialog).getByLabelText('FMS-Anker (0–9, optional)')).toHaveValue('');
    expect(within(zweiterDialog).getByLabelText('Farbe (Hex, optional)')).toHaveValue('');
  });
});
