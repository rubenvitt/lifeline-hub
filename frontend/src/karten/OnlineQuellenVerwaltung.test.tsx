import { http, HttpResponse } from 'msw';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import { AuthProvider } from '../auth/AuthContext';
import type { OnlineQuelle } from '../api/onlineQuellen';
import OnlineQuellenVerwaltung from './OnlineQuellenVerwaltung';

const admin = {
  id: 1, anzeigename: 'Admin', benutzername: 'admin', system_rolle: 'admin',
  org_rolle: 'keine', aktiv: true, erstellt_at: '2026-06-26 10:00:00',
};
// AdminLayout lässt admin ODER fuehrungskraft auf die Seite; nur admin darf schreiben.
const fuehrungskraft = {
  ...admin, id: 2, anzeigename: 'Eva', system_rolle: 'keiner', org_rolle: 'fuehrungskraft',
};

const quelle: OnlineQuelle = {
  id: 1, name: 'OpenStreetMap', url: 'https://tile.osm.org/{z}/{x}/{y}.png',
  typ: 'raster', attribution: '© OSM-Mitwirkende', sortier: 0, aktiv: true, proxy: false,
};

const katalogEintrag = {
  name: 'OpenFreeMap Liberty', url: 'https://tiles.openfreemap.org/styles/liberty',
  typ: 'vektor' as const, attribution: '© OpenFreeMap',
};

function mockBasis(benutzer: typeof admin, quellen: OnlineQuelle[] = [quelle]) {
  server.use(
    http.get('/api/auth/me', () => HttpResponse.json(benutzer)),
    http.get('/api/karte/online-quellen', () => HttpResponse.json(quellen)),
    http.get('/api/karte/online-quellen/katalog', () => HttpResponse.json([katalogEintrag])),
  );
}

function render() {
  return renderMitProviders(
    <AuthProvider>
      <OnlineQuellenVerwaltung />
    </AuthProvider>,
  );
}

describe('OnlineQuellenVerwaltung', () => {
  it('zeigt die Online-Quellen (Name/URL/Attribution/Typ)', async () => {
    mockBasis(admin);
    render();
    expect(await screen.findByText('OpenStreetMap')).toBeInTheDocument();
    expect(screen.getByText('https://tile.osm.org/{z}/{x}/{y}.png')).toBeInTheDocument();
    expect(screen.getByText('© OSM-Mitwirkende')).toBeInTheDocument();
    // Typ als Tag — über Inhalt, nicht über Farbklasse.
    expect(screen.getByText('raster')).toBeInTheDocument();
  });

  // ── Ordnung der Katalogtabelle (LFH-330 · AP5) ──────────────────────────────────
  // Geprüft wird durchweg die WIRKUNG auf die Zeilenmenge, nicht die Anwesenheit eines
  // Props. Die stehende Kopfzeile schiebt eine verborgene Messzeile als erste Körperzeile
  // ein — deshalb überall die Verengung auf `tr.ant-table-row`.

  const zweiteQuelle: OnlineQuelle = {
    ...quelle, id: 2, name: 'Basemap.de', url: 'https://basemap.de/style.json',
    typ: 'vektor', attribution: '© GeoBasis-DE', sortier: 1, aktiv: false,
  };

  it('sortiert nach Name und engt per Suche ein', async () => {
    mockBasis(admin, [quelle, zweiteQuelle]);
    const { container } = render();
    await screen.findByText('OpenStreetMap');
    const namen = () =>
      Array.from(container.querySelectorAll('tr.ant-table-row td:first-child')).map(
        (z) => z.textContent,
      );

    // Voreinstellung ist die gelieferte Reihenfolge (Backend: ORDER BY sortier, id), nicht
    // die alphabetische — die Vorgabe steht bewusst un-alphabetisch, sonst wäre die
    // Zusicherung stumpf und ein versehentliches `defaultSortOrder` bliebe unbemerkt.
    expect(namen()).toEqual(['OpenStreetMap', 'Basemap.de']);

    await userEvent.click(screen.getByRole('columnheader', { name: /Name/ }));
    await waitFor(() => expect(namen()).toEqual(['Basemap.de', 'OpenStreetMap']));

    await userEvent.type(screen.getByPlaceholderText('Name, URL oder Attribution'), 'OpenStreetMap');
    await waitFor(() => expect(namen()).toEqual(['OpenStreetMap']));
  });

  it('der Aktiv-Filter verkleinert die Zeilenmenge auf die gewählte Kategorie', async () => {
    mockBasis(admin, [quelle, zweiteQuelle]);
    const { container } = render();
    await screen.findByText('OpenStreetMap');
    const zeilen = () => container.querySelectorAll('tr.ant-table-row');
    expect(zeilen()).toHaveLength(2);

    // Erst den Griff belegen, dann klicken: sonst meldete die Probe (Filter entfernt) ein
    // leeres Filtermenü statt den fehlenden Auslöser. „Aktiv" ist die einzige Spalte mit
    // Filter, der Auslöser ist damit eindeutig.
    const ausloeser = container.querySelector<HTMLElement>('.ant-table-filter-trigger');
    expect(ausloeser, 'die Aktiv-Spalte muss einen Filter tragen').not.toBeNull();
    await userEvent.click(ausloeser!);

    // Das Filtermenü hängt in einem Portal an `document.body`, nicht im Container — und
    // „inaktiv" steht zu diesem Zeitpunkt auch als Etikett in der zweiten Zeile. Der Griff
    // muss deshalb IM Menü erfolgen, sonst ist er mehrdeutig.
    const menue = await waitFor(() => {
      const m = document.querySelector<HTMLElement>('.ant-table-filter-dropdown');
      expect(m).not.toBeNull();
      return m!;
    });
    await userEvent.click(within(menue).getByText('inaktiv'));
    await userEvent.click(within(menue).getByRole('button', { name: 'OK' }));

    await waitFor(() => expect(zeilen()).toHaveLength(1));
    expect(zeilen()[0].textContent).toContain('Basemap.de');
  });

  it('der Wahrheitswert der Aktiv-Spalte bleibt außerhalb der Freitextsuche', async () => {
    /**
     * Die Kehrseite des fehlenden `dataIndex` an der Aktiv-Spalte, und der Grund, warum sie
     * einen Filter trägt. Zwei Ausfälle hängen an dieser Zusicherung:
     *
     * - `dataIndex: 'aktiv'` wieder gesetzt → `String(true)` landet im Suchkorpus, „true"
     *   trifft jede aktive Quelle. Ein Wort, das in keiner Zelle steht.
     * - `dataIndex` weg, `render` aber nicht nachgezogen → das erste Render-Argument ist der
     *   DATENSATZ statt des Wahrheitswerts, also immer wahr, und jede Zeile behauptet
     *   „aktiv". Kein Fehler, kein Absturz — deshalb steht die Etikettprüfung daneben.
     */
    mockBasis(admin, [quelle, zweiteQuelle]);
    const { container } = render();
    await screen.findByText('OpenStreetMap');
    const zeilen = () => container.querySelectorAll('tr.ant-table-row');
    expect(zeilen()).toHaveLength(2);

    // Etiketten über ihren Text, nie über die Farbklasse (.ant-tag-green ist nicht eindeutig).
    // „aktiv" steckt als Teilzeichenkette in „inaktiv" — die erste Zeile wird deshalb über
    // die ABWESENHEIT von „inaktiv" belegt, sonst wäre die Zusicherung in beide Richtungen
    // erfüllbar und die halbe Rückdrehung (jede Zeile behauptet „aktiv") bliebe grün.
    expect(zeilen()[0].textContent).not.toContain('inaktiv');
    expect(zeilen()[1].textContent).toContain('inaktiv');

    await userEvent.type(screen.getByPlaceholderText('Name, URL oder Attribution'), 'true');
    await waitFor(() => expect(zeilen()).toHaveLength(0));
  });

  it('Admin sieht Schreibaktionen', async () => {
    mockBasis(admin);
    render();
    await screen.findByText('OpenStreetMap');
    expect(screen.getByRole('button', { name: 'Quelle hinzufügen' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Aus Katalog hinzufügen' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Bearbeiten' })).toBeInTheDocument();
  });

  it('Führungskraft sieht keine Schreibaktionen (read-only)', async () => {
    mockBasis(fuehrungskraft);
    render();
    await screen.findByText('OpenStreetMap');
    expect(screen.queryByRole('button', { name: 'Quelle hinzufügen' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Aus Katalog hinzufügen' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Bearbeiten' })).not.toBeInTheDocument();
  });

  /**
   * Das Partnerpaar zu AK4 (LFH-331 · B3), zusammen mit dem Leerfall darunter. Die negative
   * Hälfte allein belegte nichts: formulierte jemand den Leertext um, wäre sie auch im
   * Leerfall trivial grün. Erst die positive Hälfte — gleiches Literal, gleiche Datei —
   * macht daraus eine Aussage über die Zustandsweiche statt über die Schreibweise.
   *
   * Die Meldung wird als EXAKTES Literal gegriffen, nicht als Teilmuster: der Umzug auf das
   * Primitiv soll nachweisbar verhaltensgleich sein, und ein `/nicht geladen/i` bliebe auch
   * unter einem umformulierten Text grün.
   */
  it('zeigt eine Fehlermeldung statt stiller Leere, wenn die Liste nicht lädt', async () => {
    server.use(
      http.get('/api/auth/me', () => HttpResponse.json(admin)),
      http.get('/api/karte/online-quellen', () =>
        HttpResponse.json({ error: 'Kartenregistry nicht erreichbar' }, { status: 500 }),
      ),
    );
    render();
    expect(await screen.findByText('Online-Quellen konnten nicht geladen werden')).toBeInTheDocument();
    // Die Detailzeile kommt aus dem `{error}`-Body des Backends — nur eine `ApiError` trägt
    // eine Meldung, die vor einem Menschen bestehen kann. Ohne diese Zusicherung belegte der
    // Test nur die Überschrift, und der Wegfall der Ursache bliebe unbemerkt.
    expect(screen.getByText('Kartenregistry nicht erreichbar')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Erneut abrufen' })).toBeInTheDocument();
    expect(screen.queryByText('Noch keine Online-Quellen')).not.toBeInTheDocument();
  });

  it('zeigt bei leerem Katalog den Leertext und KEINEN Fehler', async () => {
    mockBasis(admin, []);
    render();
    expect(await screen.findByText('Noch keine Online-Quellen')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Erneut abrufen' })).not.toBeInTheDocument();
  });

  it('„Erneut abrufen" holt die Liste wirklich neu', async () => {
    /**
     * Gemessen wird die WIRKUNG, nicht die Anwesenheit des Knopfes: der zweite Abruf
     * gelingt, die Tabelle steht. Ohne diese Hälfte wäre ein `onWiederholen={() => {}}`
     * genauso grün wie die Verdrahtung auf `refetch`.
     */
    let abrufe = 0;
    server.use(
      http.get('/api/auth/me', () => HttpResponse.json(admin)),
      http.get('/api/karte/online-quellen', () => {
        abrufe += 1;
        return abrufe === 1
          ? HttpResponse.json({ error: 'Kartenregistry nicht erreichbar' }, { status: 500 })
          : HttpResponse.json([quelle]);
      }),
      http.get('/api/karte/online-quellen/katalog', () => HttpResponse.json([katalogEintrag])),
    );
    render();
    await userEvent.click(await screen.findByRole('button', { name: 'Erneut abrufen' }));

    expect(await screen.findByText('OpenStreetMap')).toBeInTheDocument();
    expect(screen.queryByText('Online-Quellen konnten nicht geladen werden')).not.toBeInTheDocument();
  });

  it('Katalog-Flow: „Aus Katalog hinzufügen" → Eintrag → POST mit korrektem Body', async () => {
    let postBody: unknown = null;
    mockBasis(admin, []);
    server.use(
      http.post('/api/karte/online-quellen', async ({ request }) => {
        postBody = await request.json();
        return HttpResponse.json({ id: 9, ...(postBody as object) }, { status: 201 });
      }),
    );
    render();
    await screen.findByRole('button', { name: 'Aus Katalog hinzufügen' });
    await userEvent.click(screen.getByRole('button', { name: 'Aus Katalog hinzufügen' }));

    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByText('OpenFreeMap Liberty')).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Hinzufügen' }));

    await waitFor(() => expect(postBody).not.toBeNull());
    expect(postBody).toEqual({
      name: 'OpenFreeMap Liberty',
      url: 'https://tiles.openfreemap.org/styles/liberty',
      typ: 'vektor',
      attribution: '© OpenFreeMap',
      sortier: 1,
      aktiv: true,
      proxy: true, // LFH-190: Katalog-Quellen werden default geproxt + gecacht
    });
  });

  it('Katalog: bereits per URL vorhandene Einträge sind ausgegraut', async () => {
    // Bestandsquelle mit identischer URL wie der Katalog-Eintrag.
    mockBasis(admin, [{ ...quelle, url: katalogEintrag.url, typ: 'vektor' }]);
    render();
    await userEvent.click(await screen.findByRole('button', { name: 'Aus Katalog hinzufügen' }));
    const dialog = await screen.findByRole('dialog');
    const button = within(dialog).getByRole('button', { name: 'Vorhanden' });
    expect(button).toBeDisabled();
  });

  it('Pflicht-Attribution: leeres Feld → Validierungsmeldung, KEIN POST', async () => {
    let postAufgerufen = false;
    mockBasis(admin, []);
    server.use(
      http.post('/api/karte/online-quellen', () => {
        postAufgerufen = true;
        return HttpResponse.json({ id: 9 }, { status: 201 });
      }),
    );
    render();
    await userEvent.click(await screen.findByRole('button', { name: 'Quelle hinzufügen' }));

    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText('Name'), 'Test-Quelle');
    await userEvent.type(within(dialog).getByLabelText('URL'), 'https://example.org/style.json');
    // Attribution bewusst leer lassen.
    await userEvent.click(within(dialog).getByRole('button', { name: 'Speichern' }));

    expect(await screen.findByText('Attribution ist Pflicht')).toBeInTheDocument();
    // antd überspringt onFinish bei Validierungsfehler → Mutation feuert nie.
    expect(postAufgerufen).toBe(false);
  });

  it('Typ-Select: Options-Knoten klickbar; Auswahl landet im POST-Body', async () => {
    let postBody: unknown = null;
    mockBasis(admin, []);
    server.use(
      http.post('/api/karte/online-quellen', async ({ request }) => {
        postBody = await request.json();
        return HttpResponse.json({ id: 9, ...(postBody as object) }, { status: 201 });
      }),
    );
    render();
    await userEvent.click(await screen.findByRole('button', { name: 'Quelle hinzufügen' }));

    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText('Name'), 'Raster-Quelle');
    // Keine geschweiften Klammern in userEvent.type (Sondertasten-Syntax) — Platzhalter-URL.
    await userEvent.type(within(dialog).getByLabelText('URL'), 'https://example.org/raster');
    await userEvent.type(within(dialog).getByLabelText('Attribution'), '© Beispiel');

    // typ-Select öffnen und echten Options-Knoten wählen (Portal liegt außerhalb des Dialogs).
    await userEvent.click(within(dialog).getByRole('combobox'));
    const option = await screen.findByText(
      (_, el) => typeof el?.className === 'string'
        && el.className.includes('ant-select-item-option-content')
        && el.textContent === 'Raster (XYZ-Kacheln)',
    );
    await userEvent.click(option);

    await userEvent.click(within(dialog).getByRole('button', { name: 'Speichern' }));

    await waitFor(() => expect(postBody).not.toBeNull());
    expect(postBody).toMatchObject({
      name: 'Raster-Quelle',
      url: 'https://example.org/raster',
      typ: 'raster',
      attribution: '© Beispiel',
      aktiv: true,
      proxy: true, // LFH-190: Default-an ohne Umschalten
    });
  });

  it('Proxy-Schalter: abschalten → POST-Body proxy:false (LFH-190, Default-an)', async () => {
    let postBody: unknown = null;
    mockBasis(admin, []);
    server.use(
      http.post('/api/karte/online-quellen', async ({ request }) => {
        postBody = await request.json();
        return HttpResponse.json({ id: 9, ...(postBody as object) }, { status: 201 });
      }),
    );
    render();
    await userEvent.click(await screen.findByRole('button', { name: 'Quelle hinzufügen' }));

    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText('Name'), 'MapTiler');
    await userEvent.type(within(dialog).getByLabelText('URL'), 'https://api.maptiler.com/maps/streets/style.json');
    await userEvent.type(within(dialog).getByLabelText('Attribution'), '© MapTiler');

    // Default ist an (LFH-190); den „Über Server proxen"-Switch gezielt AUSschalten
    // (zwei Switches im Form) → proxy:false (Fall: Anbieter verbietet Proxying).
    // Der Schalter liegt seit LFH-346 · A8 unter „Weitere Angaben" und ist ohne
    // `forceRender` bis zum Aufklappen gar nicht im Baum — deshalb der Klick davor.
    await userEvent.click(within(dialog).getByRole('button', { name: /Weitere Angaben/ }));
    const proxyItem = (await within(dialog).findByText('Über Server proxen'))
      .closest('.ant-form-item');
    await userEvent.click(within(proxyItem as HTMLElement).getByRole('switch'));

    await userEvent.click(within(dialog).getByRole('button', { name: 'Speichern' }));

    await waitFor(() => expect(postBody).not.toBeNull());
    expect(postBody).toMatchObject({ name: 'MapTiler', proxy: false });
  });
});

/**
 * Freitext-Spalten begrenzen (LFH-346 · A4, Befund N13).
 *
 * DIE KAPPUNG SITZT AN DER ZELLE, NICHT AN DER SPALTE — im Browser gemessen (25.08.2026),
 * weil der Plan hier eine Annahme trug, die nicht hält. `KatalogTabelle` fährt
 * `scroll={{ x: 'max-content' }}` mit fixierter erster Spalte; genau dafür wählt rc-table
 * ausdrücklich `table-layout: auto` (`@rc-component/table/lib/Table.js:427-434`, Kommentar:
 * „When scroll.x is max-content, no need to fix table layout"). Unter `auto` ist die `width`
 * einer Spalte nur ein Wunsch: dieselbe Zelle mit einer 200-Zeichen-URL maß **1177 px in
 * einer 1578 px breiten Tabelle, ungekürzt**, obwohl `<col width="280">` stand — antds
 * `.ant-table-cell-ellipsis` setzt nur `overflow/white-space/text-overflow`, und keins davon
 * senkt den Platzbedarf einer Zelle. `max-width` an der Zelle bindet dagegen allein (gemessen:
 * lange Zelle gekappt und gekürzt, kurze Zelle unbehelligt) — weshalb die Spalten GAR KEINE
 * `width` tragen: sie wäre wirkungslos und zugleich ein Verstoß gegen
 * `components/feldbreiten.guard.test.ts`, der genau die `maxWidth`-Form verlangt.
 *
 * Deshalb stehen unten drei getrennte Aussagen statt einer: die Klasse (Kürzung
 * konfiguriert), die Kappung (sie greift auch) und der Titel (der volle Wert bleibt
 * erreichbar). Jede kann für sich rot werden. Pixel misst keine davon — jsdom rechnet
 * kein Layout.
 */
describe('OnlineQuellenVerwaltung — Freitext-Spalten (LFH-346 · A4)', () => {
  const langeUrl = `https://tiles.example.org/${'sehr-langer-pfad/'.repeat(12)}{z}/{x}/{y}.png`;
  const langeAttribution = `© ${'Sehr ausführlich genannte Mitwirkende, '.repeat(6)}ODbL`;

  it('kürzt die URL-Spalte und hält den vollen Wert im Titel', async () => {
    mockBasis(admin, [{ ...quelle, url: langeUrl }]);
    const { container } = render();
    await screen.findByText('OpenStreetMap');

    // Der Layout-Pin ist die BEGRÜNDUNG der Kappung darunter, kein Selbstzweck: legt ein
    // antd-Bump die Weiche auf `fixed` um, bände `width` allein und die Zusicherung wäre
    // eine andere. Dann bricht diese Zeile sichtbar, statt dass die Kappung still
    // überflüssig wird.
    const tabelle = container.querySelector('.ant-table-tbody')!.closest('table')!;
    expect(tabelle.style.tableLayout).toBe('auto');

    // Über den TEXT gegriffen, nicht über den Titel: fehlte der Titel, stürbe ein
    // `findByTitle` an „unable to find" und bewiese weder Klasse noch Kappung.
    const zelle = screen.getByText(langeUrl);
    expect(zelle.tagName).toBe('TD');
    expect(zelle).toHaveClass('ant-table-cell-ellipsis');
    expect(zelle).toHaveStyle({ maxWidth: '280px' });
    expect(zelle).toHaveAttribute('title', langeUrl);
  });

  it('kürzt die Attribution-Spalte ebenso', async () => {
    mockBasis(admin, [{ ...quelle, attribution: langeAttribution }]);
    render();
    await screen.findByText('OpenStreetMap');

    const zelle = screen.getByText(langeAttribution);
    expect(zelle).toHaveClass('ant-table-cell-ellipsis');
    expect(zelle).toHaveStyle({ maxWidth: '200px' });
    expect(zelle).toHaveAttribute('title', langeAttribution);
  });
});
